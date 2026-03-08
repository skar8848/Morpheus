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

  const amount = parseFloat(d.amount || "0");

  return (
    <NodeShell
      nodeType="repay"
      title="Repay"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-red-400 !bg-bg-card"
      />

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
        </div>
      )}
    </NodeShell>
  );
}

export default memo(RepayNodeComponent);
