// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { formatApy, formatUsd } from "@/lib/utils/format";
import { safeBigInt } from "@/lib/utils/bigint";
import type { RepayNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function RepayNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { marketPositions, loading } = useUserPositions();
  const d = data as unknown as RepayNodeData;

  // Only markets where user has active borrows
  const borrowPositions = marketPositions.filter(
    (p) => p.state && p.state.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n
  );

  const marketOptions = useMemo(
    () =>
      borrowPositions.map((p) => ({
        value: p.market.uniqueKey,
        label: `${p.market.collateralAsset.symbol}/${p.market.loanAsset.symbol} — ${
          p.state?.borrowAssetsUsd ? formatUsd(p.state.borrowAssetsUsd) : "—"
        } debt`,
        icon: p.market.loanAsset.logoURI,
      })),
    [borrowPositions]
  );

  const selectedPosition = d.market
    ? borrowPositions.find((p) => p.market.uniqueKey === d.market!.uniqueKey)
    : null;
  const currentDebt = selectedPosition?.state?.borrowAssets
    ? Number(selectedPosition.state.borrowAssets) / 10 ** (d.market?.loanAsset.decimals ?? 18)
    : 0;
  const currentDebtUsd = selectedPosition?.state?.borrowAssetsUsd ?? 0;

  // Read the user's current collateral on this position so the
  // "withdraw collateral after repay" toggle can pre-fill the amount.
  const currentCollateralRaw = selectedPosition?.state?.collateral ?? "0";
  const collateralDecimals = d.market?.collateralAsset.decimals ?? 18;
  const currentCollateral =
    Number(currentCollateralRaw) / 10 ** collateralDecimals;
  const currentCollateralUsd = selectedPosition?.state?.collateralUsd ?? 0;

  const amount = parseFloat(d.amount || "0");
  const isFullRepay = currentDebt > 0 && amount >= currentDebt * 0.999;

  return (
    <NodeShell
      nodeType="repay"
      title="Repay"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      loading={loading}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-red-400 !bg-bg-card"
      />
      {/* Source handle: emits the freed collateral when withdrawCollateralAfterRepay is set.
          Downstream swap / supplyCollateral / vaultDeposit nodes auto-pick up the asset. */}
      {d.withdrawCollateralAfterRepay && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-red-400 !bg-bg-card"
        />
      )}

      {/* Market selector */}
      <div className="mb-3">
        <label className="mb-1 block text-[10px] text-text-tertiary">Market</label>
        {loading ? (
          <div className="h-8 animate-pulse rounded-lg bg-bg-secondary" />
        ) : marketOptions.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">No active borrows</p>
        ) : (
          <SearchSelect
            options={marketOptions}
            value={d.market?.uniqueKey ?? ""}
            onChange={(val) => {
              const pos = borrowPositions.find((p) => p.market.uniqueKey === val);
              updateNodeData(id, {
                market: pos?.market ?? null,
                amount: "",
                amountUsd: 0,
              });
            }}
            placeholder="Select borrow to repay..."
          />
        )}
      </div>

      {/* Current debt */}
      {d.market && selectedPosition && (
        <div className="mb-3 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-tertiary">Current debt</span>
            <span className="font-medium text-text-primary">
              {currentDebt.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
              {d.market.loanAsset.symbol}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-tertiary">Value</span>
            <span className="text-text-secondary">{formatUsd(currentDebtUsd)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-tertiary">Borrow APY</span>
            <span className={d.market.state.netBorrowApy < 0 ? "text-success" : "text-error"}>
              {formatApy(d.market.state.netBorrowApy)}
            </span>
          </div>
        </div>
      )}

      {/* Amount input */}
      {d.market && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">Amount to repay</label>
            {currentDebt > 0 && (
              <button
                onClick={() =>
                  updateNodeData(id, {
                    amount: currentDebt.toFixed(
                      d.market!.loanAsset.decimals > 6 ? 8 : 6
                    ),
                    amountUsd: currentDebtUsd,
                    // Full repay → auto-enable the withdraw collateral
                    // step so the user gets their collateral back.
                    withdrawCollateralAfterRepay: currentCollateral > 0,
                    collateralToWithdraw: currentCollateralRaw,
                  })
                }
                className="text-[9px] text-brand hover:underline"
              >
                MAX
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5">
            {d.market.loanAsset.logoURI && (
              <Image
                src={d.market.loanAsset.logoURI}
                alt=""
                width={14}
                height={14}
                className="rounded-full"
                unoptimized
              />
            )}
            <input
              type="number"
              value={d.amount}
              onChange={(e) => {
                const val = e.target.value;
                const price = currentDebt > 0 ? currentDebtUsd / currentDebt : 0;
                const usd = parseFloat(val || "0") * price;
                updateNodeData(id, {
                  amount: val,
                  amountUsd: isFinite(usd) ? usd : 0,
                });
              }}
              placeholder="0.00"
              className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
              step="any"
              min="0"
            />
            <span className="shrink-0 text-[10px] text-text-tertiary">
              {d.market.loanAsset.symbol}
            </span>
          </div>
          {amount > 0 && (
            <p className="mt-1 text-right text-[10px] text-text-tertiary">
              ≈ {formatUsd(d.amountUsd)}
            </p>
          )}

          {/* Withdraw collateral toggle — only shown when fully repaying or already enabled */}
          {currentCollateral > 0 && (isFullRepay || d.withdrawCollateralAfterRepay) && (
            <div className="mt-2.5 border-t border-border pt-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.withdrawCollateralAfterRepay ?? false}
                  onChange={(e) =>
                    updateNodeData(id, {
                      withdrawCollateralAfterRepay: e.target.checked,
                      collateralToWithdraw: e.target.checked
                        ? currentCollateralRaw
                        : undefined,
                    })
                  }
                  className="h-3 w-3 accent-red-400"
                />
                <span className="flex-1 text-[10px] font-medium text-text-primary">
                  Free collateral
                </span>
              </label>

              {/* Token amount + USD — same layout as the repay amount above */}
              {d.withdrawCollateralAfterRepay && d.market.collateralAsset && (
                <>
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5">
                    {d.market.collateralAsset.logoURI && (
                      <Image
                        src={d.market.collateralAsset.logoURI}
                        alt=""
                        width={14}
                        height={14}
                        className="rounded-full"
                        unoptimized
                      />
                    )}
                    <span className="flex-1 text-xs text-text-primary">
                      {currentCollateral.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-tertiary">
                      {d.market.collateralAsset.symbol}
                    </span>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-text-tertiary">
                    ≈ {formatUsd(currentCollateralUsd)}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </NodeShell>
  );
}

export default memo(RepayNodeComponent);