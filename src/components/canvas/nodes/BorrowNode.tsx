// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useLoanAssets } from "@/lib/hooks/useLoanAssets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { formatApy, formatLltv } from "@/lib/utils/format";
import { getNodeChainId } from "@/lib/canvas/bridge";
import type { BorrowNodeData, CanvasNode } from "@/lib/canvas/types";
import type { SupportedChainId } from "@/lib/web3/chains";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

/** Market utilization donut, à la Morpho — borrowed / supplied. */
function UtilizationRing({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(1, pct));
  const r = 6;
  const c = 2 * Math.PI * r;
  // Green under 80%, amber 80–95%, red above — high utilization = thin liquidity
  const color = p > 0.95 ? "#eb365a" : p > 0.8 ? "#f5a623" : "#02c77b";
  return (
    <div
      className="flex items-center"
      title={`Market utilization ${(p * 100).toFixed(1)}%`}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" className="-rotate-90">
        <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-bg-card" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${p * c} ${c}`}
        />
      </svg>
    </div>
  );
}

function BorrowNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as BorrowNodeData;
  const edges = useEdges();
  const nodes = useNodes();

  // Find ALL collateral inputs — sum amounts from multiple SupplyCollateral nodes
  const { connectedCollateralAddress, connectedAmount, collateralSources } = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    if (incomingEdges.length === 0)
      return { connectedCollateralAddress: null, connectedAmount: 0, collateralSources: [] };

    type Source = { nodeId: string; label: string; amount: number };
    const sources: Source[] = [];
    let collateralAddr: string | null = null;

    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const sd = sourceNode.data as {
        type?: string;
        asset?: { address: string; symbol: string } | null;
        amount?: string;
      };
      if (sd.type === "supplyCollateral" && sd.asset) {
        collateralAddr = sd.asset.address;
        sources.push({
          nodeId: sourceNode.id,
          label: `Supply ${sd.asset.symbol}`,
          amount: parseFloat(sd.amount || "0"),
        });
      }
    }

    const total = sources.reduce((sum, s) => sum + s.amount, 0);
    return { connectedCollateralAddress: collateralAddr, connectedAmount: total, collateralSources: sources };
  }, [edges, nodes, id]);

  // Fetch real prices for collateral + loan assets
  const priceAddresses = useMemo(() => {
    const addrs: string[] = [];
    if (connectedCollateralAddress) addrs.push(connectedCollateralAddress);
    if (d.market?.loanAsset?.address) addrs.push(d.market.loanAsset.address);
    return addrs;
  }, [connectedCollateralAddress, d.market?.loanAsset?.address]);
  const { prices } = useAssetPrices(priceAddresses);
  const collateralPrice = connectedCollateralAddress
    ? prices[connectedCollateralAddress.toLowerCase()] ?? 0
    : 0;
  const connectedAmountUsd = connectedAmount * collateralPrice;

  // Loan asset price — needed to convert USD borrow amount to token amount
  const loanAssetPrice = d.market?.loanAsset?.address
    ? prices[d.market.loanAsset.address.toLowerCase()] ?? 0
    : 0;

  // Auto-sync collateral USD from connected supply node
  useEffect(() => {
    if (connectedAmountUsd > 0 && connectedAmountUsd !== d.depositAmountUsd) {
      updateNodeData(id, { depositAmountUsd: connectedAmountUsd });
    }
  }, [connectedAmountUsd]);

  // Reset borrow selections when collateral asset changes
  const prevCollateralRef = useRef(connectedCollateralAddress);
  useEffect(() => {
    if (
      prevCollateralRef.current !== null &&
      connectedCollateralAddress !== prevCollateralRef.current
    ) {
      updateNodeData(id, {
        loanAssetAddress: undefined,
        market: null,
        borrowAmount: 0,
        borrowAmountUsd: 0,
        healthFactor: null,
        ltvPercent: 50,
      });
    }
    prevCollateralRef.current = connectedCollateralAddress;
  }, [connectedCollateralAddress]);

  // Effective chain: home chain, or the bridge's destination chain if this
  // borrow sits downstream of a bridge — so we propose markets on that chain.
  const nodeChainId = useMemo(
    () => getNodeChainId(id, nodes as CanvasNode[], edges, chainId as SupportedChainId),
    [id, nodes, edges, chainId]
  );

  // Fetch loan assets for this collateral
  const collateralAddresses = useMemo(
    () => (connectedCollateralAddress ? [connectedCollateralAddress] : []),
    [connectedCollateralAddress]
  );
  const { loanAssets, loading: loanAssetsLoading } = useLoanAssets(collateralAddresses, nodeChainId);

  const selectedLoanAddress = (d as unknown as { loanAssetAddress?: string }).loanAssetAddress;

  // Fetch markets filtered by collateral + loan asset
  const loanAddresses = useMemo(
    () => (selectedLoanAddress ? [selectedLoanAddress] : []),
    [selectedLoanAddress]
  );
  const { markets, loading: marketsLoading } = useMarkets(collateralAddresses, loanAddresses, nodeChainId);

  // Compute borrow amount + HF reactively from LTV
  // borrowAmountUsd = USD value, borrowAmount = token amount (for executor)
  const depositUsd = d.depositAmountUsd || connectedAmountUsd;
  useEffect(() => {
    if (!d.market || depositUsd <= 0) {
      if (d.borrowAmount !== 0) {
        updateNodeData(id, { borrowAmount: 0, borrowAmountUsd: 0, healthFactor: null });
      }
      return;
    }

    const lltv = Number(d.market.lltv) / 1e18;
    const maxBorrowUsd = depositUsd * lltv;
    const targetBorrowUsd = (depositUsd * d.ltvPercent) / 100;
    const borrowUsd = Math.min(targetBorrowUsd, maxBorrowUsd * 0.99);
    const hf = borrowUsd > 0 ? (depositUsd * lltv) / borrowUsd : null;

    // Convert from USD to token amount using the loan asset's price
    const borrowTokens = loanAssetPrice > 0 ? borrowUsd / loanAssetPrice : 0;

    updateNodeData(id, {
      borrowAmount: borrowTokens,
      borrowAmountUsd: borrowUsd,
      healthFactor: hf,
    });
  }, [d.market?.uniqueKey, d.ltvPercent, depositUsd, loanAssetPrice]);

  // Market liquidity check — use LIVE data from useMarkets, not the stale d.market snapshot
  const availableLiquidity = useMemo(() => {
    if (!d.market) return null;
    // Find the live version of the selected market
    const liveMarket = markets.find((m) => m.uniqueKey === d.market!.uniqueKey);
    const liquidityStr = liveMarket?.state?.liquidityAssets ?? d.market.state?.liquidityAssets;
    if (!liquidityStr) return null;
    const raw = Number(liquidityStr);
    if (!isFinite(raw) || raw <= 0) return 0;
    return raw / 10 ** d.market.loanAsset.decimals;
  }, [d.market, markets]);
  const exceedsLiquidity = availableLiquidity !== null && d.borrowAmount > 0 && d.borrowAmount > availableLiquidity;

  // Persist to node data so edges + ExecuteButton can read it
  const prevExceedsRef = useRef(false);
  useEffect(() => {
    if (exceedsLiquidity !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsLiquidity;
      updateNodeData(id, { exceedsLiquidity });
    }
  }, [exceedsLiquidity]);

  const hfColor = (hf: number | null) => {
    if (hf === null) return "text-text-tertiary";
    if (hf > 2) return "text-success";
    if (hf > 1.2) return "text-yellow-400";
    return "text-error";
  };

  // Desired-HF input. HF = LLTV% / LTV% (prices cancel), so a target HF maps
  // to LTV% = LLTV% / HF. Kept as a local draft while focused so the reactive
  // HF (derived from ltvPercent) doesn't fight the user's typing.
  const [hfFocused, setHfFocused] = useState(false);
  const [hfDraft, setHfDraft] = useState("");
  useEffect(() => {
    if (!hfFocused) setHfDraft(d.healthFactor ? d.healthFactor.toFixed(2) : "");
  }, [d.healthFactor, hfFocused]);
  const applyHf = (raw: string) => {
    const hf = parseFloat(raw);
    if (!d.market || !isFinite(hf) || hf <= 0) return;
    const lltvPct = (Number(d.market.lltv) / 1e18) * 100;
    const ltv = Math.round(lltvPct / hf);
    updateNodeData(id, { ltvPercent: Math.max(0, Math.min(Math.floor(lltvPct), ltv)) });
  };

  // SearchSelect options
  const loanOptions = useMemo(
    () => loanAssets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    [loanAssets]
  );
  const marketOptions = useMemo(
    () =>
      markets.map((m) => ({
        value: m.uniqueKey,
        label: `${m.collateralAsset.symbol}/${m.loanAsset.symbol} — LLTV ${formatLltv(m.lltv)} — ${formatApy(Math.abs(m.state.netBorrowApy))}`,
        icon: m.loanAsset.logoURI,
      })),
    [markets]
  );

  return (
    <NodeShell
      nodeType="borrow"
      title="Borrow"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsLiquidity}
      loading={loanAssetsLoading || marketsLoading}
    >
      <div className="space-y-2">
        {/* No connection hint */}
        {!connectedCollateralAddress && (
          <div className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[10px] text-text-tertiary">
            Connect a Supply Collateral node to see available markets
          </div>
        )}

        {/* Step 1: Pick loan asset */}
        {connectedCollateralAddress && (
          <div>
            <label className="text-[10px] text-text-tertiary">Borrow Asset</label>
            {loanAssetsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={loanOptions}
                value={selectedLoanAddress ?? ""}
                onChange={(v) => updateNodeData(id, { loanAssetAddress: v, market: null })}
                placeholder="Search asset..."
              />
            )}
          </div>
        )}

        {/* Step 2: Pick market */}
        {selectedLoanAddress && (
          <div>
            <label className="text-[10px] text-text-tertiary">Market</label>
            {marketsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={marketOptions}
                value={d.market?.uniqueKey ?? ""}
                onChange={(v) => {
                  const market = markets.find((m) => m.uniqueKey === v) ?? null;
                  updateNodeData(id, { market });
                }}
                placeholder="Search market..."
              />
            )}
          </div>
        )}

        {/* Selected market info + slider */}
        {d.market && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="relative flex items-center">
                <Image
                  src={d.market.collateralAsset.logoURI}
                  alt={d.market.collateralAsset.symbol}
                  width={14}
                  height={14}
                  className="rounded-full"
                  unoptimized
                />
                <Image
                  src={d.market.loanAsset.logoURI}
                  alt={d.market.loanAsset.symbol}
                  width={14}
                  height={14}
                  className="-ml-1.5 rounded-full ring-1 ring-bg-card"
                  unoptimized
                />
              </div>
              <span className="text-xs text-text-primary">
                {d.market.collateralAsset.symbol}/{d.market.loanAsset.symbol}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {(() => {
                  const supply = Number(d.market.state.supplyAssets);
                  const borrow = Number(d.market.state.borrowAssets);
                  if (!isFinite(supply) || supply <= 0) return null;
                  return <UtilizationRing pct={borrow / supply} />;
                })()}
                <span className={`text-[10px] ${d.market.state.netBorrowApy <= 0 ? "text-success" : "text-error"}`}>
                  {formatApy(Math.abs(d.market.state.netBorrowApy))}
                </span>
              </div>
            </div>

            {/* Collateral value (auto-filled from supply) */}
            {collateralSources.length > 1 && (
              <div className="space-y-0.5 rounded-lg bg-bg-secondary px-2 py-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Collateral Sources</span>
                {collateralSources.map((s) => (
                  <div key={s.nodeId} className="flex items-center justify-between">
                    <span className="text-[10px] text-text-tertiary">{s.label}</span>
                    <span className="text-[10px] text-text-secondary">
                      ${(s.amount * collateralPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-0.5">
                  <span className="text-[10px] font-medium text-text-tertiary">Total</span>
                  <span className="text-[10px] font-medium text-text-primary">
                    ${depositUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}
            {collateralSources.length <= 1 && (
              <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
                <span className="text-[10px] text-text-tertiary">Collateral</span>
                <span className="text-xs font-medium text-text-primary">
                  ${depositUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {/* LTV slider — nodrag prevents node dragging */}
            <div className="nodrag">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-text-tertiary">Target LTV</label>
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min={0}
                    max={Math.floor((Number(d.market.lltv) / 1e18) * 100)}
                    value={d.ltvPercent}
                    onChange={(e) => {
                      const max = Math.floor((Number(d.market!.lltv) / 1e18) * 100);
                      const val = Math.max(0, Math.min(max, parseInt(e.target.value) || 0));
                      updateNodeData(id, { ltvPercent: val });
                    }}
                    className="w-10 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-text-tertiary">%</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.floor((Number(d.market.lltv) / 1e18) * 100)}
                value={d.ltvPercent}
                onChange={(e) =>
                  updateNodeData(id, { ltvPercent: parseInt(e.target.value) })
                }
                className="mt-1 w-full accent-brand"
              />
              <div className="flex justify-between text-[9px] text-text-tertiary">
                <span>0%</span>
                <span>LLTV {formatLltv(d.market.lltv)}</span>
              </div>

              {/* Target HF — inverse of the LTV, so you can pin a health factor */}
              <div className="mt-1.5 flex items-center justify-between">
                <label className="text-[10px] text-text-tertiary">Target HF</label>
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  value={hfDraft}
                  placeholder="—"
                  onFocus={() => setHfFocused(true)}
                  onBlur={() => setHfFocused(false)}
                  onChange={(e) => {
                    setHfDraft(e.target.value);
                    applyHf(e.target.value);
                  }}
                  className="w-14 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>

            {/* Borrow amount + HF + live liquidation distance */}
            <div className={`rounded-lg px-2 py-1.5 ${exceedsLiquidity ? "border border-error/30 bg-error/5" : "bg-bg-secondary"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-text-tertiary">Borrow</span>
                  <p className="text-xs font-medium text-text-primary">
                    {d.borrowAmount > 0
                      ? `${d.borrowAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${d.market.loanAsset.symbol}`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-text-tertiary">
                    ${d.borrowAmountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-text-tertiary">HF</span>
                  <p className={`text-xs font-semibold ${hfColor(d.healthFactor)}`}>
                    {d.healthFactor ? d.healthFactor.toFixed(2) : "—"}
                  </p>
                </div>
              </div>

              {/* Live distance-to-liquidation gauge */}
              {d.borrowAmount > 0 && d.market.lltv && (() => {
                // distance to liquidation in price drop %
                // Liq price = current × (LTV / LLTV); drop% = 1 - LTV/LLTV
                const lltvPct = (Number(d.market.lltv) / 1e18) * 100;
                if (lltvPct === 0) return null;
                const dropPct = Math.max(0, (1 - d.ltvPercent / lltvPct) * 100);
                // Color thresholds: > 30% safe, 15-30% caution, < 15% risky
                const dropColor =
                  dropPct > 30
                    ? "text-success"
                    : dropPct > 15
                      ? "text-yellow-400"
                      : "text-error";
                const trackPct = Math.max(0, Math.min(100, dropPct));
                const barColor =
                  dropPct > 30
                    ? "bg-success"
                    : dropPct > 15
                      ? "bg-yellow-400"
                      : "bg-error";
                // Price at which this position gets liquidated:
                // liqPrice = currentPrice × (LTV / LLTV) = currentPrice × (1 − drop)
                const liqPrice = collateralPrice > 0 ? collateralPrice * (1 - dropPct / 100) : null;
                return (
                  <div className="mt-1.5 border-t border-border/40 pt-1.5">
                    <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                      <span>Liquidation buffer</span>
                      <span className={`font-semibold ${dropColor}`}>
                        −{dropPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative mt-0.5 h-1 overflow-hidden rounded-full bg-bg-card/60">
                      <div
                        className={`absolute left-0 top-0 h-full transition-all ${barColor}`}
                        style={{ width: `${trackPct}%` }}
                      />
                    </div>
                    {liqPrice !== null && (
                      <div className="mt-1 flex items-center justify-between text-[9px] text-text-tertiary">
                        <span>Liq. price</span>
                        <span className="font-medium text-text-secondary">
                          ${liqPrice.toLocaleString(undefined, {
                            maximumFractionDigits: liqPrice < 10 ? 4 : 2,
                          })}{" "}
                          <span className="text-text-tertiary">{d.market!.collateralAsset.symbol}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Liquidity warning */}
            {exceedsLiquidity && (
              <div className="rounded-lg border border-error/20 bg-error/5 px-2 py-1.5 text-[10px] text-error">
                Insufficient liquidity — only {availableLiquidity!.toLocaleString(undefined, { maximumFractionDigits: 4 })} {d.market.loanAsset.symbol} available
              </div>
            )}
            {availableLiquidity !== null && !exceedsLiquidity && d.borrowAmount > 0 && (
              <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                <span>Available liquidity</span>
                <span>{availableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {d.market.loanAsset.symbol}</span>
              </div>
            )}
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-success !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-success !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(BorrowNodeComponent);