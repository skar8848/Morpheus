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
  BorrowNodeData,
  LendNodeData,
  LendWithdrawNodeData,
  SwapNodeData,
  VaultDepositNodeData,
  VaultWithdrawNodeData,
  RepayNodeData,
} from "./types";
import { isFixedRateBorrow } from "./types";
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
  let str = typeof amount === "number" ? String(amount) : amount;
  // String() switches to exponential notation below 1e-6 ("1e-7"), which
  // parseUnits rejects, so the node would silently be skipped as a zero amount.
  // Only then fall back to toFixed: on ordinary numbers it would print binary
  // noise (0.1 → "0.100000000000000006") where String() gives the clean value.
  if (typeof amount === "number" && /e/i.test(str)) str = amount.toFixed(decimals);
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
 * Raw sell amount of a swap, or null when the input is not a positive number.
 *
 * Truncates extra decimals rather than rounding like parseUnits: the order
 * must never sell a wei more than the user typed or holds. Shared with
 * useCowQuote so the quoted size and the signed size are the same number.
 * The amount input is type="number", so "1e-7" or "1e18" can reach here;
 * BigInt() throws on those, which crashed the panel during render, so
 * exponential notation is spelled out first.
 */
export function swapAmountToRaw(amount: string, decimals: number): bigint | null {
  let str = amount.trim();
  if (/e/i.test(str)) {
    const n = Number(str);
    if (!isFinite(n) || n <= 0) return null;
    str = n.toFixed(decimals);
  }
  const [intPart = "", fracPart = "", ...rest] = str.split(".");
  if (rest.length > 0 || !/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === "" && fracPart === "") return null;
  const raw = BigInt((intPart || "0") + fracPart.slice(0, decimals).padEnd(decimals, "0"));
  return raw > 0n ? raw : null;
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
 * Cap an amount at what the upstream borrow actually draws. A consumer sized from
 * a price quote can land a hair above the borrow after rounding, and pulling more
 * than the user received would draw on their own balance.
 */
function capAtUpstreamBorrow(
  raw: bigint,
  nodeId: string,
  nodes: CanvasNode[],
  edges: Edge[]
): bigint {
  // A consumer fed ONLY by borrows can't move more than they draw IN TOTAL.
  // (Mixed with a wallet or another producer, the total is not known here.)
  const incoming = edges.filter((e) => e.target === nodeId);
  if (incoming.length === 0) return raw;
  let total = 0n;
  for (const e of incoming) {
    const up = nodes.find((n) => n.id === e.source)?.data as unknown as BorrowNodeData | undefined;
    if (up?.type !== "borrow" || !up.market || !(up.borrowAmount > 0)) return raw;
    total += safeAmountToBigInt(up.borrowAmount, up.market.loanAsset.decimals);
  }
  return total > 0n && raw > total ? total : raw;
}

/**
 * Head-room pulled on top of the debt for a full repay, in basis points (0.1%).
 * The debt was read from the API some time before the bundle lands and keeps
 * accruing in between; at a 100% borrow APY, 0.1% still covers about 8 hours.
 * Whatever is not used is swept back to the user in the same bundle.
 */
const FULL_REPAY_BUFFER_BPS = 10n;

/**
 * Loan tokens a repay node pulls from the user's wallet. Shared by the executor,
 * the approval list and the node's balance check, so the allowance and the
 * "insufficient balance" warning always match the pull.
 */
export function repayPullRaw(d: RepayNodeData): bigint {
  if (!d.market || !d.amount) return 0n;
  const raw = safeAmountToBigInt(d.amount, d.market.loanAsset.decimals);
  if (!d.repayAll || raw === 0n) return raw;
  // +1 so a tiny debt still gets a buffer after integer division.
  return raw + (raw * FULL_REPAY_BUFFER_BPS) / 10_000n + 1n;
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
    // Cap at MAX_UINT256 to avoid encoding overflow (a vault share approval can be MAX_UINT256)
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

    // Borrow: the collateral it posts is pulled from the user's wallet. (The
    // borrowed loan token is sent TO the user, so it needs no approval here —
    // whoever consumes it downstream approves it.)
    if (data.type === "borrow") {
      const d = node.data as unknown as BorrowNodeData;
      // A fixed-rate leg never pulls collateral through the adapter.
      if (isFixedRateBorrow(d)) continue;
      if (!d.collateralAsset?.address || !d.collateralAmount) continue;
      let raw = safeAmountToBigInt(d.collateralAmount, d.collateralAsset.decimals);
      raw = capAtUpstreamBorrow(raw, node.id, nodes, edges);
      addApproval(d.collateralAsset.address, d.collateralAsset.symbol, raw);
    }

    // VaultDeposit: needs approval for the underlying asset (user → adapter)
    if (data.type === "vaultDeposit") {
      const d = node.data as unknown as VaultDepositNodeData;
      if (!d.vault?.address || !d.amount) continue;
      let raw = safeAmountToBigInt(d.amount, d.vault.asset.decimals);
      // Cap at upstream borrow amount to match executor behavior
      raw = capAtUpstreamBorrow(raw, node.id, nodes, edges);
      addApproval(d.vault.asset.address, d.vault.asset.symbol, raw);
    }

    // Lend: needs approval for the market's loan token (user → adapter)
    if (data.type === "lend") {
      const d = node.data as unknown as LendNodeData;
      if (!d.market?.loanAsset?.address || !d.amount) continue;
      let raw = safeAmountToBigInt(d.amount, d.market.loanAsset.decimals);
      raw = capAtUpstreamBorrow(raw, node.id, nodes, edges);
      addApproval(d.market.loanAsset.address, d.market.loanAsset.symbol, raw);
    }

    // Repay: needs approval for the loan token (user → adapter)
    if (data.type === "repay") {
      const d = node.data as unknown as RepayNodeData;
      if (!d.market?.loanAsset?.address || !d.amount) continue;
      addApproval(d.market.loanAsset.address, d.market.loanAsset.symbol, repayPullRaw(d));
    }

    // VaultWithdraw: adapter needs approval on vault shares (vault address is the ERC-20 share token).
    // A full exit redeems exactly the position's shares, and a partial withdraw
    // burns fewer than that, so the share balance is a tight upper bound: no
    // unlimited allowance left on the vault after the exit. MAX only when the
    // position came without a share count.
    if (data.type === "vaultWithdraw") {
      const d = node.data as unknown as VaultWithdrawNodeData;
      if (!d.position?.vault?.address) continue;
      const sharesRaw = d.position.state?.shares ? safeBigInt(d.position.state.shares) : 0n;
      addApproval(
        d.position.vault.address,
        `${d.position.vault.name} shares`,
        sharesRaw > 0n ? sharesRaw : MAX_UINT256
      );
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
 * Morpho Blue only lets an address move a position that belongs to someone else
 * if that owner authorized it. The adapter acts on the user's behalf for every
 * call that REDUCES their position or CREATES debt in their name:
 *   - `borrow`            — adapter calls morpho.borrow(onBehalf=user)
 *   - `lendWithdraw`      — adapter calls morpho.withdraw(onBehalf=user)
 *   - `repay` + collateral — morpho.withdrawCollateral(onBehalf=user)
 *
 * Calls that only ADD to the user's position (supplyCollateral, supply, repay,
 * vault deposits, swaps) need nothing but ERC-20 allowances on the tokens.
 */
export function strategyNeedsMorphoAuthorization(nodes: CanvasNode[]): boolean {
  for (const node of nodes) {
    const d = node.data as { type?: string };
    switch (d.type) {
      case "borrow": {
        const bd = node.data as unknown as BorrowNodeData;
        // Midnight, not Blue: no GA1 authorization involved.
        if (isFixedRateBorrow(bd)) break;
        if (bd.market && isFinite(bd.borrowAmount) && bd.borrowAmount > 0) return true;
        break;
      }
      case "lendWithdraw": {
        const ld = node.data as unknown as LendWithdrawNodeData;
        if (ld.position && parseFloat(ld.amount || "0") > 0) return true;
        break;
      }
      case "repay": {
        const rd = node.data as unknown as RepayNodeData;
        if (rd.market && rd.withdrawCollateralAfterRepay && rd.collateralToWithdraw) return true;
        break;
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
  const morpho = MORPHO_BLUE[chainId];
  if (!adapter || !morpho) return null;
  return {
    to: morpho,
    data: encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "setAuthorization",
      args: [adapter, true],
    }),
  };
}

// ---------------------------------------------------------------------------
// Call emission — one definition of what each node does on-chain.
//
// The single-phase bundle, the pre-swap bundle and the post-swap bundle all emit
// the same calls for the same node; they only differ in WHICH nodes they cover and
// in whether upstream swap fills are known yet. Keeping that in one place is what
// stops the three paths drifting apart (they previously each carried their own
// copy of the switch, and the copies had already diverged).
// ---------------------------------------------------------------------------

interface MarketParamsTuple {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}

interface MarketLike {
  loanAsset: { address: string };
  collateralAsset: { address: string };
  oracle: { address: string };
  irmAddress: string;
  lltv: string;
}

/** Morpho Blue market params from an API market, or null if the LLTV is unusable. */
function toMarketParams(m: MarketLike): MarketParamsTuple | null {
  const lltv = safeBigInt(m.lltv);
  if (lltv === 0n) return null;
  return {
    loanToken: requireValidAddress(m.loanAsset.address, "loan token"),
    collateralToken: requireValidAddress(m.collateralAsset.address, "collateral token"),
    oracle: requireValidAddress(m.oracle.address, "oracle"),
    irm: requireValidAddress(m.irmAddress, "IRM"),
    lltv,
  };
}

function adapterCall(adapter: `0x${string}`, data: `0x${string}`): BundlerCall {
  return { to: adapter, data, value: 0n, skipRevert: false, callbackHash: ZERO_HASH };
}

interface EmitContext {
  adapter: `0x${string}`;
  user: `0x${string}`;
  nodes: CanvasNode[];
  edges: Edge[];
  /** Raw loan-asset amount each borrow node draws, by node id — caps its consumers. */
  borrowRaw: Map<string, bigint>;
  /** Post-swap phase: what each swap actually delivered (raw), by node id. */
  swapResults?: Map<string, bigint>;
  /** Every token pulled from the user's wallet, so the caller can approve exactly that. */
  pulls: { token: `0x${string}`; symbol: string; amount: bigint }[];
}

function pullFromUser(
  ctx: EmitContext,
  calls: BundlerCall[],
  token: `0x${string}`,
  symbol: string,
  amount: bigint
) {
  ctx.pulls.push({ token, symbol, amount });
  calls.push(
    adapterCall(
      ctx.adapter,
      encodeFunctionData({
        abi: generalAdapterAbi,
        functionName: "erc20TransferFrom",
        args: [token, ctx.adapter, amount],
      })
    )
  );
}

/**
 * The amount a node that CONSUMES an asset (vault deposit, lend, collateral)
 * actually moves, given what the user typed and what is known about its feed:
 *
 *   - fed by a swap that has filled → the fill is the truth. `useAll` takes all of
 *     it; otherwise the user's figure, never more than was received.
 *   - fed by a borrow → never more than that borrow draws (quote rounding).
 */
function resolveConsumerAmount(
  nodeId: string,
  userRaw: bigint,
  useAll: boolean,
  ctx: EmitContext
): bigint {
  const incoming = ctx.edges.filter((e) => e.target === nodeId).map((e) => e.source);
  let raw = userRaw;

  // Every feed is a swap that has filled → the fills (summed) are the truth.
  const fills = incoming.map((up) => ctx.swapResults?.get(up));
  if (incoming.length > 0 && fills.every((f) => f !== undefined && f > 0n)) {
    const filled = fills.reduce<bigint>((sum, f) => sum + (f as bigint), 0n);
    raw = useAll || userRaw <= 0n ? filled : userRaw < filled ? userRaw : filled;
  }

  // Every feed is a borrow → never more than they draw in total.
  const caps = incoming.map((up) => ctx.borrowRaw.get(up));
  if (incoming.length > 0 && caps.every((c) => c !== undefined)) {
    const cap = caps.reduce<bigint>((sum, c) => sum + (c as bigint), 0n);
    if (raw > cap) raw = cap;
  }
  return raw;
}

/** Emit the on-chain calls for one node. Pure apart from `ctx` bookkeeping. */
function emitNodeCalls(node: CanvasNode, ctx: EmitContext): BundlerCall[] {
  const calls: BundlerCall[] = [];
  const { adapter, user } = ctx;
  const type = (node.data as { type?: string }).type;

  switch (type) {
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
      const positionAssetsRaw = d.position.state?.assets ? safeBigInt(d.position.state.assets) : 0n;
      const positionSharesRaw = d.position.state?.shares ? safeBigInt(d.position.state.shares) : 0n;
      const isFullExit =
        positionAssetsRaw > 0n &&
        positionSharesRaw > 0n &&
        // raw >= positionAssetsRaw * 99 / 100
        raw * 100n >= positionAssetsRaw * 99n;

      if (isFullExit) {
        calls.push(
          adapterCall(
            adapter,
            encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Redeem",
              args: [
                vaultAddr,
                positionSharesRaw,
                0n, // minSharePriceE27 = 0 → accept current price
                user,
                user,
              ],
            })
          )
        );
      } else {
        // Partial exit — use withdraw with exact asset amount
        calls.push(
          adapterCall(
            adapter,
            encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Withdraw",
              args: [
                vaultAddr,
                raw,
                0n, // minSharePriceE27 = 0 → accept any share price
                user,
                user,
              ],
            })
          )
        );
      }
      break;
    }

    case "lendWithdraw": {
      const d = node.data as unknown as LendWithdrawNodeData;
      const market = d.position?.market;
      if (!market || !d.amount) break;
      const mp = toMarketParams(market);
      if (!mp) break;
      const raw = safeAmountToBigInt(d.amount, market.loanAsset.decimals);
      if (raw === 0n) break;

      // Full exit burns the user's entire supply SHARES (the adapter resolves
      // `type(uint256).max` to the live share balance). Withdrawing by assets
      // can leave a few wei of shares behind, and by then the snapshot amount
      // is stale anyway — interest accrues every block. The node flags an
      // explicit MAX; an amount at or above the snapshot is treated the same.
      const positionAssets = safeBigInt(d.position?.state?.supplyAssets);
      const fullExit = !!d.withdrawAll || (positionAssets > 0n && raw >= positionAssets);

      calls.push(
        adapterCall(
          adapter,
          encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoWithdraw",
            args: [
              mp,
              fullExit ? 0n : raw, // assets
              fullExit ? MAX_UINT256 : 0n, // shares
              0n, // minSharePriceE27 = 0 → accept current price
              user,
            ],
          })
        )
      );
      break;
    }

    case "borrow": {
      const d = node.data as unknown as BorrowNodeData;
      // A fixed-rate borrow lifts the Midnight book instead. Encoding it here
      // would quietly turn it into a floating Blue debt.
      if (isFixedRateBorrow(d)) break;
      if (!d.market || !isFinite(d.borrowAmount) || d.borrowAmount <= 0) break;
      const mp = toMarketParams(d.market);
      if (!mp) break;

      // Collateral leg. Taken from the node's own asset, but it MUST be the
      // market's collateral token: supplying anything else reverts the bundle.
      let collateralRaw = 0n;
      let collateralPlannedRaw = 0n;
      if (d.collateralAsset?.address && d.collateralAmount) {
        if (d.collateralAsset.address.toLowerCase() !== mp.collateralToken.toLowerCase()) {
          throw new Error(
            `Borrow node: collateral ${d.collateralAsset.symbol} does not match the market's collateral`
          );
        }
        collateralPlannedRaw = safeAmountToBigInt(d.collateralAmount, d.collateralAsset.decimals);
        collateralRaw = resolveConsumerAmount(node.id, collateralPlannedRaw, !!d.collateralAll, ctx);
      }

      let borrowAmountRaw = safeAmountToBigInt(d.borrowAmount, d.market.loanAsset.decimals);
      if (borrowAmountRaw === 0n) break;

      // The borrow was sized (LTV → amount) against the QUOTED collateral. If the
      // swap that feeds it filled for less, drawing the planned amount would push
      // the position past the LTV the user chose — so scale the draw down with
      // the shortfall. Never scale up: a better fill just leaves extra headroom.
      if (collateralPlannedRaw > 0n && collateralRaw < collateralPlannedRaw) {
        borrowAmountRaw = (borrowAmountRaw * collateralRaw) / collateralPlannedRaw;
        if (borrowAmountRaw === 0n) break;
      }

      if (collateralRaw > 0n) {
        pullFromUser(ctx, calls, mp.collateralToken, d.collateralAsset?.symbol ?? "collateral", collateralRaw);
        calls.push(
          adapterCall(
            adapter,
            encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "morphoSupplyCollateral",
              args: [mp, collateralRaw, user, "0x"],
            })
          )
        );
      }

      // Track for downstream consumers (capping)
      ctx.borrowRaw.set(node.id, borrowAmountRaw);

      calls.push(
        adapterCall(
          adapter,
          encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [
              mp,
              borrowAmountRaw,
              0n, // shares = 0 → borrow by assets
              0n, // permissive: accept any share price
              user,
            ],
          })
        )
      );
      break;
    }

    case "lend": {
      const d = node.data as unknown as LendNodeData;
      if (!d.market) break;
      const mp = toMarketParams(d.market);
      if (!mp) break;
      const userRaw = d.amount ? safeAmountToBigInt(d.amount, d.market.loanAsset.decimals) : 0n;
      const raw = resolveConsumerAmount(node.id, userRaw, !!d.depositAll, ctx);
      if (raw === 0n) break;

      pullFromUser(ctx, calls, mp.loanToken, d.market.loanAsset.symbol ?? "loan token", raw);
      calls.push(
        adapterCall(
          adapter,
          encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoSupply",
            args: [
              mp,
              raw, // assets
              0n, // shares = 0 → supply by assets
              MAX_UINT256, // permissive: accept any share price
              user,
              "0x",
            ],
          })
        )
      );
      break;
    }

    case "vaultDeposit": {
      const d = node.data as unknown as VaultDepositNodeData;
      if (!d.vault?.address) break;
      const vaultAddr = requireValidAddress(d.vault.address, "vault deposit");
      const vaultAssetAddr = requireValidAddress(d.vault.asset.address, "vault deposit asset");
      const userRaw = d.amount ? safeAmountToBigInt(d.amount, d.vault.asset.decimals) : 0n;
      const raw = resolveConsumerAmount(node.id, userRaw, !!d.depositAll, ctx);
      if (raw === 0n) break;

      // Always pull tokens from user into adapter before depositing.
      pullFromUser(ctx, calls, vaultAssetAddr, d.vault.asset.symbol, raw);
      calls.push(
        adapterCall(
          adapter,
          encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Deposit",
            args: [
              vaultAddr,
              raw,
              MAX_UINT256, // permissive: accept any share price
              user,
            ],
          })
        )
      );
      break;
    }

    case "repay": {
      const d = node.data as unknown as RepayNodeData;
      if (!d.market || !d.amount) break;
      // Like every other consumer, a repay fed by a swap pulls no more than the
      // fill delivered: the quote it was sized on can land a little short, and
      // pulling the quoted amount would revert or dip into the user's own balance.
      const rawAmount = resolveConsumerAmount(node.id, repayPullRaw(d), false, ctx);
      if (rawAmount === 0n) break;
      const mp = toMarketParams(d.market);
      if (!mp) break;

      // Transfer loan tokens from user to adapter
      pullFromUser(ctx, calls, mp.loanToken, d.market.loanAsset.symbol ?? "loan token", rawAmount);

      // Repay on behalf of user. A full repay goes by shares: shares = MAX makes
      // the adapter read the user's borrow shares on-chain, so the debt is cleared
      // to the last wei whatever interest accrued since the amount was read.
      // Repaying by assets would leave dust debt, and make the collateral
      // withdrawal below revert, since the position would no longer be empty.
      calls.push(
        adapterCall(
          adapter,
          encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoRepay",
            args: d.repayAll
              ? [mp, 0n, MAX_UINT256, MAX_UINT256, user, "0x"]
              : [mp, rawAmount, 0n, MAX_UINT256, user, "0x"],
          })
        )
      );

      // The buffer pulled for a full repay is mostly unused: send it back. MAX
      // transfers the adapter's whole balance of the loan token, and is a no-op
      // when nothing is left.
      if (d.repayAll) {
        calls.push(
          adapterCall(
            adapter,
            encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc20Transfer",
              args: [mp.loanToken, user, MAX_UINT256],
            })
          )
        );
      }

      // Optional: withdraw the user's collateral after the repay so they
      // get it back in their wallet. Triggered when the user (or the agent
      // building the canvas) sets withdrawCollateralAfterRepay + a
      // collateralToWithdraw amount on the repay node.
      // Common use case: "close out my borrow + free my wstETH/WBTC".
      if (d.withdrawCollateralAfterRepay && d.collateralToWithdraw && d.market.collateralAsset?.address) {
        // collateralToWithdraw is RAW token units (wei) — already scaled.
        // Use safeBigInt directly. parseUnits via safeAmountToBigInt would
        // re-multiply by 10^decimals and produce a value 10^18 too large.
        // After a full repay the position holds no debt, so all of the collateral
        // is free: MAX makes the adapter read the exact on-chain amount instead of
        // trusting the figure captured when the node was filled in.
        const collateralRaw = d.repayAll ? MAX_UINT256 : safeBigInt(d.collateralToWithdraw);
        if (collateralRaw > 0n) {
          calls.push(
            adapterCall(
              adapter,
              encodeFunctionData({
                abi: generalAdapterAbi,
                functionName: "morphoWithdrawCollateral",
                args: [mp, collateralRaw, user],
              })
            )
          );
        }
      }
      break;
    }
  }

  return calls;
}

