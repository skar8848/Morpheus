// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { useMarketLiveState } from "@/lib/hooks/useLendMarkets";
import { formatApy, formatLltv, formatUsd, formatTokenAmount } from "@/lib/utils/format";
import { safeBigInt } from "@/lib/utils/bigint";
import type { LendWithdrawNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import NodeImpact from "./NodeImpact";
import SearchSelect from "./SearchSelect";

/**
 * Take supply back out of an isolated market.
 *
 * Two things set it apart from a vault withdrawal. A market, unlike a vault, only
 * pays out what is NOT currently lent to borrowers — so the amount is capped by
 * the market's live liquidity, not just by the position size. And exiting fully
 * means burning every supply share, which is a different call from withdrawing
 * "all the assets I can see": the number on screen is already stale by the time
 * the transaction lands, because interest accrues every block.
 */
function LendWithdrawNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { marketPositions, loading } = useUserPositions();
  const d = data as unknown as LendWithdrawNodeData;

  const supplyPositions = useMemo(
    () => marketPositions.filter((p) => p.state && safeBigInt(p.state.supplyAssets) > 0n),
    [marketPositions]
  );

  const positionOptions = useMemo(
    () =>
      supplyPositions.map((p) => ({
        value: p.market.uniqueKey,
        label: `${p.market.collateralAsset.symbol}/${p.market.loanAsset.symbol} — ${
          p.state?.supplyAssetsUsd
            ? formatUsd(p.state.supplyAssetsUsd)
            : p.state?.supplyAssets
              ? formatTokenAmount(p.state.supplyAssets, p.market.loanAsset.decimals)
              : "—"
        }`,
        icon: p.market.loanAsset.logoURI,
      })),
    [supplyPositions]
  );

  const market = d.position?.market ?? null;
  const decimals = market?.loanAsset.decimals ?? 18;
  const symbol = market?.loanAsset.symbol ?? "";

  // Live state of the picked market: liquidity decides how much can leave.
  const liveKeys = useMemo(() => (market ? [market.uniqueKey] : []), [market]);
  const { states } = useMarketLiveState(liveKeys);
  const live = market ? states[market.uniqueKey] : undefined;

  const positionAmount = d.position?.state?.supplyAssets
    ? Number(d.position.state.supplyAssets) / 10 ** decimals
    : 0;
  const liquidityAmount =
    live?.liquidityAssets !== undefined ? Number(live.liquidityAssets) / 10 ** decimals : null;
  // Leaving is capped by what borrowers have not taken.
  const maxWithdrawable =
    liquidityAmount !== null && isFinite(liquidityAmount)
      ? Math.min(positionAmount, liquidityAmount)
      : positionAmount;
  const canExitFully = liquidityAmount === null || liquidityAmount >= positionAmount;

  const current = parseFloat(d.amount || "0");
  const pct = positionAmount > 0 ? Math.round((current / positionAmount) * 100) : 0;
  const exceedsLiquidity = liquidityAmount !== null && current > liquidityAmount;

  // Persist so the Execute button can block on it.
  const prevExceedsRef = useRef(false);
  useEffect(() => {
    if (exceedsLiquidity !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsLiquidity;
      updateNodeData(id, { exceedsLiquidity });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exceedsLiquidity]);

  const setAmount = (amount: number, all = false) =>
    updateNodeData(id, { amount: amount.toFixed(6), withdrawAll: all });

  const utilization = live?.utilization;

  return (
    <NodeShell
      nodeType="lendWithdraw"
      title="Lend Withdraw"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsLiquidity}
      loading={loading}
    >
      <div className="space-y-2">
        {/* Position selector */}
        <div>
          <label className="text-[10px] text-text-tertiary">Position</label>
          {loading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={positionOptions}
              value={market?.uniqueKey ?? ""}
              onChange={(key) => {
                const pos = supplyPositions.find((p) => p.market.uniqueKey === key) ?? null;
                updateNodeData(id, { position: pos, amount: "", withdrawAll: false });
              }}
              placeholder="Search position..."
            />
          )}
          {!loading && supplyPositions.length === 0 && (
            <p className="mt-1 text-[10px] text-text-tertiary">No lend positions on this chain</p>
          )}
        </div>

        {d.position && market && (
          <>
            <div className="space-y-1 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center">
                  <Image
                    src={market.collateralAsset.logoURI}
                    alt={market.collateralAsset.symbol}
                    width={14}
                    height={14}
                    className="rounded-full"
                    unoptimized
                  />
                  <Image
                    src={market.loanAsset.logoURI}
                    alt={market.loanAsset.symbol}
                    width={14}
                    height={14}
                    className="-ml-1.5 rounded-full ring-1 ring-bg-card"
                    unoptimized
                  />
                </div>
                <span className="text-xs font-medium text-text-primary">
                  {market.collateralAsset.symbol}/{market.loanAsset.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">LLTV</span>
                <span className="text-xs text-text-secondary">{formatLltv(market.lltv)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">Supplied</span>
                <span className="text-xs text-text-secondary">
                  {d.position.state?.supplyAssetsUsd
                    ? formatUsd(d.position.state.supplyAssetsUsd)
                    : `${positionAmount.toFixed(4)} ${symbol}`}
                </span>
              </div>
              {live?.netSupplyApy !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">Supply APY</span>
                  <span className="text-xs font-medium text-success">{formatApy(live.netSupplyApy)}</span>
                </div>
              )}
              {liquidityAmount !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">Withdrawable now</span>
                  <span className={`text-xs ${canExitFully ? "text-text-secondary" : "text-yellow-400"}`}>
                    {Math.min(liquidityAmount, positionAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                    {symbol}
                  </span>
                </div>
              )}
              {utilization !== undefined && utilization > 0.95 && (
                <p className="text-[10px] text-error">
                  Utilization {(utilization * 100).toFixed(1)}% — most of the market is lent out
                </p>
              )}
            </div>

            {/* Withdraw amount — slider + input */}
            <div className="nodrag space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-text-tertiary">Withdraw Amount</label>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => {
                        const p = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        setAmount((positionAmount * p) / 100);
                      }}
                      className="w-10 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-text-tertiary">%</span>
                  </div>
                  <button
                    className="ml-1 text-[10px] text-brand hover:text-brand-hover"
                    title={
                      canExitFully
                        ? "Exit the whole position (burns every share, no dust left)"
                        : "The market cannot pay out the whole position right now — takes what is withdrawable"
                    }
                    // A full exit only when the market can actually pay it all out;
                    // otherwise take what is withdrawable, as a plain partial.
                    onClick={() => setAmount(maxWithdrawable, canExitFully)}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={pct}
                onChange={(e) => setAmount((positionAmount * parseInt(e.target.value)) / 100)}
                className="w-full accent-yellow-500"
              />
              <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                <span className="text-[10px] text-text-tertiary">
                  {d.withdrawAll ? "Full position" : `${current.toFixed(4)} ${symbol}`}
                </span>
                <span className="text-[10px] text-text-tertiary">of {positionAmount.toFixed(4)}</span>
              </div>
              {exceedsLiquidity && (
                <div className="rounded-lg border border-error/20 bg-error/5 px-2 py-1.5 text-[10px] text-error">
                  Insufficient market liquidity — only{" "}
                  {liquidityAmount!.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol} can be withdrawn now
                </div>
              )}
            </div>

            <NodeImpact nodeId={id} />
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-yellow-500 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(LendWithdrawNodeComponent);
