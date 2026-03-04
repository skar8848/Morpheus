"use client";

import { memo, useMemo, useState } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useVaults } from "@/lib/hooks/useVaults";
import { formatApy, formatUsd } from "@/lib/utils/format";
import type { VaultDepositNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

type SortKey = "tvl" | "apy" | "curator";

interface UpstreamSource {
  nodeId: string;
  label: string; // e.g. "wstETH → EURC"
  borrowAmount: number;
  loanAddress: string;
}

function VaultDepositNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as VaultDepositNodeData;
  const edges = useEdges();
  const allNodes = useNodes();

  const [sortBy, setSortBy] = useState<SortKey>("tvl");

  // Find ALL upstream sources (borrow + swap nodes)
  const upstreamSources = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    const sources: UpstreamSource[] = [];
    let loanAddr: string | null = null;

    for (const edge of incomingEdges) {
      const sourceNode = allNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;

      const sd = sourceNode.data as Record<string, unknown>;

      if (sd.type === "borrow") {
        const market = sd.market as {
          loanAsset?: { address: string; symbol?: string };
          collateralAsset?: { symbol?: string };
        } | null;
        const borrowAmt = (sd.borrowAmount as number) ?? 0;
        const collSymbol = market?.collateralAsset?.symbol ?? "?";
        const loanSymbol = market?.loanAsset?.symbol ?? "?";
        const addr = market?.loanAsset?.address ?? null;

        if (addr) {
          loanAddr = addr;
          sources.push({
            nodeId: sourceNode.id,
            label: `${collSymbol} → ${loanSymbol}`,
            borrowAmount: borrowAmt,
            loanAddress: addr,
          });
        }
      }

      if (sd.type === "swap") {
        const tokenOut = sd.tokenOut as { address: string; symbol?: string } | null;
        if (tokenOut?.address) {
          loanAddr = tokenOut.address;
          sources.push({
            nodeId: sourceNode.id,
            label: `Swap → ${tokenOut.symbol ?? "?"}`,
            borrowAmount: 0,
            loanAddress: tokenOut.address,
          });
        }
      }
    }

    return { sources, connectedLoanAddress: loanAddr };
  }, [edges, allNodes, id]);

  const { sources, connectedLoanAddress } = upstreamSources;
  const hasBorrowUpstream = sources.some((s) => s.borrowAmount > 0);

  // Fetch vaults filtered by the connected loan asset
  const vaultAssetAddresses = useMemo(
    () => (connectedLoanAddress ? [connectedLoanAddress] : []),
    [connectedLoanAddress]
  );
  const { vaults: filteredVaults, loading: vaultsLoading } = useVaults(vaultAssetAddresses);

  // Sort vaults
  const sortedVaults = useMemo(() => {
    const v = [...filteredVaults];
    switch (sortBy) {
      case "apy":
        return v.sort((a, b) => b.state.netApy - a.state.netApy);
      case "tvl":
        return v.sort(
          (a, b) => (b.state.totalAssetsUsd ?? 0) - (a.state.totalAssetsUsd ?? 0)
        );
      case "curator":
        return v.sort((a, b) =>
          (a.state.curator ?? "zzz").localeCompare(b.state.curator ?? "zzz")
        );
      default:
        return v;
    }
  }, [filteredVaults, sortBy]);

  const vaultOptions = useMemo(
    () =>
      sortedVaults.map((v) => ({
        value: v.address,
        label: `${v.name} — ${formatApy(v.state.netApy)}`,
      })),
    [sortedVaults]
  );

  // Per-source allocation percentages
  const allocPcts = d.allocPcts ?? {};
  const getSourcePct = (nodeId: string) => allocPcts[nodeId] ?? 100;

  // Compute per-source deposit amounts + total
  const sourceDeposits = sources
    .filter((s) => s.borrowAmount > 0)
    .map((s) => ({
      ...s,
      pct: getSourcePct(s.nodeId),
      depositAmount: (s.borrowAmount * getSourcePct(s.nodeId)) / 100,
    }));
  const totalDeposit = sourceDeposits.reduce((sum, s) => sum + s.depositAmount, 0);

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <NodeShell
      nodeType="vaultDeposit"
      title="Vault Deposit"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <div className="space-y-2">
        {/* Hint when not connected */}
        {!connectedLoanAddress && (
          <div className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[10px] text-text-tertiary">
            Connect a Borrow or Swap node to filter vaults by asset
          </div>
        )}

        {/* Sort buttons */}
        {connectedLoanAddress && !vaultsLoading && sortedVaults.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-text-tertiary mr-1">Sort:</span>
            {(["tvl", "apy", "curator"] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase transition-colors ${
                  sortBy === key
                    ? "bg-brand/15 text-brand"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        )}

        {/* Vault selector */}
        {connectedLoanAddress && (
          <div>
            <label className="text-[10px] text-text-tertiary">Vault</label>
            {vaultsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={vaultOptions}
                value={d.vault?.address ?? ""}
                onChange={(addr) => {
                  const vault = sortedVaults.find((v) => v.address === addr) ?? null;
                  updateNodeData(id, { vault });
                }}
                placeholder="Search vault..."
              />
            )}
          </div>
        )}

        {/* Selected vault info */}
        {d.vault && (
          <>
            <div className="space-y-1 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Image
                  src={d.vault.asset.logoURI}
                  alt={d.vault.asset.symbol}
                  width={16}
                  height={16}
                  className="rounded-full"
                  unoptimized
                />
                <span className="text-xs font-medium text-text-primary">
                  {d.vault.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">APY</span>
                <span className="text-xs font-medium text-success">
                  {formatApy(d.vault.state.netApy)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">TVL</span>
                <span className="text-xs text-text-secondary">
                  {d.vault.state.totalAssetsUsd
                    ? formatUsd(d.vault.state.totalAssetsUsd)
                    : "—"}
                </span>
              </div>
              {d.vault.state.curator && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">Curator</span>
                  <span className="font-mono text-[10px] text-text-tertiary">
                    {truncateAddress(d.vault.state.curator)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">Fee</span>
                <span className="text-xs text-text-secondary">
                  {(d.vault.state.fee * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">Markets</span>
                <span className="text-xs text-text-secondary">
                  {d.vault.state.allocation.length}
                </span>
              </div>
            </div>

            {/* Amount — multi-source sliders when borrow upstream, manual otherwise */}
            {hasBorrowUpstream ? (
              <div className="nodrag space-y-2">
                {sourceDeposits.map((src) => {
                  const handlePctChange = (pct: number) => {
                    const clamped = Math.max(0, Math.min(100, pct));
                    const newAllocPcts = { ...allocPcts, [src.nodeId]: clamped };
                    const newTotal = sources
                      .filter((s) => s.borrowAmount > 0)
                      .reduce((sum, s) => {
                        const p = s.nodeId === src.nodeId ? clamped : getSourcePct(s.nodeId);
                        return sum + (s.borrowAmount * p) / 100;
                      }, 0);
                    updateNodeData(id, {
                      allocPcts: newAllocPcts,
                      amount: newTotal.toFixed(6),
                    });
                  };

                  return (
                    <div key={src.nodeId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-text-tertiary">
                          {src.label}
                        </label>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={src.pct}
                            onChange={(e) => handlePctChange(parseInt(e.target.value) || 0)}
                            className="w-10 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="text-xs text-text-tertiary">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={src.pct}
                        onChange={(e) => handlePctChange(parseInt(e.target.value))}
                        className="w-full accent-purple-400"
                      />
                      <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                        <span className="text-[10px] text-text-tertiary">
                          {src.depositAmount.toFixed(4)} {d.vault?.asset.symbol ?? ""}
                        </span>
                        <span className="text-[10px] text-text-tertiary">
                          of {src.borrowAmount.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Unified total */}
                <div className="flex items-center justify-between rounded-lg border border-purple-400/30 bg-purple-400/5 px-2 py-1.5">
                  <span className="text-[10px] font-medium text-purple-300">
                    Total Deposit
                  </span>
                  <span className="text-xs font-semibold text-text-primary">
                    {totalDeposit.toFixed(4)} {d.vault?.asset.symbol ?? ""}
                  </span>
                </div>
              </div>
            ) : (
              <div className="nodrag">
                <label className="text-[10px] text-text-tertiary">Amount</label>
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
            )}
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-purple-400 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(VaultDepositNodeComponent);
