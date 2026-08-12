// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Growing a strategy you already hold.
 *
 * The problem this solves: importing live positions gives nodes whose amounts
 * are what you ALREADY have — $200 of ETH collateral, $500 of BTC, $300 in a
 * vault. Executing that graph as-is would try to supply another $200 and $500,
 * which you don't hold. To add $50 of ETH and $100 of BTC you'd otherwise have
 * to rebuild the whole thing by hand and get the proportions right yourself.
 *
 * So a strategy has two amounts per leg:
 *   - `baseline` — what's already deployed on-chain (read-only, for context)
 *   - `delta`    — what this execution actually adds
 *
 * Only the delta is executed. The baseline exists so the UI can show the
 * resulting position and recompute health against the TOTAL, which is the number
 * that decides whether you get liquidated.
 */

import type { CanvasNode, CanvasNodeData } from "./types";

/** Per-node amounts already deployed, keyed by node id. */
export type BaselineMap = Record<string, { amount: string; amountUsd: number }>;

export interface ScaleResult {
  nodes: CanvasNode[];
  /** Legs whose delta couldn't be derived, so the caller can say why. */
  skipped: string[];
}

/**
 * Read the deployed amounts out of an imported graph, before any editing.
 * Call this once at import time — afterwards the node amounts are deltas.
 */
export function captureBaseline(nodes: CanvasNode[]): BaselineMap {
  const baseline: BaselineMap = {};
  for (const node of nodes) {
    const d = node.data as CanvasNodeData;
    switch (d.type) {
      case "supplyCollateral":
      case "vaultDeposit":
      case "repay":
        baseline[node.id] = { amount: d.amount ?? "0", amountUsd: d.amountUsd ?? 0 };
        break;
      case "borrow":
        baseline[node.id] = {
          amount: String(d.borrowAmount ?? 0),
          amountUsd: d.borrowAmountUsd ?? 0,
        };
        break;
    }
  }
  return baseline;
}

/**
 * Scale every leg of a strategy by the same factor — a convenience for
 * "grow everything by 25 %", not the general case.
 *
 * Worth being precise, because it's an easy trap: adding $50 to a $200 leg and
 * $100 to a $500 leg is NOT one factor. It's 25 % and 20 %, so uniform scaling
 * would put $125 on the second leg, not $100. Per-leg deltas are the real model;
 * this helper only covers the case where the user genuinely wants one ratio.
 *
 * The property that makes uniform scaling safe: scaling both sides of a market
 * leaves its LTV — and therefore its health factor — exactly unchanged.
 */
export function scaleStrategy(nodes: CanvasNode[], factor: number, baseline: BaselineMap): ScaleResult {
  const skipped: string[] = [];
  if (!isFinite(factor) || factor <= 0) return { nodes, skipped: ["invalid factor"] };

  const scaled = nodes.map((node) => {
    const base = baseline[node.id];
    if (!base) return node;
    const d = node.data as CanvasNodeData;

    const scaleAmount = (amount: string) => {
      const n = parseFloat(amount || "0");
      if (!isFinite(n)) return null;
      // Fixed precision, never exponential notation — parseUnits rejects "1e-7"
      // and the amount would silently become zero.
      return (n * factor).toFixed(18).replace(/\.?0+$/, "");
    };

    switch (d.type) {
      case "supplyCollateral":
      case "vaultDeposit":
      case "repay": {
        const next = scaleAmount(base.amount);
        if (next === null) {
          skipped.push(node.id);
          return node;
        }
        return {
          ...node,
          data: { ...d, amount: next, amountUsd: base.amountUsd * factor },
        } as CanvasNode;
      }
      case "borrow": {
        const amt = parseFloat(base.amount || "0");
        if (!isFinite(amt)) {
          skipped.push(node.id);
          return node;
        }
        // ltvPercent is deliberately untouched: scaling both sides of a market
        // leaves the ratio — and therefore the health factor — identical.
        return {
          ...node,
          data: {
            ...d,
            borrowAmount: amt * factor,
            borrowAmountUsd: base.amountUsd * factor,
          },
        } as CanvasNode;
      }
      default:
        return node;
    }
  });

  return { nodes: scaled, skipped };
}

