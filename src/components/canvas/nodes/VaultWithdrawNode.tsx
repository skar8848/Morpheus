"use client";

import { memo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { formatApy, formatUsd, formatTokenAmount } from "@/lib/utils/format";
import type { VaultWithdrawNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";

function VaultWithdrawNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { vaultPositions, loading } = useUserPositions();
  const d = data as unknown as VaultWithdrawNodeData;

  const activeVaults = vaultPositions.filter(
    (p) => p.state && BigInt(p.state.shares) > 0n
  );

  return (
    <NodeShell
      nodeType="vaultWithdraw"
      title="Vault Withdraw"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <div className="space-y-2">
        {/* Position selector */}
        <div>
          <label className="text-[10px] text-text-tertiary">Position</label>
          <select
            className="mt-0.5 w-full rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none"
            value={d.position?.vault.address ?? ""}
            onChange={(e) => {
              const pos =
                activeVaults.find((v) => v.vault.address === e.target.value) ??
                null;
              updateNodeData(id, { position: pos });
            }}
          >
            <option value="">Select position...</option>
            {activeVaults.map((v) => (
              <option key={v.vault.address} value={v.vault.address}>
                {v.vault.name} —{" "}
                {v.state?.assetsUsd
                  ? formatUsd(v.state.assetsUsd)
                  : v.state?.assets
                    ? formatTokenAmount(v.state.assets, v.vault.asset.decimals)
                    : "—"}
              </option>
            ))}
          </select>
          {loading && (
            <div className="mt-1 h-4 animate-pulse rounded bg-bg-secondary" />
          )}
        </div>

        {/* Position info */}
        {d.position && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-bg-secondary px-2 py-1.5">
              <Image
                src={d.position.vault.asset.logoURI}
                alt={d.position.vault.asset.symbol}
                width={16}
                height={16}
                className="rounded-full"
                unoptimized
              />
              <div className="flex-1">
                <span className="text-xs text-text-primary">
                  {d.position.vault.name}
                </span>
                <p className="text-[10px] text-text-tertiary">
                  Balance:{" "}
                  {d.position.state?.assetsUsd
                    ? formatUsd(d.position.state.assetsUsd)
                    : "—"}
                </p>
              </div>
            </div>

            {/* Withdraw amount */}
            <div className="nodrag">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-text-tertiary">
                  Withdraw Amount
                </label>
                <button
                  className="text-[10px] text-brand hover:text-brand-hover"
                  onClick={() => {
                    const max = d.position?.state?.assets
                      ? (
                          Number(d.position.state.assets) /
                          10 ** d.position.vault.asset.decimals
                        ).toFixed(6)
                      : "0";
                    updateNodeData(id, { amount: max });
                  }}
                >
                  MAX
                </button>
              </div>
              <input
                type="number"
                placeholder="0.00"
                className="mt-0.5 w-full rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={d.amount}
                onChange={(e) =>
                  updateNodeData(id, { amount: e.target.value })
                }
              />
            </div>
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-orange-400 !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-orange-400 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(VaultWithdrawNodeComponent);
