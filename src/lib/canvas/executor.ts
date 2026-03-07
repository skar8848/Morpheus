import type { Edge } from "@xyflow/react";
import { encodeFunctionData, isAddress, parseUnits } from "viem";
import type { CanvasNode } from "./types";
import type {
  SupplyCollateralNodeData,
  BorrowNodeData,
  SwapNodeData,
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
import { validateGraph } from "./validation";

interface BundlerCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  skipRevert: boolean;
  callbackHash: `0x${string}`;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;


/**
 * Safely convert a human-readable amount to raw BigInt using string-based
 * arithmetic (via viem's parseUnits) to avoid floating-point precision loss.
 * Returns 0n for invalid/NaN/Infinity/negative values.
 */
function safeAmountToBigInt(amount: number | string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return 0n;
  const str = typeof amount === "number" ? String(amount) : amount;
  if (!str || str.trim() === "") return 0n;
  // Quick sanity check: must look like a positive number
  const num = parseFloat(str);
  if (!isFinite(num) || num <= 0) return 0n;
  try {
    const result = parseUnits(str, decimals);
    if (result <= 0n) return 0n;
    return result;
  } catch {
    return 0n;
  }
}

/**
 * Safely convert an API string to BigInt. Returns fallback on failure.
 */
function safeBigInt(value: unknown, fallback: bigint = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  try {
    const result = BigInt(value);
    return result;
  } catch {
    return fallback;
  }
}

/**
 * Validate an address for use in transaction construction.
 * Throws if invalid.
 */
function requireValidAddress(addr: unknown, label: string): `0x${string}` {
  if (typeof addr !== "string" || !isAddress(addr)) {
    throw new Error(`Invalid address for ${label}: ${String(addr)}`);
  }
  return addr as `0x${string}`;
}

/**
 * Permissive share price bounds.
 * We cannot know the vault's current share price without an on-chain read,
 * so using a 1:1 base would reject transactions for any mature vault where
 * the share price has appreciated beyond slippage tolerance.
 *
 * maxSharePriceE27 = uint256.max → accept any price when depositing
 * minSharePriceE27 = 0          → accept any price when borrowing
 * maxSharePriceE27 = uint256.max → accept any price when withdrawing
 *
 * The user confirms the exact asset amount, which is the real protection.
 */
const MAX_UINT256 = 2n ** 256n - 1n;

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

  const addApproval = (address: string, symbol: string, amount: bigint) => {
    if (!isAddress(address) || amount <= 0n) return;
    const key = address.toLowerCase();
    const existing = approvals.get(key);
    // Cap at MAX_UINT256 to avoid encoding overflow (vault share approvals use MAX_UINT256)
    let newAmount = (existing?.amount ?? 0n) + amount;
    if (newAmount > MAX_UINT256) newAmount = MAX_UINT256;
    approvals.set(key, {
      token: address as `0x${string}`,
      symbol,
      amount: newAmount,
    });
  };

  for (const node of nodes) {
    const data = node.data as { type?: string };

    if (data.type === "supplyCollateral") {
      const d = node.data as unknown as SupplyCollateralNodeData;
      if (!d.asset?.address || !d.amount) continue;
      const raw = safeAmountToBigInt(d.amount, d.asset.decimals);
      addApproval(d.asset.address, d.asset.symbol, raw);
    }

    // VaultDeposit: always needs approval for the underlying asset (user → adapter)
    if (data.type === "vaultDeposit") {
      const d = node.data as unknown as VaultDepositNodeData;
      if (!d.vault?.address || !d.amount) continue;
      const raw = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
      addApproval(d.vault.asset.address, d.vault.asset.symbol, raw);
    }

    // VaultWithdraw: adapter needs approval on vault shares (vault address is the ERC-20 share token)
    // Use MAX_UINT256 since exact share amount requires on-chain read
    if (data.type === "vaultWithdraw") {
      const d = node.data as unknown as VaultWithdrawNodeData;
      if (!d.position?.vault?.address) continue;
      addApproval(d.position.vault.address, `${d.position.vault.name} shares`, MAX_UINT256);
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
  chainId: SupportedChainId
): {
  to: `0x${string}`;
  data: `0x${string}`;
  calls: BundlerCall[];
  hasSwap: boolean;
} {
  // Defense-in-depth: validate graph before building bundle
  const validationErrors = validateGraph(nodes, edges);
  if (validationErrors.length > 0) {
    throw new Error(`Graph validation failed: ${validationErrors[0]}`);
  }

  // Validate userAddress
  if (!isAddress(userAddress)) {
    throw new Error("Invalid user address");
  }

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
        const vaultAddr = requireValidAddress(d.position.vault.address, "vault withdraw");
        const raw = safeAmountToBigInt(d.amount, d.position.vault.asset.decimals);
        if (raw === 0n) break;

        // Use erc4626Withdraw (takes assets) instead of erc4626Redeem (takes shares)
        // because the user inputs an asset amount, not a share amount.
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Withdraw",
            args: [
              vaultAddr,
              raw,
              MAX_UINT256, // permissive: accept any share price
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
        const assetAddr = requireValidAddress(d.asset.address, "supply collateral asset");
        const rawAmount = safeAmountToBigInt(d.amount, d.asset.decimals);
        if (rawAmount === 0n) break;

        // Find downstream borrow market to supply collateral into
        const downEdge = edges.find((e) => e.source === node.id);
        const borrowNode = downEdge ? nodes.find((n) => n.id === downEdge.target) : null;
        const bd = borrowNode ? (borrowNode.data as unknown as BorrowNodeData) : null;

        // C4 fix: Only transfer + supply if there's a valid downstream borrow.
        // Without a borrow, tokens would be stranded in the adapter.
        if (bd?.type === "borrow" && bd.market) {
          const loanToken = requireValidAddress(bd.market.loanAsset.address, "loan token");
          const collateralToken = requireValidAddress(bd.market.collateralAsset.address, "collateral token");
          const oracle = requireValidAddress(bd.market.oracle.address, "oracle");
          const irm = requireValidAddress(bd.market.irmAddress, "IRM");
          const lltv = safeBigInt(bd.market.lltv);
          if (lltv === 0n) break;

          // Transfer collateral to adapter
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc20TransferFrom",
              args: [assetAddr, adapter, rawAmount],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });

          const marketParams = { loanToken, collateralToken, oracle, irm, lltv };
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
        // If downstream is vaultDeposit, the transfer is handled by the vaultDeposit case
        break;
      }

      case "borrow": {
        const d = node.data as unknown as BorrowNodeData;
        if (!d.market || !isFinite(d.borrowAmount) || d.borrowAmount <= 0) break;
        const rawAmount = safeAmountToBigInt(d.borrowAmount, d.market.loanAsset.decimals);
        if (rawAmount === 0n) break;

        const loanToken = requireValidAddress(d.market.loanAsset.address, "loan token");
        const collateralToken = requireValidAddress(d.market.collateralAsset.address, "collateral token");
        const oracle = requireValidAddress(d.market.oracle.address, "oracle");
        const irm = requireValidAddress(d.market.irmAddress, "IRM");
        const lltv = safeBigInt(d.market.lltv);
        if (lltv === 0n) break;

        const marketParams = { loanToken, collateralToken, oracle, irm, lltv };

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [
              marketParams,
              rawAmount,
              0n, // shares = 0 → borrow by assets
              0n, // permissive: accept any share price
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
        const vaultAddr = requireValidAddress(d.vault.address, "vault deposit");
        const vaultAssetAddr = requireValidAddress(d.vault.asset.address, "vault deposit asset");
        const rawAmount = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
        if (rawAmount === 0n) break;

        // Always pull tokens from user into adapter before depositing.
        // Whether tokens come from a borrow (sent to user by morphoBorrow),
        // a wallet, or any other source — they're always in the user's wallet
        // and need erc20TransferFrom to reach the adapter for erc4626Deposit.
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc20TransferFrom",
            args: [vaultAssetAddr, adapter, rawAmount],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Deposit",
            args: [
              vaultAddr,
              rawAmount,
              MAX_UINT256, // permissive: accept any share price
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

/**
 * Get approvals needed only for pre-swap operations (excludes post-swap vault deposits).
 */
export function getPreSwapApprovals(
  nodes: CanvasNode[],
  edges: Edge[],
  chainId: SupportedChainId
): { token: `0x${string}`; symbol: string; amount: bigint }[] {
  const postSwapIds = getPostSwapNodeIds(nodes, edges);
  const swapIds = new Set(
    nodes
      .filter((n) => (n.data as { type?: string }).type === "swap")
      .map((n) => n.id)
  );
  const preNodes = nodes.filter(
    (n) => !postSwapIds.has(n.id) && !swapIds.has(n.id)
  );
  const preEdges = edges.filter(
    (e) =>
      !postSwapIds.has(e.source) &&
      !postSwapIds.has(e.target) &&
      !swapIds.has(e.source) &&
      !swapIds.has(e.target)
  );
  return getRequiredApprovals(preNodes, preEdges, chainId);
}

// ---------------------------------------------------------------------------
// Two-phase execution: pre-swap bundler → CowSwap orders → post-swap bundler
// ---------------------------------------------------------------------------

export interface SwapDetail {
  nodeId: string;
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmountWei: string;
  sellSymbol: string;
  buySymbol: string;
  sellDecimals: number;
  buyDecimals: number;
}

/**
 * Find all node IDs that are downstream of swap nodes (including swap nodes themselves).
 */
function getPostSwapNodeIds(nodes: CanvasNode[], edges: Edge[]): Set<string> {
  const swapIds = new Set(
    nodes
      .filter((n) => (n.data as { type?: string }).type === "swap")
      .map((n) => n.id)
  );

  const postSwap = new Set<string>();
  const queue = [...swapIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !postSwap.has(edge.target)) {
        postSwap.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return postSwap;
}

/**
 * Extract swap details from graph nodes for CowSwap order submission.
 */
export function getSwapDetails(
  nodes: CanvasNode[],
  edges: Edge[]
): SwapDetail[] {
  const sorted = topologicalSort(nodes, edges);
  const swaps: SwapDetail[] = [];

  for (const node of sorted) {
    const d = node.data as unknown as SwapNodeData;
    if (d.type !== "swap") continue;
    if (!d.tokenIn?.address || !d.tokenOut?.address || !d.amountIn) continue;

    const amountInNum = parseFloat(d.amountIn);
    if (!isFinite(amountInNum) || amountInNum <= 0) continue;

    // String-based BigInt conversion (same as useCowQuote)
    const parts = d.amountIn.split(".");
    const intPart = parts[0] || "0";
    const fracPart = (parts[1] || "")
      .slice(0, d.tokenIn.decimals)
      .padEnd(d.tokenIn.decimals, "0");
    const sellAmountWei = BigInt(intPart + fracPart).toString();

    swaps.push({
      nodeId: node.id,
      sellToken: d.tokenIn.address as `0x${string}`,
      buyToken: d.tokenOut.address as `0x${string}`,
      sellAmountWei,
      sellSymbol: d.tokenIn.symbol,
      buySymbol: d.tokenOut.symbol,
      sellDecimals: d.tokenIn.decimals,
      buyDecimals: d.tokenOut.decimals,
    });
  }

  return swaps;
}

/**
 * Build a bundler multicall for only the pre-swap operations
 * (everything NOT downstream of a swap node).
 */
export function buildPreSwapBundle(
  nodes: CanvasNode[],
  edges: Edge[],
  userAddress: `0x${string}`,
  chainId: SupportedChainId
): { to: `0x${string}`; data: `0x${string}`; calls: BundlerCall[] } {
  const postSwapIds = getPostSwapNodeIds(nodes, edges);
  const swapIds = new Set(
    nodes
      .filter((n) => (n.data as { type?: string }).type === "swap")
      .map((n) => n.id)
  );

  // Filter to only pre-swap nodes
  const preNodes = nodes.filter(
    (n) => !postSwapIds.has(n.id) && !swapIds.has(n.id)
  );
  const preEdges = edges.filter(
    (e) =>
      !postSwapIds.has(e.source) &&
      !postSwapIds.has(e.target) &&
      !swapIds.has(e.source) &&
      !swapIds.has(e.target)
  );

  const adapter = GENERAL_ADAPTER1[chainId];
  const bundler = BUNDLER3[chainId];
  if (!adapter || !bundler) throw new Error("Chain not supported");

  // Reuse the normal build but with filtered nodes
  // We call buildExecutionBundle which validates — but the filtered graph
  // may not pass validation (missing connections). Build manually instead.
  const sorted = topologicalSort(preNodes, preEdges);
  const calls: BundlerCall[] = [];

  for (const node of sorted) {
    const data = node.data as { type?: string };
    // Reuse the same switch logic — only non-swap types will be here
    switch (data.type) {
      case "vaultWithdraw": {
        const d = node.data as unknown as VaultWithdrawNodeData;
        if (!d.position?.vault?.address || !d.amount) break;
        const vaultAddr = requireValidAddress(d.position.vault.address, "vault withdraw");
        const raw = safeAmountToBigInt(d.amount, d.position.vault.asset.decimals);
        if (raw === 0n) break;
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Withdraw",
            args: [vaultAddr, raw, MAX_UINT256, userAddress, userAddress],
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
        const assetAddr = requireValidAddress(d.asset.address, "supply collateral asset");
        const rawAmount = safeAmountToBigInt(d.amount, d.asset.decimals);
        if (rawAmount === 0n) break;
        const downEdge = preEdges.find((e) => e.source === node.id);
        const borrowNode = downEdge ? preNodes.find((n) => n.id === downEdge.target) : null;
        const bd = borrowNode ? (borrowNode.data as unknown as BorrowNodeData) : null;
        if (bd?.type === "borrow" && bd.market) {
          const loanToken = requireValidAddress(bd.market.loanAsset.address, "loan token");
          const collateralToken = requireValidAddress(bd.market.collateralAsset.address, "collateral token");
          const oracle = requireValidAddress(bd.market.oracle.address, "oracle");
          const irm = requireValidAddress(bd.market.irmAddress, "IRM");
          const lltv = safeBigInt(bd.market.lltv);
          if (lltv === 0n) break;
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc20TransferFrom",
              args: [assetAddr, adapter, rawAmount],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "morphoSupplyCollateral",
              args: [{ loanToken, collateralToken, oracle, irm, lltv }, rawAmount, userAddress, "0x"],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
        }
        break;
      }
      case "borrow": {
        const d = node.data as unknown as BorrowNodeData;
        if (!d.market || !isFinite(d.borrowAmount) || d.borrowAmount <= 0) break;
        const rawAmount = safeAmountToBigInt(d.borrowAmount, d.market.loanAsset.decimals);
        if (rawAmount === 0n) break;
        const loanToken = requireValidAddress(d.market.loanAsset.address, "loan token");
        const collateralToken = requireValidAddress(d.market.collateralAsset.address, "collateral token");
        const oracle = requireValidAddress(d.market.oracle.address, "oracle");
        const irm = requireValidAddress(d.market.irmAddress, "IRM");
        const lltv = safeBigInt(d.market.lltv);
        if (lltv === 0n) break;
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [{ loanToken, collateralToken, oracle, irm, lltv }, rawAmount, 0n, 0n, userAddress],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }
    }
  }

  const txData = encodeFunctionData({
    abi: bundler3Abi,
    functionName: "multicall",
    args: [calls],
  });

  return { to: bundler, data: txData, calls };
}

/**
 * Build a bundler multicall for post-swap operations (e.g., vault deposits).
 * Uses actual received amounts from CowSwap fills instead of estimated amounts.
 *
 * @param swapResults - Map of swap nodeId → actual received amount in raw wei
 */
export function buildPostSwapBundle(
  nodes: CanvasNode[],
  edges: Edge[],
  userAddress: `0x${string}`,
  chainId: SupportedChainId,
  swapResults: Map<string, bigint>
): {
  to: `0x${string}`;
  data: `0x${string}`;
  calls: BundlerCall[];
  approvals: { token: `0x${string}`; symbol: string; amount: bigint }[];
} {
  const postSwapIds = getPostSwapNodeIds(nodes, edges);
  const adapter = GENERAL_ADAPTER1[chainId];
  const bundler = BUNDLER3[chainId];
  if (!adapter || !bundler) throw new Error("Chain not supported");

  const postNodes = nodes.filter((n) => postSwapIds.has(n.id));
  const postEdges = edges.filter(
    (e) => postSwapIds.has(e.source) || postSwapIds.has(e.target)
  );

  const sorted = topologicalSort(postNodes, postEdges);
  const calls: BundlerCall[] = [];
  const approvalMap = new Map<string, { token: `0x${string}`; symbol: string; amount: bigint }>();

  const addApproval = (address: string, symbol: string, amount: bigint) => {
    if (!isAddress(address) || amount <= 0n) return;
    const key = address.toLowerCase();
    const existing = approvalMap.get(key);
    let newAmount = (existing?.amount ?? 0n) + amount;
    if (newAmount > MAX_UINT256) newAmount = MAX_UINT256;
    approvalMap.set(key, { token: address as `0x${string}`, symbol, amount: newAmount });
  };

  for (const node of sorted) {
    const data = node.data as { type?: string };

    if (data.type === "vaultDeposit") {
      const d = node.data as unknown as VaultDepositNodeData;
      if (!d.vault?.address) break;
      const vaultAddr = requireValidAddress(d.vault.address, "vault deposit");
      const vaultAssetAddr = requireValidAddress(d.vault.asset.address, "vault deposit asset");

      // Find upstream swap node to get actual received amount
      const upEdge = edges.find((e) => e.target === node.id);
      const upSourceId = upEdge?.source;
      // Walk back through the graph to find the swap node
      let swapNodeId: string | null = null;
      if (upSourceId) {
        const upNode = nodes.find((n) => n.id === upSourceId);
        if ((upNode?.data as { type?: string })?.type === "swap") {
          swapNodeId = upSourceId;
        }
      }

      // Use actual swap output if available, otherwise fall back to user-specified amount
      let rawAmount: bigint;
      if (swapNodeId && swapResults.has(swapNodeId)) {
        rawAmount = swapResults.get(swapNodeId)!;
      } else {
        if (!d.amount) continue;
        rawAmount = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
      }
      if (rawAmount === 0n) continue;

      addApproval(d.vault.asset.address, d.vault.asset.symbol, rawAmount);

      calls.push({
        to: adapter,
        data: encodeFunctionData({
          abi: generalAdapterAbi,
          functionName: "erc20TransferFrom",
          args: [vaultAssetAddr, adapter, rawAmount],
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: ZERO_HASH,
      });

      calls.push({
        to: adapter,
        data: encodeFunctionData({
          abi: generalAdapterAbi,
          functionName: "erc4626Deposit",
          args: [vaultAddr, rawAmount, MAX_UINT256, userAddress],
        }),
        value: 0n,
        skipRevert: false,
        callbackHash: ZERO_HASH,
      });
    }
  }

  const txData = encodeFunctionData({
    abi: bundler3Abi,
    functionName: "multicall",
    args: [calls],
  });

  return {
    to: bundler,
    data: txData,
    calls,
    approvals: Array.from(approvalMap.values()),
  };
}
