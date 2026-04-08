// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/types";
import { formatApy } from "@/lib/utils/format";

interface StrategyGaugeProps {
  nodes: CanvasNode[];
  edges: Edge[];
  /** When true, sidebar is collapsed — gauge slides to the corner */
  sidebarCollapsed?: boolean;
}

// --- Time projection helpers ---

const PERIODS: { label: string; days: number }[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
];

function fmtPnl(value: number): string {
  if (!isFinite(value) || Math.abs(value) < 0.01) return "$0";
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function projectPnl(nodes: CanvasNode[], days: number) {
  let earned = 0;
  let paid = 0;
  const yearFraction = days / 365;
  for (const node of nodes) {
    const d = node.data as CanvasNodeData;
    if (d.type === "vaultDeposit" && d.vault) {
      const apy = d.vault.state?.netApy ?? 0;
      const usd = d.amountUsd ?? 0;
      if (isFinite(apy) && isFinite(usd) && usd > 0) {
        earned += usd * apy * yearFraction;
      }
    } else if (d.type === "borrow" && d.market) {
      const netApy = d.market.state?.netBorrowApy ?? 0;
      const usd = d.borrowAmountUsd ?? 0;
      if (isFinite(netApy) && isFinite(usd) && usd > 0) {
        paid += usd * netApy * yearFraction;
      }
    }
  }
  return { earned, paid, net: earned - paid };
}

/** Aggregate strategy metrics computed from the graph */
function useStrategyMetrics(nodes: CanvasNode[], edges: Edge[]) {
  return useMemo(() => {
    let totalDepositUsd = 0;
    let totalBorrowUsd = 0;
    let totalRepayUsd = 0;
    let weightedEarnApy = 0; // weighted by deposit amount
    let weightedBorrowApy = 0; // weighted by borrow amount
    let lowestHf: number | null = null;
    let vaultCount = 0;
    let borrowCount = 0;

    for (const node of nodes) {
      const d = node.data as CanvasNodeData;

      switch (d.type) {
        case "supplyCollateral": {
          const amt = parseFloat(d.amount);
          if (isFinite(amt) && amt > 0) {
            totalDepositUsd += d.amountUsd || 0;
          }
          break;
        }
        case "borrow": {
          if (d.market && d.borrowAmount > 0) {
            totalBorrowUsd += d.borrowAmountUsd || 0;
            borrowCount++;
            const apy = d.market.state?.netBorrowApy ?? 0;
            weightedBorrowApy += apy * (d.borrowAmountUsd || 0);
            if (d.healthFactor !== null && d.healthFactor > 0) {
              if (lowestHf === null || d.healthFactor < lowestHf) {
                lowestHf = d.healthFactor;
              }
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
              const apy = d.vault.state?.netApy ?? 0;
              weightedEarnApy += apy * usd;
            }
          }
          break;
        }
        case "repay": {
          if (d.market) {
            const amt = parseFloat(d.amount);
            if (isFinite(amt) && amt > 0) {
              totalRepayUsd += d.amountUsd || 0;
            }
          }
          break;
        }
      }
    }

    const avgEarnApy = totalDepositUsd > 0 ? weightedEarnApy / totalDepositUsd : 0;
    const avgBorrowApy = totalBorrowUsd > 0 ? weightedBorrowApy / totalBorrowUsd : 0;
    const netApy = avgEarnApy - avgBorrowApy;

    return {
      totalDepositUsd,
      totalBorrowUsd,
      totalRepayUsd,
      avgEarnApy,
      avgBorrowApy,
      netApy,
      lowestHf,
      vaultCount,
      borrowCount,
    };
  }, [nodes]);
}

function HfIndicator({ hf }: { hf: number | null }) {
  if (hf === null) return null;
  const color = hf > 2 ? "text-success" : hf > 1.2 ? "text-yellow-400" : "text-error";
  const bgColor = hf > 2 ? "bg-success" : hf > 1.2 ? "bg-yellow-400" : "bg-error";
  // Map HF to gauge angle: 1.0 = danger (left), 3.0+ = safe (right)
  const clamped = Math.max(1, Math.min(hf, 3));
  const pct = ((clamped - 1) / 2) * 100; // 0-100%

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
        Health
      </span>
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-bg-secondary">
        {/* Gradient track */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-error via-yellow-400 to-success opacity-30" />
        {/* Indicator dot */}
        <div
          className={`absolute top-0 h-1.5 w-1.5 rounded-full ${bgColor} shadow-sm transition-all`}
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <span className={`text-xs font-bold tabular-nums ${color}`}>
        {hf.toFixed(2)}
      </span>
    </div>
  );
}

export default function StrategyGauge({ nodes, edges, sidebarCollapsed }: StrategyGaugeProps) {
  const metrics = useStrategyMetrics(nodes, edges);
  const [periodIdx, setPeriodIdx] = useState(2); // default 1M
  const period = PERIODS[periodIdx];
  const projection = useMemo(() => projectPnl(nodes, period.days), [nodes, period.days]);

  // Don't show if no meaningful actions
  const hasActions = metrics.vaultCount > 0 || metrics.borrowCount > 0 || metrics.totalRepayUsd > 0;
  if (!hasActions) return null;

  const netApyColor =
    metrics.netApy > 0
      ? "text-success"
      : metrics.netApy < 0
        ? "text-error"
        : "text-text-secondary";
  const netPnlColor =
    projection.net > 0
      ? "text-success"
      : projection.net < 0
        ? "text-error"
        : "text-text-secondary";

  const showProjection = projection.earned > 0 || Math.abs(projection.paid) > 0.01;

  return (
    <div
      className="absolute top-4 z-30 flex flex-col rounded-xl border border-border bg-bg-card/95 shadow-lg backdrop-blur-md transition-[left] duration-300"
      style={{ left: sidebarCollapsed ? "64px" : "272px" }}
    >
      {/* Row 1: APY | Earn | Borrow | Health | TVL — spread evenly across the block width */}
      <div className="flex items-center justify-evenly gap-6 px-6 py-2.5">
        {/* Net APY */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
            Net APY
          </span>
          <span className={`text-sm font-bold tabular-nums ${netApyColor}`}>
            {metrics.netApy > 0 ? "+" : ""}{formatApy(metrics.netApy)}
          </span>
        </div>

        {/* Separator */}
        {(metrics.avgEarnApy > 0 || metrics.avgBorrowApy > 0) && (
          <div className="h-8 w-px bg-border" />
        )}

        {/* Earn APY */}
        {metrics.avgEarnApy > 0 && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
              Earn
            </span>
            <span className="text-xs font-semibold tabular-nums text-success">
              {formatApy(metrics.avgEarnApy)}
            </span>
          </div>
        )}

        {/* Borrow APY */}
        {metrics.avgBorrowApy > 0 && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
              Borrow
            </span>
            <span className="text-xs font-semibold tabular-nums text-error">
              -{formatApy(metrics.avgBorrowApy)}
            </span>
          </div>
        )}

        {/* Health Factor */}
        {metrics.lowestHf !== null && (
          <>
            <div className="h-8 w-px bg-border" />
            <HfIndicator hf={metrics.lowestHf} />
          </>
        )}

        {/* TVL */}
        {metrics.totalDepositUsd > 0 && (
          <>
            <div className="h-8 w-px bg-border" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
                TVL
              </span>
              <span className="text-xs font-semibold tabular-nums text-text-primary">
                ${metrics.totalDepositUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Row 2: Projection — same width thanks to flex-col + border-t */}
      {showProjection && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
              Projected
            </span>
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
          </div>

          <div className="flex items-center gap-3">
            {projection.earned > 0 && (
              <span className="text-[10px] tabular-nums text-text-tertiary">
                Earn{" "}
                <span className="font-semibold text-success">
                  {fmtPnl(projection.earned)}
                </span>
              </span>
            )}
            {Math.abs(projection.paid) > 0.01 && (
              <span className="text-[10px] tabular-nums text-text-tertiary">
                {projection.paid > 0 ? "Pay" : "Recv"}{" "}
                <span
                  className={`font-semibold ${
                    projection.paid > 0 ? "text-error" : "text-success"
                  }`}
                >
                  {fmtPnl(-projection.paid)}
                </span>
              </span>
            )}
            <span className="border-l border-border pl-3 text-[10px] tabular-nums text-text-tertiary">
              Net{" "}
              <span className={`font-bold ${netPnlColor}`}>
                {fmtPnl(projection.net)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}