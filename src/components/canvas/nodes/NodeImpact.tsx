// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo } from "react";
import { useNodes } from "@xyflow/react";
import { computeNodeImpact } from "@/lib/canvas/metrics";
import { formatApy } from "@/lib/utils/format";
import type { CanvasNode } from "@/lib/canvas/types";

/**
 * This node's marginal effect on the strategy — the delta between the numbers
 * with it and without it.
 *
 * Absolute totals sit in the top gauge; what a builder actually needs while
 * tuning a slider is "what did THIS change do", which otherwise has to be
 * inferred by watching the gauge move.
 */
export default function NodeImpact({ nodeId }: { nodeId: string }) {
  const nodes = useNodes();
  const impact = useMemo(
    () => computeNodeImpact(nodeId, nodes as CanvasNode[]),
    [nodeId, nodes]
  );

  if (!impact.hasImpact) return null;

  const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
  const tone = (v: number, goodWhenPositive = true) => {
    if (Math.abs(v) < 1e-9) return "text-text-tertiary";
    const good = goodWhenPositive ? v > 0 : v < 0;
    return good ? "text-success" : "text-error";
  };

  const usd = impact.netAnnualUsdDelta;
  const usdAbs = Math.abs(usd);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-bg-secondary/50 px-2 py-1">
      <span className="text-[8px] font-semibold uppercase tracking-wider text-text-tertiary">
        Impact
      </span>
      <div className="flex items-center gap-2 tabular-nums">
        <span className={`text-[9px] font-semibold ${tone(impact.netApyDelta)}`}>
          {sign(impact.netApyDelta)}
          {formatApy(Math.abs(impact.netApyDelta))} APY
        </span>
        <span className={`text-[9px] ${tone(usd)}`}>
          {sign(usd)}${usdAbs < 1000 ? usdAbs.toFixed(2) : Math.round(usdAbs).toLocaleString()}/yr
        </span>
        {impact.healthFactorDelta !== null && Math.abs(impact.healthFactorDelta) > 0.005 && (
          <span className={`text-[9px] ${tone(impact.healthFactorDelta)}`}>
            {sign(impact.healthFactorDelta)}
            {Math.abs(impact.healthFactorDelta).toFixed(2)} HF
          </span>
        )}
      </div>
    </div>
  );
}