export interface ResultingPosition {
  baselineUsd: number;
  deltaUsd: number;
  totalUsd: number;
}

/**
 * What the position looks like after this execution: existing + added.
 *
 * The gauge shows the delta strategy's own numbers, which understates risk on an
 * update — a health factor computed on $50 of new collateral is meaningless when
 * $200 is already at stake in the same market. This gives the UI the totals to
 * report instead.
 */
export function resultingPosition(
  nodes: CanvasNode[],
  baseline: BaselineMap,
  select: (d: CanvasNodeData) => number | null
): ResultingPosition {
  let baselineUsd = 0;
  let deltaUsd = 0;
  for (const node of nodes) {
    const d = node.data as CanvasNodeData;
    const value = select(d);
    if (value === null) continue;
    deltaUsd += value;
    const base = baseline[node.id];
    if (base) baselineUsd += base.amountUsd;
  }
  return { baselineUsd, deltaUsd, totalUsd: baselineUsd + deltaUsd };
}

/** Collateral selector for resultingPosition. */
export const selectCollateralUsd = (d: CanvasNodeData): number | null =>
  d.type === "supplyCollateral" ? d.amountUsd ?? 0 : null;

/** Debt selector for resultingPosition. */
export const selectDebtUsd = (d: CanvasNodeData): number | null =>
  d.type === "borrow" ? d.borrowAmountUsd ?? 0 : null;

/**
 * Resulting LTV and health factor per market, on the TOTAL position.
 *
 * This is the safety-critical piece of update mode. Adding $50 of collateral to
 * a market that already holds $200 produces a health factor on $250 — computing
 * it on the $50 delta alone is meaningless, and would read far safer than
 * reality when the added leg is small.
 *
 * Note it takes per-leg deltas rather than a single growth factor. Uniform
 * scaling leaves every LTV untouched, but real top-ups rarely are uniform:
 * adding $50 to a $200 leg and $100 to a $500 leg is 25 % and 20 %, so the two
 * markets drift apart and each has to be checked on its own.
 */
export interface MarketHealth {
  nodeId: string;
  label: string;
  collateralUsd: number;
  debtUsd: number;
  lltv: number;
  ltvBefore: number;
  ltvAfter: number;
  hfBefore: number | null;
  hfAfter: number | null;
}

export function resultingMarketHealth(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
  baseline: BaselineMap
): MarketHealth[] {
  const out: MarketHealth[] = [];

  for (const node of nodes) {
    const d = node.data as CanvasNodeData;
    if (d.type !== "borrow" || !d.market) continue;

    // Collateral feeding this borrow — the same edges the executor follows.
    let collateralDelta = 0;
    let collateralBase = 0;
    for (const e of edges) {
      if (e.target !== node.id) continue;
      const src = nodes.find((n) => n.id === e.source);
      const sd = src?.data as CanvasNodeData | undefined;
      if (sd?.type !== "supplyCollateral") continue;
      collateralDelta += sd.amountUsd ?? 0;
      collateralBase += baseline[e.source]?.amountUsd ?? 0;
    }

    const debtDelta = d.borrowAmountUsd ?? 0;
    const debtBase = baseline[node.id]?.amountUsd ?? 0;
    const lltv = Number(d.market.lltv) / 1e18;

    const totalCollateral = collateralBase + collateralDelta;
    const totalDebt = debtBase + debtDelta;

    const ltv = (debt: number, coll: number) => (coll > 0 ? debt / coll : 0);
    const hf = (debt: number, coll: number) => (debt > 0 ? (coll * lltv) / debt : null);

    out.push({
      nodeId: node.id,
      label: `${d.market.collateralAsset?.symbol ?? "?"}/${d.market.loanAsset.symbol}`,
      collateralUsd: totalCollateral,
      debtUsd: totalDebt,
      lltv,
      ltvBefore: ltv(debtBase, collateralBase),
      ltvAfter: ltv(totalDebt, totalCollateral),
      hfBefore: hf(debtBase, collateralBase),
      hfAfter: hf(totalDebt, totalCollateral),
    });
  }

  return out;
}
