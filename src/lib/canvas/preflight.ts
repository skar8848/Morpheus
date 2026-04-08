// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Pre-execution preflight: simulate the bundle locally to surface
 * gas estimate, total values, projected health factor, and any blocking
 * errors BEFORE the user clicks Execute.
 *
 * This is the first half of the "pre-execution diff" feature. The richer
 * post-state analysis (Δshares, ΔAPY, decoded events) will come from the
 * Morpho MCP simulate-transactions endpoint in a later iteration.
 */

import type { Edge } from "@xyflow/react";
import { estimateGas, readContract } from "wagmi/actions";
import { wagmiConfig } from "@/lib/web3/config";
import {
  buildExecutionBundle,
  getRequiredApprovals,
  getRequiredApprovals as _getRequiredApprovals,
  strategyNeedsMorphoAuthorization,
} from "./executor";
import { validateGraph } from "./validation";
import type { CanvasNode } from "./types";
import type { SupportedChainId } from "@/lib/web3/chains";
import {
  GENERAL_ADAPTER1,
  MORPHO_BLUE,
  morphoBlueAbi,
} from "@/lib/constants/contracts";

// Silence unused — kept to avoid editing imports above twice in case of refactor
void _getRequiredApprovals;

export interface PreflightResult {
  /** True when preflight has finished without blocking errors */
  ok: boolean;
  /** True while preflight is computing */
  loading: boolean;

  /** Validation errors that block execution */
  errors: string[];
  /** Non-blocking warnings the user should see */
  warnings: string[];

  /** Total gas estimate for the main bundle, in wei (excludes approvals) */
  gasEstimate: bigint | null;
  /** Whether the gas estimation reverted (means execution will fail) */
  willRevert: boolean;
  /** Revert reason from local simulation, if any */
  revertReason: string | null;

  /** Number of approval txs needed before the bundle */
  approvalCount: number;
  /** Number of bundler calls in the main bundle */
  bundleCallCount: number;
  /** Whether the graph contains a CowSwap step (multi-phase) */
  hasSwap: boolean;

  /** Sum of supply collateral USD values */
  totalCollateralUsd: number;
  /** Sum of borrow USD values */
  totalBorrowUsd: number;
  /** Sum of vault deposit USD values */
  totalDepositUsd: number;

  /** Worst (lowest) projected HF across all borrow nodes; null if no borrow */
  minHealthFactor: number | null;
  /** True when the worst projected HF is below 1.1 */
  hfWarning: boolean;

  /** True when the strategy borrows AND the user hasn't yet authorized
   * the GeneralAdapter1 in Morpho Blue. ExecuteButton will emit a one-time
   * setAuthorization tx before the bundle in this case — so a viem
   * estimateGas revert here is EXPECTED, not a real failure. */
  needsMorphoAuthorization: boolean;
}

export const EMPTY_PREFLIGHT: PreflightResult = {
  ok: false,
  loading: false,
  errors: [],
  warnings: [],
  gasEstimate: null,
  willRevert: false,
  revertReason: null,
  approvalCount: 0,
  bundleCallCount: 0,
  hasSwap: false,
  totalCollateralUsd: 0,
  totalBorrowUsd: 0,
  totalDepositUsd: 0,
  minHealthFactor: null,
  hfWarning: false,
  needsMorphoAuthorization: false,
};

/**
 * Run preflight on a strategy graph.
 *
 * Steps:
 *   1. Validate graph structure (blocks on errors)
 *   2. Compute USD totals + worst HF from node data
 *   3. Build the execution bundle (catches encoding errors)
 *   4. Run viem estimateGas on the bundle (catches reverts)
 *   5. Aggregate warnings (low HF, swap multi-phase, etc.)
 */
