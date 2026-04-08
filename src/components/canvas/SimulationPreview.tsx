// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState } from "react";
import type { Edge } from "@xyflow/react";
import type { PreflightResult } from "@/lib/canvas/preflight";
import { formatUnits } from "viem";
import {
  useMorphoMcpSimulate,
  type MorphoMcpSimulateResult,
} from "@/lib/hooks/useMorphoMcpSimulate";
import type { CanvasNode } from "@/lib/canvas/types";

interface SimulationPreviewProps {
  result: PreflightResult;
  /** Optional — when provided, an "Inspect with Morpho MCP" toggle appears */
  nodes?: CanvasNode[];
  edges?: Edge[];
}

/** Format a USD amount with thousands separators and 2 decimals */
function fmtUsd(value: number): string {
  if (!isFinite(value) || value === 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/** Format gas in ETH (rough — assumes user has gas price awareness elsewhere) */
function fmtGas(gas: bigint | null): string {
  if (gas === null) return "—";
  // Show as gwei for readability since ETH equivalent depends on gas price
  // User cares about: is it cheap or expensive? 200k gas = normal, 2M = expensive
  const formatted = formatUnits(gas, 0);
  const num = Number(formatted);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M gas`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K gas`;
  return `${num} gas`;
}

/** Color class for a health factor value */
function hfColor(hf: number | null): string {
  if (hf === null) return "text-text-tertiary";
  if (hf >= 2) return "text-success";
  if (hf >= 1.2) return "text-yellow-400";
  return "text-error";
}

/** Render the Morpho MCP-side analysis as an expandable block */
function McpAnalysis({ data }: { data: MorphoMcpSimulateResult }) {
  const allOk = data.allSucceeded !== false;
  const market = data.analysis?.market;
  const vault = data.analysis?.vault;
  const warnings = [
    ...(data.warnings ?? []),
    ...(data.analysis?.warnings ?? []),
  ];

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-tertiary">Morpho MCP analysis</span>
        <span className={allOk ? "text-success" : "text-error"}>
          {allOk ? "all succeeded" : "would revert"}
        </span>
      </div>

      {market && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-bg-card px-2 py-1.5 text-[10px] text-text-tertiary">
          {market.healthFactor !== undefined && (
            <span>
              HF after:{" "}
              <span className="font-semibold text-text-primary">
                {Number(market.healthFactor).toFixed(2)}
              </span>
            </span>
          )}
          {market.borrowAPYAfter !== undefined && (
            <span>
              Borrow APY after:{" "}
              <span className="font-semibold text-text-primary">
                {(Number(market.borrowAPYAfter) * 100).toFixed(2)}%
              </span>
            </span>
          )}
          {market.utilizationAfter !== undefined && (
            <span>
              Util after:{" "}
              <span className="font-semibold text-text-primary">
                {(Number(market.utilizationAfter) * 100).toFixed(1)}%
              </span>
            </span>
          )}
          {market.liquidationRisk && (
            <span className={market.liquidationRisk === "high" ? "text-error" : "text-text-secondary"}>
              risk: {market.liquidationRisk}
            </span>
          )}
        </div>
      )}

      {vault && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-bg-card px-2 py-1.5 text-[10px] text-text-tertiary">
          {vault.shareDelta && (
            <span>
              Δ shares:{" "}
              <span className="font-mono text-text-primary">{vault.shareDelta}</span>
            </span>
          )}
          {vault.assetDelta && (
            <span>
              Δ assets:{" "}
              <span className="font-mono text-text-primary">{vault.assetDelta}</span>
            </span>
          )}
          {vault.projectedApy !== undefined && (
            <span>
              Projected APY:{" "}
              <span className="font-semibold text-success">
                {(Number(vault.projectedApy) * 100).toFixed(2)}%
              </span>
            </span>
          )}
        </div>
      )}

      {data.executionResults && data.executionResults.length > 0 && (
        <div className="space-y-1">
          {data.executionResults.map((er, i) => (
            <div
              key={i}
              className={`rounded-md border px-2 py-1 text-[10px] ${
                er.success === false
                  ? "border-error/20 bg-error/5 text-error"
                  : "border-border bg-bg-card text-text-tertiary"
              }`}
            >
              <span className="font-semibold">
                tx {er.transactionIndex ?? i + 1}: {er.success === false ? "REVERT" : "ok"}
              </span>
              {er.gasUsed && <span className="ml-2">gas {er.gasUsed}</span>}
              {er.revertReason && (
                <p className="mt-0.5 font-mono text-error">{er.revertReason}</p>
              )}
              {er.logs && er.logs.length > 0 && (
                <p className="mt-0.5 text-text-tertiary">
                  {er.logs
                    .map((log) => log.description || `${log.contract}.${log.eventName}`)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p
              key={i}
              className="rounded-md border border-yellow-400/15 bg-yellow-400/5 px-2 py-1 text-[10px] text-yellow-400"
            >
              {w.message ?? "warning"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SimulationPreview({ result, nodes, edges }: SimulationPreviewProps) {
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const mcp = useMorphoMcpSimulate(
    nodes ?? [],
    edges ?? [],
    mcpEnabled && Boolean(nodes && edges)
  );

  const {
    loading,
    ok,
    errors,
    warnings,
    gasEstimate,
    willRevert,
    approvalCount,
    bundleCallCount,
    hasSwap,
    totalCollateralUsd,
    totalBorrowUsd,
    totalDepositUsd,
    minHealthFactor,
    needsMorphoAuthorization,
  } = result;

  // The auth warning gets its own dedicated panel — filter it out of the
  // generic warnings list to avoid duplication.
  const AUTH_WARNING_PREFIX = "First-time borrow";
  const filteredWarnings = warnings.filter(
    (w) => !w.startsWith(AUTH_WARNING_PREFIX)
  );

  // Status banner
  let statusLabel: string;
  let statusClass: string;
  let statusIcon: React.ReactNode;
  if (loading) {
    statusLabel = "Simulating…";
    statusClass = "border-border bg-bg-secondary text-text-tertiary";
    statusIcon = (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="animate-spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  } else if (errors.length > 0 || willRevert) {
    statusLabel = willRevert ? "Will revert" : "Cannot execute";
    statusClass = "border-error/30 bg-error/5 text-error";
    statusIcon = (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  } else if (ok) {
    // Auth-needed is a benign preliminary state, not a warning.
    if (needsMorphoAuthorization) {
      statusLabel = "Setup required";
      statusClass = "border-brand/30 bg-brand/5 text-brand";
    } else if (filteredWarnings.length > 0) {
      statusLabel = "Looks OK — review warnings";
      statusClass = "border-yellow-400/30 bg-yellow-400/5 text-yellow-400";
    } else {
      statusLabel = "Looks good";
      statusClass = "border-success/30 bg-success/5 text-success";
    }
    statusIcon = (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  } else {
    return null; // nothing to show yet
  }

  // Don't render anything if there's literally no data and we're not loading
  if (
    !loading &&
    bundleCallCount === 0 &&
    errors.length === 0 &&
    filteredWarnings.length === 0 &&
    !needsMorphoAuthorization
  ) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-secondary/50">
      {/* Status header */}
      <div
        className={`flex items-center gap-2 rounded-t-lg border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${statusClass}`}
      >
        {statusIcon}
        <span>Pre-execution Simulation</span>
        <span className="ml-auto normal-case tracking-normal">{statusLabel}</span>
      </div>

      {/* Body — totals + diagnostics */}
      <div className="space-y-2 px-3 py-2">
        {/* Totals row */}
        {(totalCollateralUsd > 0 || totalBorrowUsd > 0 || totalDepositUsd > 0) && (
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {totalCollateralUsd > 0 && (
              <div className="rounded-md border border-brand/15 bg-brand/5 px-2 py-1.5">
                <p className="text-[9px] text-text-tertiary">Collateral</p>
                <p className="font-medium text-brand">{fmtUsd(totalCollateralUsd)}</p>
              </div>
            )}
            {totalBorrowUsd > 0 && (
              <div className="rounded-md border border-success/15 bg-success/5 px-2 py-1.5">
                <p className="text-[9px] text-text-tertiary">Borrow</p>
                <p className="font-medium text-success">{fmtUsd(totalBorrowUsd)}</p>
              </div>
            )}
            {totalDepositUsd > 0 && (
              <div className="rounded-md border border-purple-400/15 bg-purple-400/5 px-2 py-1.5">
                <p className="text-[9px] text-text-tertiary">Vault deposit</p>
                <p className="font-medium text-purple-400">{fmtUsd(totalDepositUsd)}</p>
              </div>
            )}
          </div>
        )}

        {/* Health factor + gas + bundle counts */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
          {minHealthFactor !== null && (
            <span>
              HF post-borrow:{" "}
              <span className={`font-semibold ${hfColor(minHealthFactor)}`}>
                {minHealthFactor.toFixed(2)}
              </span>
            </span>
          )}
          {gasEstimate !== null && (
            <span>
              Gas: <span className="font-medium text-text-secondary">{fmtGas(gasEstimate)}</span>
            </span>
          )}
          {bundleCallCount > 0 && (
            <span>
              Bundle: <span className="font-medium text-text-secondary">{bundleCallCount} call{bundleCallCount !== 1 ? "s" : ""}</span>
            </span>
          )}
          {approvalCount > 0 && (
            <span>
              Approvals: <span className="font-medium text-text-secondary">{approvalCount}</span>
            </span>
          )}
          {hasSwap && (
            <span className="rounded-sm bg-amber-400/10 px-1 py-0.5 text-amber-400">multi-phase</span>
          )}
        </div>

        {/* Authorization required — dedicated panel, not a warning */}
        {needsMorphoAuthorization && errors.length === 0 && (
          <div className="rounded-md border border-brand/20 bg-brand/5 p-2.5">
            <div className="flex items-start gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                className="mt-0.5 shrink-0 text-brand"
              >
                <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <div className="flex-1">
                <p className="text-[10px] font-semibold text-brand">
                  One-time Morpho authorization required
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-text-secondary">
                  This is your first borrow on this chain. Before the bundle, the
                  app will ask you to sign a one-time{" "}
                  <code className="rounded bg-bg-card px-1 font-mono text-[9px] text-brand">
                    morpho.setAuthorization
                  </code>{" "}
                  tx that lets the GeneralAdapter borrow on your behalf. After
                  that, the bundle executes normally — no further setup needed.
                </p>
                <p className="mt-1 text-[9px] text-text-tertiary">
                  Auto-handled at Execute. Local gas estimate may show a revert
                  until the auth is granted — this is expected.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="rounded-md border border-error/15 bg-error/5 px-2 py-1 text-[10px] text-error">
                {err}
              </p>
            ))}
          </div>
        )}

        {/* Warnings */}
        {filteredWarnings.length > 0 && errors.length === 0 && (
          <div className="space-y-1">
            {filteredWarnings.map((w, i) => (
              <p key={i} className="rounded-md border border-yellow-400/15 bg-yellow-400/5 px-2 py-1 text-[10px] text-yellow-400">
                {w}
              </p>
            ))}
          </div>
        )}

        {/* Morpho MCP analysis — opt-in remote check */}
        {nodes && edges && bundleCallCount > 0 && (
          <div className="border-t border-border/60 pt-2">
            {!mcpEnabled && (
              <button
                type="button"
                onClick={() => setMcpEnabled(true)}
                className="flex w-full items-center justify-between rounded-md border border-brand/20 bg-brand/5 px-2 py-1.5 text-[10px] font-medium text-brand transition-colors hover:bg-brand/10"
              >
                <span>Inspect with Morpho MCP</span>
                <span className="text-[9px] text-brand/70">verify post-state →</span>
              </button>
            )}

            {mcpEnabled && mcp.loading && (
              <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="animate-spin">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Querying Morpho MCP…
              </div>
            )}

            {mcpEnabled && mcp.error && (
              <p className="rounded-md border border-error/15 bg-error/5 px-2 py-1 text-[10px] text-error">
                {mcp.error}
              </p>
            )}

            {mcpEnabled && mcp.result && <McpAnalysis data={mcp.result} />}
          </div>
        )}
      </div>
    </div>
  );
}
