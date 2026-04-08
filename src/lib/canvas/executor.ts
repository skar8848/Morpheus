// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Morpheus bundle executor.
 *
 * SAFETY STATUS (per Morpho Builder skill audit, 2026-04-08):
 *
 *   ✅ FIXED — setAuthorization now emitted before borrow flows
 *   ✅ FIXED — USDT approve resets allowance to 0 first (via buildApprovalTxs)
 *   ✅ FIXED — vaultWithdraw full-exit (≥99%) uses erc4626Redeem to avoid dust
 *
 *   ⚠️  PENDING — Full migration to @morpho-org/bundler-sdk-viem (Bundler3 is
 *       officially deprecated by Morpho). The SDK's setupBundle() handles
 *       slippage, permit2, authorization-with-sig, and unwrapping in one shot.
 *       https://www.npmjs.com/package/@morpho-org/bundler-sdk-viem
 *
 *   ⚠️  PENDING — Slippage protection on vault deposits via previewDeposit + 1%
 *       tolerance. Currently uses MAX_UINT256 share-price bound (permissive).
 *       The user-confirmed asset amount is the only protection today.
 *
 *   ⚠️  PENDING — setAuthorizationWithSig embedded in the bundle (saves one
 *       extra signature for first-time borrow users). Today the user signs a
 *       separate setAuthorization tx before the bundle.
 */

import type { Edge } from "@xyflow/react";
import { encodeFunctionData, isAddress, parseUnits } from "viem";
import type { CanvasNode } from "./types";
import type {
  SupplyCollateralNodeData,
  BorrowNodeData,
  SwapNodeData,
  VaultDepositNodeData,
  VaultWithdrawNodeData,
  RepayNodeData,
} from "./types";
import {
  BUNDLER3,
  GENERAL_ADAPTER1,
  MORPHO_BLUE,
  USDT_ADDRESSES,
  bundler3Abi,
  generalAdapterAbi,
  erc20Abi,
  morphoBlueAbi,
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
 * minSharePriceE27 = 0          → accept any price when withdrawing
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

    // VaultDeposit: needs approval for the underlying asset (user → adapter)
    if (data.type === "vaultDeposit") {
      const d = node.data as unknown as VaultDepositNodeData;
      if (!d.vault?.address || !d.amount) continue;
      let raw = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
      // Cap at upstream borrow amount to match executor behavior
      const upEdge = edges.find((e) => e.target === node.id);
      if (upEdge) {
        const upNode = nodes.find((n) => n.id === upEdge.source);
        const upData = upNode?.data as unknown as BorrowNodeData | undefined;
        if (upData?.type === "borrow" && upData.market && upData.borrowAmount > 0) {
          const borrowRaw = safeAmountToBigInt(upData.borrowAmount, upData.market.loanAsset.decimals);
          if (borrowRaw > 0n && raw > borrowRaw) raw = borrowRaw;
        }
      }
      addApproval(d.vault.asset.address, d.vault.asset.symbol, raw);
    }

    // Repay: needs approval for the loan token (user → adapter)
    if (data.type === "repay") {
      const d = node.data as unknown as RepayNodeData;
      if (!d.market?.loanAsset?.address || !d.amount) continue;
      const raw = safeAmountToBigInt(d.amount, d.market.loanAsset.decimals);
      addApproval(d.market.loanAsset.address, d.market.loanAsset.symbol, raw);
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
 *
 * USDT special-case: USDT's `approve()` reverts when the current allowance is
 * non-zero AND the new amount is also non-zero. We can't read the current
 * allowance from this pure function, so we conservatively emit a reset-to-zero
 * call followed by the actual approval whenever the token matches USDT on the
 * current chain. The first reset is a no-op when allowance is already 0.
 */
export function buildApprovalTxs(
  approvals: { token: `0x${string}`; amount: bigint }[],
  spender: `0x${string}`,
  chainId?: SupportedChainId
): { to: `0x${string}`; data: `0x${string}` }[] {
  const usdt = chainId !== undefined ? USDT_ADDRESSES[chainId] : null;
  const result: { to: `0x${string}`; data: `0x${string}` }[] = [];

  for (const { token, amount } of approvals) {
    const isUsdt = usdt !== null && token.toLowerCase() === usdt.toLowerCase();

    if (isUsdt && amount > 0n) {
      // USDT footgun: reset to 0 first
      result.push({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, 0n],
        }),
      });
    }

    result.push({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      }),
    });
  }

  return result;
}