/** Emit calls for a set of nodes in dependency order. */
function emitCallsForNodes(
  nodes: CanvasNode[],
  edges: Edge[],
  adapter: `0x${string}`,
  user: `0x${string}`,
  swapResults?: Map<string, bigint>
): { calls: BundlerCall[]; pulls: EmitContext["pulls"] } {
  const ctx: EmitContext = {
    adapter,
    user,
    nodes,
    edges,
    borrowRaw: new Map(),
    swapResults,
    pulls: [],
  };
  const calls: BundlerCall[] = [];
  for (const node of topologicalSort(nodes, edges)) {
    calls.push(...emitNodeCalls(node, ctx));
  }
  return { calls, pulls: ctx.pulls };
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

  // A bridge leg cannot live inside a Bundler3 multicall. Callers must split
  // the graph first (planCrossChainExecution) and pass one chain's segment at a
  // time; reaching here with a bridge node means that split was skipped.
  if (nodes.some((n) => (n.data as { type?: string }).type === "bridge")) {
    throw new Error("Bridge nodes must be executed via the cross-chain plan, not a single bundle");
  }

  const hasSwap = nodes.some((n) => (n.data as { type?: string }).type === "swap");
  const { calls } = emitCallsForNodes(nodes, edges, adapter, userAddress);

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

    const sellRaw = swapAmountToRaw(d.amountIn, d.tokenIn.decimals);
    if (sellRaw === null) continue;
    const sellAmountWei = sellRaw.toString();

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

  // The filtered graph may not pass full validation (its connections to the
  // swap are cut), so this builds directly instead of via buildExecutionBundle.
  const { calls } = emitCallsForNodes(preNodes, preEdges, adapter, userAddress);

  const txData = encodeFunctionData({
    abi: bundler3Abi,
    functionName: "multicall",
    args: [calls],
  });

  return { to: bundler, data: txData, calls };
}

/**
 * Build a bundler multicall for post-swap operations (vault deposits, lends, and
 * borrows whose collateral is the swap's output). Uses the amounts CowSwap
 * actually delivered instead of the estimates.
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

  const { calls, pulls } = emitCallsForNodes(postNodes, postEdges, adapter, userAddress, swapResults);

  // The allowances are exactly what the emitted calls pull — no separate estimate
  // that could disagree with the bundle.
  const approvalMap = new Map<string, { token: `0x${string}`; symbol: string; amount: bigint }>();
  for (const pull of pulls) {
    const key = pull.token.toLowerCase();
    const existing = approvalMap.get(key);
    let amount = (existing?.amount ?? 0n) + pull.amount;
    if (amount > MAX_UINT256) amount = MAX_UINT256;
    approvalMap.set(key, { token: pull.token, symbol: pull.symbol, amount });
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
