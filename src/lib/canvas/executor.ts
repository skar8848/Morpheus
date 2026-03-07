import type { Edge } from "@xyflow/react";
import { encodeFunctionData } from "viem";
import type { CanvasNode } from "./types";
import type {
  SupplyCollateralNodeData,
  BorrowNodeData,
  VaultDepositNodeData,
  VaultWithdrawNodeData,
} from "./types";
import {
  BUNDLER3,
  GENERAL_ADAPTER1,
  bundler3Abi,
  generalAdapterAbi,
  erc20Abi,
} from "@/lib/constants/contracts";
import type { SupportedChainId } from "@/lib/web3/chains";

interface BundlerCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  skipRevert: boolean;
  callbackHash: `0x${string}`;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/** Default slippage tolerance: 0.5% */
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% = 50 basis points

/**
 * Safely convert a human-readable amount to raw BigInt.
 * Returns 0n for invalid/NaN/Infinity/negative values.
 */
function safeAmountToBigInt(amount: number | string, decimals: number): bigint {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(num) || num <= 0) return 0n;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return 0n;
  // Use string math to avoid floating point issues for large values
  const factor = 10 ** decimals;
  const raw = Math.floor(num * factor);
  if (!isFinite(raw) || raw <= 0) return 0n;
  return BigInt(raw);
}

/**
 * Compute maxSharePriceE27 for vault deposit with slippage tolerance.
 * sharePriceE27 ≈ (assets * 1e27) / shares
 * We allow up to (1 + slippage) × current price.
 * Conservative default: use 1.005e27 (0.5% above 1:1)
 */
function maxSharePriceWithSlippage(slippageBps: number = DEFAULT_SLIPPAGE_BPS): bigint {
  // 1e27 base + slippage
  const base = 10n ** 27n;
  const slippage = (base * BigInt(slippageBps)) / 10000n;
  return base + slippage;
}

/**
 * Compute minSharePriceE27 for vault redeem with slippage tolerance.
 * We accept down to (1 - slippage) × 1:1 price.
 */
function minSharePriceWithSlippage(slippageBps: number = DEFAULT_SLIPPAGE_BPS): bigint {
  const base = 10n ** 27n;
  const slippage = (base * BigInt(slippageBps)) / 10000n;
  return base - slippage;
}

/**
 * Topological sort of nodes based on edges.
 * Throws if a cycle is detected.
 */
function topologicalSort(nodes: CanvasNode[], edges: Edge[]): CanvasNode[] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!adjList.has(edge.source) || !adjList.has(edge.target)) continue;
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length < nodes.length) {
    throw new Error("Graph contains a cycle");
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

/**
 * Collect all ERC-20 tokens that need user approval to the adapter.
 * Returns a list of { token, amount } to approve.
 */
export function getRequiredApprovals(
  nodes: CanvasNode[],
  edges: Edge[],
  chainId: SupportedChainId
): { token: `0x${string}`; symbol: string; amount: bigint }[] {
  const adapter = GENERAL_ADAPTER1[chainId];
  if (!adapter) return [];

  const approvals = new Map<string, { token: `0x${string}`; symbol: string; amount: bigint }>();

  for (const node of nodes) {
    const data = node.data as { type?: string };

    if (data.type === "supplyCollateral") {
      const d = node.data as unknown as SupplyCollateralNodeData;
      if (!d.asset?.address || !d.amount) continue;
      const raw = safeAmountToBigInt(d.amount, d.asset.decimals);
      if (raw === 0n) continue;
      const key = d.asset.address.toLowerCase();
      const existing = approvals.get(key);
      approvals.set(key, {
        token: d.asset.address as `0x${string}`,
        symbol: d.asset.symbol,
        amount: (existing?.amount ?? 0n) + raw,
      });
    }
  }

  return Array.from(approvals.values());
}

/**
 * Build approval transactions (separate from bundler).
 */
export function buildApprovalTxs(
  approvals: { token: `0x${string}`; amount: bigint }[],
  spender: `0x${string}`
): { to: `0x${string}`; data: `0x${string}` }[] {
  return approvals.map(({ token, amount }) => ({
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    }),
  }));
}

/**
 * Build bundler multicall transaction from canvas graph.
 * Returns the tx data to send to the Bundler3 contract.
 */