export async function runPreflight(
  nodes: CanvasNode[],
  edges: Edge[],
  userAddress: `0x${string}` | undefined,
  chainId: number
): Promise<PreflightResult> {
  const result: PreflightResult = { ...EMPTY_PREFLIGHT, loading: false };

  // 1. Graph validation
  const validationErrors = validateGraph(nodes, edges);
  if (validationErrors.length > 0) {
    result.errors = validationErrors;
    return result;
  }

  // 2. Aggregate from node data (no async needed)
  let minHF: number | null = null;
  for (const node of nodes) {
    const d = node.data as Record<string, unknown> & { type?: string };
    switch (d.type) {
      case "supplyCollateral": {
        const usd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
        if (isFinite(usd) && usd > 0) result.totalCollateralUsd += usd;
        break;
      }
      case "borrow": {
        const usd = typeof d.borrowAmountUsd === "number" ? d.borrowAmountUsd : 0;
        if (isFinite(usd) && usd > 0) result.totalBorrowUsd += usd;
        const hf = typeof d.healthFactor === "number" ? d.healthFactor : null;
        if (hf !== null && isFinite(hf)) {
          if (minHF === null || hf < minHF) minHF = hf;
        }
        break;
      }
      case "vaultDeposit": {
        const usd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
        if (isFinite(usd) && usd > 0) result.totalDepositUsd += usd;
        break;
      }
    }
  }
  result.minHealthFactor = minHF;
  result.hfWarning = minHF !== null && minHF < 1.1;
  if (result.hfWarning) {
    result.warnings.push(
      `Projected health factor ${minHF!.toFixed(2)} is below 1.1 — close to liquidation`
    );
  }

  // No address means we can't build the bundle — return what we have
  if (!userAddress) {
    result.ok = result.errors.length === 0;
    return result;
  }

  // 3. Try to build the bundle
  let bundle;
  try {
    bundle = buildExecutionBundle(nodes, edges, userAddress, chainId as SupportedChainId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Bundle build failed: ${msg}`);
    return result;
  }

  result.bundleCallCount = bundle.calls.length;
  result.hasSwap = bundle.hasSwap;
  if (bundle.hasSwap) {
    result.warnings.push(
      "Strategy contains a CowSwap step — execution will be multi-phase: approvals → pre-swap bundle → CowSwap (off-chain, async) → post-swap bundle"
    );
  }

  // Count required approvals
  try {
    const approvals = getRequiredApprovals(nodes, edges, chainId as SupportedChainId);
    result.approvalCount = approvals.length;
  } catch {
    // Non-fatal — approvals are best-effort estimate
  }

  // Empty bundle is technically ok (the multi-phase swap path moves work to other bundles),
  // but only if we have a swap. Otherwise it's nothing to execute.
  if (bundle.calls.length === 0) {
    if (!bundle.hasSwap) {
      result.errors.push("No actions to execute — graph builds an empty bundle");
      return result;
    }
    // Has swap, no main bundle calls — ok, the work is in pre/post bundles
    result.ok = true;
    return result;
  }

  // 4. Check Morpho authorization status BEFORE estimateGas.
  // If the strategy borrows but the user hasn't authorized the adapter yet,
  // estimateGas will revert with Unauthorized() — which is a FALSE NEGATIVE
  // (ExecuteButton emits a one-time setAuthorization tx before the bundle).
  // We pre-check the auth status and surface this case as a benign warning
  // instead of a "will revert" error.
  const needsAuth = strategyNeedsMorphoAuthorization(nodes);
  let isAuthorized = true;
  if (needsAuth) {
    const adapter = GENERAL_ADAPTER1[chainId as SupportedChainId];
    if (adapter) {
      try {
        isAuthorized = (await readContract(wagmiConfig, {
          address: MORPHO_BLUE,
          abi: morphoBlueAbi,
          functionName: "isAuthorized",
          args: [userAddress, adapter],
        })) as boolean;
      } catch {
        // RPC failure — assume not authorized so we set the warning
        isAuthorized = false;
      }
    }
    result.needsMorphoAuthorization = !isAuthorized;
    if (!isAuthorized) {
      result.warnings.push(
        "First-time borrow on this chain — a one-time Morpho authorization tx will be sent before the bundle (auto-handled at Execute)"
      );
    }
  }

  // 5. Run estimateGas on the bundle
  try {
    const gas = await estimateGas(wagmiConfig, {
      to: bundle.to,
      data: bundle.data,
      value: 0n,
      account: userAddress,
    });
    result.gasEstimate = gas;
    result.ok = result.errors.length === 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cleaned = msg
      .replace(/EstimateGasExecutionError:?\s*/i, "")
      .replace(/Details:?\s*/i, "")
      .replace(/Request[\s\S]+$/i, "")
      .slice(0, 280)
      .trim();
    result.revertReason = cleaned;

    // If we know the user needs authorization, the revert is EXPECTED.
    // Don't mark it as willRevert — the bundle will succeed once auth is set.
    if (result.needsMorphoAuthorization) {
      // Already added the auth warning above; mark ok so the panel shows green.
      result.ok = result.errors.length === 0;
    } else {
      result.willRevert = true;
      result.errors.push(`Bundle would revert on-chain: ${cleaned}`);
    }
  }

  return result;
}
