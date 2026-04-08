// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/types";

interface TimeProjectionProps {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface PeriodConfig {
  label: string;
  days: number;
}

const PERIODS: PeriodConfig[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
];

/**
 * Format a USD P&L value with sign + thousands separators.
 * Always shows + or − so the user immediately sees direction.
 */
function fmtPnl(value: number): string {
  if (!isFinite(value) || Math.abs(value) < 0.01) return "$0.00";
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Compute earn / pay / net projected over `days` days.
 *
 * Earn = sum over (vaultDeposit, supplyCollateral with borrow yielding) of
 *   amountUsd × marketSupplyApy × (days / 365)
 * Pay = sum over (borrow, repay) of
 *   borrowAmountUsd × netBorrowApy × (days / 365)
 *
 * Note: this uses NETBorrowApy which can be negative (rewards > base rate).
 * In that case, "pay" is actually positive (you get paid to borrow).
 */
function projectPnl(nodes: CanvasNode[], days: number) {
  let earned = 0;
  let paid = 0; // positive = paid by user; negative = received by user
  const yearFraction = days / 365;

  for (const node of nodes) {
    const d = node.data as CanvasNodeData;
    switch (d.type) {
      case "vaultDeposit": {
        if (!d.vault) break;
        const apy = d.vault.state?.netApy ?? 0;
        const usd = d.amountUsd ?? 0;
        if (isFinite(apy) && isFinite(usd) && usd > 0) {
          earned += usd * apy * yearFraction;
        }
        break;
      }
      case "borrow": {
        if (!d.market) break;
        const netApy = d.market.state?.netBorrowApy ?? 0;
        const usd = d.borrowAmountUsd ?? 0;
        if (isFinite(netApy) && isFinite(usd) && usd > 0) {
          // netBorrowApy is the cost (positive = pay, negative = paid to borrow)
          paid += usd * netApy * yearFraction;
        }
        break;
      }
    }
  }

  return {
    earned,
    paid,
    net: earned - paid,
  };
}

export default function TimeProjection({ nodes, edges: _edges }: TimeProjectionProps) {
  const [periodIdx, setPeriodIdx] = useState(2); // default: 1M
  const period = PERIODS[periodIdx];

  // Only render when there's at least one yield-generating action
  const hasYieldActions = useMemo(
    () =>
      nodes.some((n) => {
        const d = n.data as CanvasNodeData;
        if (d.type === "vaultDeposit") return (d.amountUsd ?? 0) > 0;
        if (d.type === "borrow") return (d.borrowAmountUsd ?? 0) > 0;
        return false;
      }),
    [nodes]
  );

  const projection = useMemo(() => projectPnl(nodes, period.days), [nodes, period.days]);

  if (!hasYieldActions) return null;

  const netColor =
    projection.net > 0
      ? "text-success"
      : projection.net < 0
        ? "text-error"
        : "text-text-secondary";

  return (
    <div className="absolute left-[272px] top-[68px] z-30 flex items-center gap-3 rounded-xl border border-border bg-bg-card/95 px-3 py-2 shadow-lg backdrop-blur-md">
      <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
        Projected
      </span>

      {/* Period selector */}
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-bg-secondary p-0.5">
        {PERIODS.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setPeriodIdx(i)}
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
              i === periodIdx
                ? "bg-brand text-white"
                : "text-text-tertiary hover:text-text-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Earned */}
      {projection.earned > 0 && (
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
            Earned
          </span>
          <span className="text-xs font-semibold tabular-nums text-success">
            {fmtPnl(projection.earned)}
          </span>
        </div>
      )}

      {/* Paid (or received if negative) */}
      {Math.abs(projection.paid) > 0.01 && (
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
            {projection.paid > 0 ? "Paid" : "Received"}
          </span>
          <span
            className={`text-xs font-semibold tabular-nums ${
              projection.paid > 0 ? "text-error" : "text-success"
            }`}
          >
            {fmtPnl(-projection.paid)}
          </span>
        </div>
      )}

      {/* Net P&L */}
      <div className="flex flex-col items-center gap-0.5 border-l border-border pl-3">
        <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
          Net
        </span>
        <span className={`text-sm font-bold tabular-nums ${netColor}`}>
          {fmtPnl(projection.net)}
        </span>
      </div>
    </div>
  );
}