export function buildExecutionBundle(
  nodes: CanvasNode[],
  edges: Edge[],
  userAddress: `0x${string}`,
  chainId: SupportedChainId,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): {
  to: `0x${string}`;
  data: `0x${string}`;
  calls: BundlerCall[];
  hasSwap: boolean;
} {
  const adapter = GENERAL_ADAPTER1[chainId];
  const bundler = BUNDLER3[chainId];
  if (!adapter || !bundler) throw new Error("Chain not supported");

  const sorted = topologicalSort(nodes, edges);
  const calls: BundlerCall[] = [];
  let hasSwap = false;

  for (const node of sorted) {
    const data = node.data as { type?: string };

    switch (data.type) {
      case "vaultWithdraw": {
        const d = node.data as unknown as VaultWithdrawNodeData;
        if (!d.position?.vault?.address || !d.amount) break;
        const raw = safeAmountToBigInt(d.amount, d.position.vault.asset.decimals);
        if (raw === 0n) break;

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Redeem",
            args: [
              d.position.vault.address as `0x${string}`,
              raw,
              minSharePriceWithSlippage(slippageBps),
              userAddress,
              userAddress,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "supplyCollateral": {
        const d = node.data as unknown as SupplyCollateralNodeData;
        if (!d.asset?.address || !d.amount) break;
        const rawAmount = safeAmountToBigInt(d.amount, d.asset.decimals);
        if (rawAmount === 0n) break;

        // Transfer collateral to adapter
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc20TransferFrom",
            args: [d.asset.address as `0x${string}`, adapter, rawAmount],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });

        // Find downstream borrow market to supply collateral into
        const downEdge = edges.find((e) => e.source === node.id);
        if (downEdge) {
          const borrowNode = nodes.find((n) => n.id === downEdge.target);
          if (borrowNode) {
            const bd = borrowNode.data as unknown as BorrowNodeData;
            if (bd.type === "borrow" && bd.market) {
              const marketParams = {
                loanToken: bd.market.loanAsset.address as `0x${string}`,
                collateralToken: bd.market.collateralAsset.address as `0x${string}`,
                oracle: bd.market.oracle.address as `0x${string}`,
                irm: bd.market.irmAddress as `0x${string}`,
                lltv: BigInt(bd.market.lltv),
              };
              calls.push({
                to: adapter,
                data: encodeFunctionData({
                  abi: generalAdapterAbi,
                  functionName: "morphoSupplyCollateral",
                  args: [marketParams, rawAmount, userAddress, "0x"],
                }),
                value: 0n,
                skipRevert: false,
                callbackHash: ZERO_HASH,
              });
            }
          }
        }
        break;
      }

      case "borrow": {
        const d = node.data as unknown as BorrowNodeData;
        if (!d.market || !isFinite(d.borrowAmount) || d.borrowAmount <= 0) break;
        const rawAmount = safeAmountToBigInt(d.borrowAmount, d.market.loanAsset.decimals);
        if (rawAmount === 0n) break;

        const marketParams = {
          loanToken: d.market.loanAsset.address as `0x${string}`,
          collateralToken: d.market.collateralAsset.address as `0x${string}`,
          oracle: d.market.oracle.address as `0x${string}`,
          irm: d.market.irmAddress as `0x${string}`,
          lltv: BigInt(d.market.lltv),
        };

        // Borrow with slippage: use shares=0 (borrow by assets) + minSharePriceE27
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [
              marketParams,
              rawAmount,
              0n, // shares = 0 → borrow by assets
              minSharePriceWithSlippage(slippageBps),
              userAddress,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "vaultDeposit": {
        const d = node.data as unknown as VaultDepositNodeData;
        if (!d.vault?.address || !d.amount) break;
        const rawAmount = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
        if (rawAmount === 0n) break;

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Deposit",
            args: [
              d.vault.address as `0x${string}`,
              rawAmount,
              maxSharePriceWithSlippage(slippageBps),
              userAddress,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "swap": {
        hasSwap = true;
        break;
      }
    }
  }

  const txData = encodeFunctionData({
    abi: bundler3Abi,
    functionName: "multicall",
    args: [calls],
  });

  return { to: bundler, data: txData, calls, hasSwap };
}
