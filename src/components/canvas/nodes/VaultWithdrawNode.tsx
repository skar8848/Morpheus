"use client";

import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { formatApy, formatUsd, formatTokenAmount } from "@/lib/utils/format";
import { safeBigInt } from "@/lib/utils/bigint";
import type { VaultWithdrawNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function VaultWithdrawNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { vaultPositions, loading } = useUserPositions();
  const d = data as unknown as VaultWithdrawNodeData;

  const activeVaults = vaultPositions.filter(
    (p) => p.state && safeBigInt(p.state.shares) > 0n
  );

  const positionOptions = useMemo(
    () =>
      activeVaults.map((v) => ({
        value: v.vault.address,
        label: `${v.vault.name} — ${v.state?.assetsUsd ? formatUsd(v.state.assetsUsd) : v.state?.assets ? formatTokenAmount(v.state.assets, v.vault.asset.decimals) : "—"}`,
        icon: v.vault.asset.logoURI,
      })),
    [activeVaults]
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
          {loading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={positionOptions}
              value={d.position?.vault.address ?? ""}
              onChange={(addr) => {
                const pos = activeVaults.find((v) => v.vault.address === addr) ?? null;
                updateNodeData(id, { position: pos });
              }}
              placeholder="Search position..."
            />
          )}
        </div>

        {/* Position info */}
        {d.position && (
          <>
            <div className="space-y-1 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Image
                  src={d.position.vault.asset.logoURI}
                  alt={d.position.vault.asset.symbol}
                  width={16}
                  height={16}
                  className="rounded-full"
                  unoptimized
                />
                <span className="text-xs font-medium text-text-primary">
                  {d.position.vault.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">Asset</span>
                <div className="flex items-center gap-1">
                  <Image
                    src={d.position.vault.asset.logoURI}
                    alt={d.position.vault.asset.symbol}
                    width={12}
                    height={12}
                    className="rounded-full"
                    unoptimized
                  />
                  <span className="text-xs text-text-primary">
                    {d.position.vault.asset.symbol}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">Balance</span>
                <span className="text-xs text-text-secondary">
                  {d.position.state?.assetsUsd
                    ? formatUsd(d.position.state.assetsUsd)
                    : d.position.state?.assets
                      ? `${formatTokenAmount(d.position.state.assets, d.position.vault.asset.decimals)} ${d.position.vault.asset.symbol}`
                      : "—"}
                </span>
              </div>
              {d.position.vault.state?.netApy !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">APY</span>
                  <span className="text-xs font-medium text-success">
                    {formatApy(d.position.vault.state.netApy)}
                  </span>
                </div>
              )}
            </div>

            {/* Withdraw amount — slider + input */}
            <div className="nodrag space-y-1">
              {(() => {
                const maxRaw = d.position?.state?.assets
                  ? Number(d.position.state.assets) / 10 ** d.position.vault.asset.decimals
                  : 0;
                const current = parseFloat(d.amount || "0");
                const pct = maxRaw > 0 ? Math.round((current / maxRaw) * 100) : 0;

                return (
                  <>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-text-tertiary">
                        Withdraw Amount
                      </label>
                      <div className="flex items-center gap-1">
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={pct}
                            onChange={(e) => {
                              const p = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                              updateNodeData(id, { amount: ((maxRaw * p) / 100).toFixed(6) });
                            }}
                            className="w-10 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="text-xs text-text-tertiary">%</span>
                        </div>
                        <button
                          className="ml-1 text-[10px] text-brand hover:text-brand-hover"
                          onClick={() => updateNodeData(id, { amount: maxRaw.toFixed(6) })}
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
                      onChange={(e) => {
                        const p = parseInt(e.target.value);
                        updateNodeData(id, { amount: ((maxRaw * p) / 100).toFixed(6) });
                      }}
                      className="w-full accent-orange-400"
                    />
                    <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                      <span className="text-[10px] text-text-tertiary">
                        {current.toFixed(4)} {d.position?.vault.asset.symbol ?? ""}
                      </span>
                      <span className="text-[10px] text-text-tertiary">
                        of {maxRaw.toFixed(4)}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-orange-400 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(VaultWithdrawNodeComponent);
