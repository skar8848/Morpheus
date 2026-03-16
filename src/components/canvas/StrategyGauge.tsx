// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo } from "react";
import type { Edge } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/types";
import { formatApy } from "@/lib/utils/format";

interface StrategyGaugeProps {
  nodes: CanvasNode[];
  edges: Edge[];
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

export default function StrategyGauge({ nodes, edges }: StrategyGaugeProps) {
  const metrics = useStrategyMetrics(nodes, edges);

  // Don't show if no meaningful actions
  const hasActions = metrics.vaultCount > 0 || metrics.borrowCount > 0 || metrics.totalRepayUsd > 0;
  if (!hasActions) return null;

  const netApyColor = metrics.netApy > 0 ? "text-success" : metrics.netApy < 0 ? "text-error" : "text-text-secondary";

  return (
    <div className="absolute left-[272px] top-4 z-30 flex items-center gap-4 rounded-xl border border-border bg-bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur-md">
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

      {/* Totals */}
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
  );
}