/**
 * Check whether the strategy contains any operation that requires the user
 * to have authorized the GeneralAdapter1 in Morpho Blue.
 *
 * Operations that need authorization:
 *   - `borrow` — adapter calls morpho.borrow(onBehalf=user)
 *   - `withdrawCollateral` (not yet exposed in Morpheus)
 *
 * Other operations (supplyCollateral, repay, vaultDeposit, vaultWithdraw,
 * swap) do NOT need Morpho Blue authorization — they only need ERC20
 * allowances on the underlying tokens.
 *
 * Returns true if any borrow node has a market and a non-zero amount.
 */
export function strategyNeedsMorphoAuthorization(nodes: CanvasNode[]): boolean {
  for (const node of nodes) {
    const d = node.data as { type?: string };
    if (d.type === "borrow") {
      const bd = node.data as unknown as BorrowNodeData;
      if (bd.market && isFinite(bd.borrowAmount) && bd.borrowAmount > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Encode a `morpho.setAuthorization(adapter, true)` transaction.
 * The user must sign and submit this BEFORE any borrow bundle if they
 * have not previously authorized the adapter.
 *
 * Use `morphoBlueAbi.isAuthorized(user, adapter)` to check first — if it
 * returns true, this tx is unnecessary.
 */
export function buildMorphoAuthorizationTx(
  chainId: SupportedChainId
): { to: `0x${string}`; data: `0x${string}` } | null {
  const adapter = GENERAL_ADAPTER1[chainId];
  if (!adapter) return null;
  return {
    to: MORPHO_BLUE,
    data: encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "setAuthorization",
      args: [adapter, true],
    }),
  };
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
  // Track actual raw borrow amounts per node to cap downstream deposits
  const borrowRawAmounts = new Map<string, bigint>();

  for (const node of sorted) {
    const data = node.data as { type?: string };

    switch (data.type) {
      case "vaultWithdraw": {
        const d = node.data as unknown as VaultWithdrawNodeData;
        if (!d.position?.vault?.address || !d.amount) break;
        const vaultAddr = requireValidAddress(d.position.vault.address, "vault withdraw");
        const raw = safeAmountToBigInt(d.amount, d.position.vault.asset.decimals);
        if (raw === 0n) break;

        // FULL-EXIT DETECTION (Morpho safety pattern):
        // ERC-4626 `withdraw(assets)` converts the target asset amount back to
        // shares and burns them. Due to rounding, this can leave 1-2 wei of
        // shares behind ("dust") that the user cannot easily withdraw later.
        // For full exits, use `redeem(shares)` with the exact share balance —
        // guarantees a clean exit.
        //
        // We treat any withdrawal at >= 99% of the position's known assets as
        // a "full exit" and switch to redeem with the full share balance.
        const positionAssetsRaw = d.position.state?.assets
          ? safeBigInt(d.position.state.assets)
          : 0n;
        const positionSharesRaw = d.position.state?.shares
          ? safeBigInt(d.position.state.shares)
          : 0n;
        const isFullExit =
          positionAssetsRaw > 0n &&
          positionSharesRaw > 0n &&
          // raw >= positionAssetsRaw * 99 / 100
          raw * 100n >= positionAssetsRaw * 99n;

        if (isFullExit) {
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Redeem",
              args: [
                vaultAddr,
                positionSharesRaw,
                0n, // minSharePriceE27 = 0 → accept current price
                userAddress,
                userAddress,
              ],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
        } else {
          // Partial exit — use withdraw with exact asset amount
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Withdraw",
              args: [
                vaultAddr,
                raw,
                0n, // minSharePriceE27 = 0 → accept any share price
                userAddress,
                userAddress,
              ],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
        }
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

        // Track for downstream deposit capping
        borrowRawAmounts.set(node.id, rawAmount);

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
        let rawAmount = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
        if (rawAmount === 0n) break;

        // Cap deposit at upstream borrow amount to avoid rounding mismatch
        const upEdge = edges.find((e) => e.target === node.id);
        if (upEdge) {
          const upBorrow = borrowRawAmounts.get(upEdge.source);
          if (upBorrow !== undefined && rawAmount > upBorrow) {
            rawAmount = upBorrow;
          }
        }

        // Always pull tokens from user into adapter before depositing.
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

      case "repay": {
        const d = node.data as unknown as RepayNodeData;
        if (!d.market || !d.amount) break;
        const rawAmount = safeAmountToBigInt(d.amount, d.market.loanAsset.decimals);
        if (rawAmount === 0n) break;

        const loanToken = requireValidAddress(d.market.loanAsset.address, "loan token");
        const collateralToken = requireValidAddress(d.market.collateralAsset.address, "collateral token");
        const oracle = requireValidAddress(d.market.oracle.address, "oracle");
        const irm = requireValidAddress(d.market.irmAddress, "IRM");
        const lltv = safeBigInt(d.market.lltv);
        if (lltv === 0n) break;

        const marketParams = { loanToken, collateralToken, oracle, irm, lltv };

        // Transfer loan tokens from user to adapter
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc20TransferFrom",
            args: [loanToken, adapter, rawAmount],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });

        // Repay on behalf of user
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoRepay",
            args: [marketParams, rawAmount, 0n, MAX_UINT256, "0x"],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });

        // Optional: withdraw the user's collateral after the repay so they
        // get it back in their wallet. Triggered when the user (or the agent
        // building the canvas) sets withdrawCollateralAfterRepay + a
        // collateralToWithdraw amount on the repay node.
        // Common use case: "close out my borrow + free my wstETH/WBTC".
        if (
          d.withdrawCollateralAfterRepay &&
          d.collateralToWithdraw &&
          d.market.collateralAsset?.address
        ) {
          // collateralToWithdraw is RAW token units (wei) — already scaled.
          // Use safeBigInt directly. parseUnits via safeAmountToBigInt would
          // re-multiply by 10^decimals and produce a value 10^18 too large.
          const collateralRaw = safeBigInt(d.collateralToWithdraw);
          if (collateralRaw > 0n) {
            calls.push({
              to: adapter,
              data: encodeFunctionData({
                abi: generalAdapterAbi,
                functionName: "morphoWithdrawCollateral",
                args: [marketParams, collateralRaw, userAddress],
              }),
              value: 0n,
              skipRevert: false,
              callbackHash: ZERO_HASH,
            });
          }
        }
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

        // Same full-exit detection as the main bundle path:
        // ≥99% of position assets → use redeem(shares) to avoid dust.
        const positionAssetsRaw = d.position.state?.assets
          ? safeBigInt(d.position.state.assets)
          : 0n;
        const positionSharesRaw = d.position.state?.shares
          ? safeBigInt(d.position.state.shares)
          : 0n;
        const isFullExit =
          positionAssetsRaw > 0n &&
          positionSharesRaw > 0n &&
          raw * 100n >= positionAssetsRaw * 99n;

        if (isFullExit) {
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Redeem",
              args: [vaultAddr, positionSharesRaw, 0n, userAddress, userAddress],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
        } else {
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Withdraw",
              args: [vaultAddr, raw, 0n, userAddress, userAddress],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: ZERO_HASH,
          });
        }
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
      if (!d.vault?.address) continue;
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

      // Use the user-specified amount if set, capped at the actual swap output.
      // If depositAll is true or no amount is set, deposit the full swap output.
      let rawAmount: bigint;
      const swapOutput = swapNodeId ? swapResults.get(swapNodeId) ?? 0n : 0n;
      const userAmount = d.amount ? safeAmountToBigInt(d.amount, d.vault.asset.decimals) : 0n;

      if (swapOutput > 0n) {
        if (d.depositAll || userAmount <= 0n) {
          rawAmount = swapOutput;
        } else {
          // Respect user amount, but cap at swap output
          rawAmount = userAmount < swapOutput ? userAmount : swapOutput;
        }
      } else {
        if (!d.amount) continue;
        rawAmount = userAmount;
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