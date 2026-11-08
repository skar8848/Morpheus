// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Strategy metrics, as a pure function of the graph.
 *
 * Extracted from StrategyGauge so the same numbers can be recomputed for a
 * hypothetical graph — which is how each node reports its own marginal impact
 * ("what does this node change?") rather than only absolute totals.
 */

import type { CanvasNode, CanvasNodeData } from "./types";

export interface StrategyMetrics {
  /** Collateral + yield deposits (vaults and lends) — all capital committed. */
  totalDepositUsd: number;
  /** Collateral only; excludes the yield leg funded by borrowing. */
  totalCollateralUsd: number;
  totalBorrowUsd: number;
  totalRepayUsd: number;
  /** Rate the yield-bearing legs pay, weighted by deposit size (vaults and lends). */
  avgEarnApy: number;
  /** Rate paid on debt, weighted by borrow size. */
  avgBorrowApy: number;
  /** Annual net flow over all committed capital. */
  netApy: number;
  /** Debt-weighted health factor across isolated markets (null with no debt). */
  healthFactor: number | null;
  /** Net USD earned per year (earned − paid). */
  netAnnualUsd: number;
  vaultCount: number;
  /** Isolated-market supply positions. */
  lendCount: number;
  borrowCount: number;
}

export const EMPTY_METRICS: StrategyMetrics = {
  totalDepositUsd: 0,
  totalCollateralUsd: 0,
  totalBorrowUsd: 0,
  totalRepayUsd: 0,
  avgEarnApy: 0,
  avgBorrowApy: 0,
  netApy: 0,
  healthFactor: null,
  netAnnualUsd: 0,
  vaultCount: 0,
  lendCount: 0,
  borrowCount: 0,
};

export function computeStrategyMetrics(nodes: CanvasNode[]): StrategyMetrics {
  let totalDepositUsd = 0;
  // Capital sitting in yield-bearing legs (vault deposits + isolated-market lends).
  let totalYieldDepositUsd = 0;
  let totalBorrowUsd = 0;
  let totalRepayUsd = 0;
  let weightedEarnApy = 0;
  let weightedBorrowApy = 0;
  let weightedHfNumerator = 0;
  let vaultCount = 0;
  let lendCount = 0;
  let borrowCount = 0;

  for (const node of nodes) {
    const d = node.data as CanvasNodeData;

    switch (d.type) {
      case "borrow": {
        if (d.market && d.borrowAmount > 0) {
          // The collateral posted by this node counts as committed capital, the
          // same way it did when it was a node of its own.
          const coll = parseFloat(d.collateralAmount);
          if (isFinite(coll) && coll > 0) totalDepositUsd += d.collateralAmountUsd || 0;
          totalBorrowUsd += d.borrowAmountUsd || 0;
          borrowCount++;
          weightedBorrowApy += (d.market.state?.netBorrowApy ?? 0) * (d.borrowAmountUsd || 0);
          if (d.healthFactor !== null && d.healthFactor > 0) {
            weightedHfNumerator += d.healthFactor * (d.borrowAmountUsd || 0);
          }
        }
        break;
      }
      case "lend": {
        if (d.market) {
          const amt = parseFloat(d.amount);
          const usd = d.amountUsd || 0;
          if ((isFinite(amt) && amt > 0) || d.depositAll) {
            lendCount++;
            totalDepositUsd += usd;
            totalYieldDepositUsd += usd;
            // Rewards-inclusive rate, like the vault's netApy.
            weightedEarnApy += (d.market.state?.netSupplyApy ?? d.market.state?.supplyApy ?? 0) * usd;
          }
        }
        break;
      }
      case "vaultDeposit": {
        if (d.vault) {
          const amt = parseFloat(d.amount);
          const usd = d.amountUsd || 0;
          if ((isFinite(amt) && amt > 0) || d.depositAll) {
            vaultCount++;
            totalDepositUsd += usd;
            totalYieldDepositUsd += usd;
            weightedEarnApy += (d.vault.state?.netApy ?? 0) * usd;
          }
        }
        break;
      }
      case "repay": {
        if (d.market) {
          const amt = parseFloat(d.amount);
          if (isFinite(amt) && amt > 0) totalRepayUsd += d.amountUsd || 0;
        }
        break;
      }
    }
  }

  // Earn APY is weighted by yield deposits only — collateral earns nothing in
  // Morpho Blue (it sits isolated so it stays seizable at liquidation).
  const avgEarnApy = totalYieldDepositUsd > 0 ? weightedEarnApy / totalYieldDepositUsd : 0;
  const avgBorrowApy = totalBorrowUsd > 0 ? weightedBorrowApy / totalBorrowUsd : 0;
  // Net APY divides the annual net flow by all committed capital. Subtracting
  // the two averages directly would compare ratios on different bases.
  const netApy = totalDepositUsd > 0 ? (weightedEarnApy - weightedBorrowApy) / totalDepositUsd : 0;

  return {
    totalDepositUsd,
    totalCollateralUsd: totalDepositUsd - totalYieldDepositUsd,
    totalBorrowUsd,
    totalRepayUsd,
    avgEarnApy,
    avgBorrowApy,
    netApy,
    healthFactor: totalBorrowUsd > 0 ? weightedHfNumerator / totalBorrowUsd : null,
    netAnnualUsd: weightedEarnApy - weightedBorrowApy,
    vaultCount,
    lendCount,
    borrowCount,
  };
}

export interface NodeImpact {
  netApyDelta: number;
  netAnnualUsdDelta: number;
  /** null when removing the node leaves no debt (nothing to compare). */
  healthFactorDelta: number | null;
  hasImpact: boolean;
}

/**
 * What this node contributes: the strategy's metrics with it, minus the same
 * metrics computed as if it weren't there.
 */
export function computeNodeImpact(nodeId: string, nodes: CanvasNode[]): NodeImpact {
  const withNode = computeStrategyMetrics(nodes);
  const withoutNode = computeStrategyMetrics(nodes.filter((n) => n.id !== nodeId));

  const netApyDelta = withNode.netApy - withoutNode.netApy;
  const netAnnualUsdDelta = withNode.netAnnualUsd - withoutNode.netAnnualUsd;
  const healthFactorDelta =
    withNode.healthFactor !== null && withoutNode.healthFactor !== null
      ? withNode.healthFactor - withoutNode.healthFactor
      : null;

  return {
    netApyDelta,
    netAnnualUsdDelta,
    healthFactorDelta,
    hasImpact:
      Math.abs(netApyDelta) > 1e-6 ||
      Math.abs(netAnnualUsdDelta) > 0.01 ||
      (healthFactorDelta !== null && Math.abs(healthFactorDelta) > 0.005),
  };
}
