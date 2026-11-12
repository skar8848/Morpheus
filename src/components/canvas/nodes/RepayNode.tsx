// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, useEdges, useNodes, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { formatUnits } from "viem";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { formatApy, formatUsd } from "@/lib/utils/format";
import { safeBigInt } from "@/lib/utils/bigint";
import { repayPullRaw } from "@/lib/canvas/executor";
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

  // What the bundle will actually withdraw is the stored raw figure, so that is
  // what the toggle shows (it can trail the live position by a few blocks).
  let storedCollateral = 0;
  try {
    storedCollateral = Number(BigInt(d.collateralToWithdraw ?? "0")) / 10 ** collateralDecimals;
  } catch { /* malformed raw amount: show 0 */ }
  const storedCollateralUsd =
    currentCollateral > 0 ? (currentCollateralUsd * storedCollateral) / currentCollateral : 0;

  const amount = parseFloat(d.amount || "0");
  const isFullRepay = currentDebt > 0 && amount >= currentDebt * 0.999;

  // What the bundle will pull from the wallet: the typed amount, or the debt plus
  // the 0.1% head-room for a full repay. Same figure the executor and the
  // approval use, so the warning can't disagree with what gets signed.
  const pullRaw = repayPullRaw(d);
  const loanAssets = useMemo(
    () => {
      if (!d.market) return [];
      const { symbol, address, decimals, logoURI } = d.market.loanAsset;
      return [{ symbol, name: symbol, address, decimals, logoURI }];
    },
    [d.market]
  );
  const { assetsWithBalances, isLoading: balanceLoading } = useTokenBalances(loanAssets);
  const walletRaw = assetsWithBalances[0]?.balanceRaw ?? 0n;

  // A repay fed by a swap or a withdraw is paid with what arrives during the run,
  // not with what the wallet holds now, so only a wallet-funded repay is checked.
  const edges = useEdges();
  const allNodes = useNodes();
  const fedByUpstream = edges.some(
    (e) => e.target === id && allNodes.find((n) => n.id === e.source)?.type !== "walletNode"
  );
  const exceedsBalance =
    !fedByUpstream && !balanceLoading && pullRaw > 0n && pullRaw > walletRaw;

  // Persist for edge rendering + the Execute button's insufficient-balance guard
  const prevExceedsRef = useRef(false);
  useEffect(() => {
    if (exceedsBalance !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsBalance;
      updateNodeData(id, { exceedsBalance });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exceedsBalance]);

  return (
    <NodeShell
      nodeType="repay"
      title="Repay"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      loading={loading}
      invalid={exceedsBalance}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-red-400 !bg-bg-card"
      />
      {/* Source handle: emits the freed collateral when withdrawCollateralAfterRepay is set.
          Downstream swap / borrow / lend / vaultDeposit nodes auto-pick up the asset. */}
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
              // The collateral to free is in the OLD market's collateral units:
              // carried over, the executor would withdraw a wstETH raw figure
              // as WBTC (1e18 vs 1e8) and downstream nodes would be fed it.
              updateNodeData(id, {
                market: pos?.market ?? null,
                amount: "",
                amountUsd: 0,
                repayAll: false,
                withdrawCollateralAfterRepay: false,
                collateralToWithdraw: undefined,
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
                    // Repay by shares so interest accrued before the bundle lands
                    // is cleared too, not left behind as dust debt.
                    repayAll: true,
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
                  repayAll: false,
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
          {d.repayAll && pullRaw > 0n && (
            <p className="mt-1 text-[10px] text-text-tertiary">
              Pulls up to {Number(formatUnits(pullRaw, d.market.loanAsset.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
              {d.market.loanAsset.symbol} (debt + 0.1% for interest until it lands); the unused part comes back in the same transaction.
            </p>
          )}
          {exceedsBalance && (
            <p className="mt-1 text-[10px] text-error">
              Exceeds wallet balance ({Number(formatUnits(walletRaw, d.market.loanAsset.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
              {d.market.loanAsset.symbol})
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
                      {storedCollateral.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-tertiary">
                      {d.market.collateralAsset.symbol}
                    </span>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-text-tertiary">
                    ≈ {formatUsd(storedCollateralUsd)}
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