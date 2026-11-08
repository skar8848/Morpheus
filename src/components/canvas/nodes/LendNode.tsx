// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useAllAssets } from "@/lib/hooks/useAllAssets";
import { useLendMarkets } from "@/lib/hooks/useLendMarkets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { formatApy, formatLltv, formatUsd } from "@/lib/utils/format";
import { getNodeChainId } from "@/lib/canvas/bridge";
import { collectUpstream, findLinkableProducers } from "@/lib/canvas/upstream";
import { CHAIN_CONFIGS, type SupportedChainId } from "@/lib/web3/chains";
import { VALID_CONNECTIONS, type LendNodeData, type CanvasNode } from "@/lib/canvas/types";
import type { Asset } from "@/lib/graphql/types";
import NodeShell from "./NodeShell";
import NodeImpact from "./NodeImpact";
import SearchSelect from "./SearchSelect";
import ChainIcon from "../ChainIcon";

/** Markets below this size are hidden: their APY is noise, and exit liquidity is a rounding error. */
const MIN_MARKET_TVL_USD = 10_000;
/** Above this utilisation a withdrawal can be blocked until borrowers repay. */
const HIGH_UTILIZATION = 0.95;

function UtilizationRing({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(1, pct));
  const r = 6;
  const c = 2 * Math.PI * r;
  const color = p > HIGH_UTILIZATION ? "#eb365a" : p > 0.8 ? "#f5a623" : "#02c77b";
  return (
    <div className="flex items-center" title={`Market utilization ${(p * 100).toFixed(1)}%`}>
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

/**
 * Lend into one isolated Morpho Blue market.
 *
 * Unlike a vault, nobody curates this: the supplier picks the exact collateral
 * they are exposed to and carries that market's liquidity risk themselves. So the
 * node leads with the things that decide whether that is a good idea — the APY it
 * pays, how utilised the market is, how much can actually be withdrawn — rather
 * than hiding them behind a name.
 */
function LendNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements, setEdges } = useReactFlow();
  const { chainId: homeChainId } = useChain();
  const d = data as unknown as LendNodeData;
  const edges = useEdges();
  const allNodes = useNodes();

  // Effective chain — the bridge's destination when this sits downstream of one.
  const nodeChainId = useMemo(
    () => getNodeChainId(id, allNodes as CanvasNode[], edges, homeChainId as SupportedChainId),
    [id, allNodes, edges, homeChainId]
  );
  const chainLabel = CHAIN_CONFIGS.find((c) => c.chainId === nodeChainId)?.label ?? `Chain ${nodeChainId}`;

  // ── Upstream: what is being wired in to lend ────────────────────────────────
  const { inputs, suggestedAsset } = useMemo(
    () => collectUpstream(id, allNodes as CanvasNode[], edges),
    [id, allNodes, edges]
  );
  const hasWalletInput = inputs.some((i) => i.kind === "wallet");

  // An imported node can carry a market but no explicit asset; the market knows.
  const loanAsset: Asset | null = useMemo(() => {
    if (d.loanAsset) return d.loanAsset;
    const m = d.market?.loanAsset;
    if (!m) return null;
    return { symbol: m.symbol, name: m.symbol, address: m.address, decimals: m.decimals, logoURI: m.logoURI };
  }, [d.loanAsset, d.market?.loanAsset]);
  const loanAddr = loanAsset?.address?.toLowerCase() ?? null;

  const { assets: allAssets, loading: assetsLoading } = useAllAssets(nodeChainId);

  // A producer of this very asset that feeds nothing: offer to wire it in, rather
  // than silently lending from the wallet balance.
  const linkable = useMemo(
    () =>
      inputs.some((i) => i.kind !== "wallet")
        ? []
        : findLinkableProducers(id, "lend", loanAsset, allNodes as CanvasNode[], edges, VALID_CONNECTIONS),
    [id, inputs, loanAsset, allNodes, edges]
  );
  const linkProducer = (sourceId: string) =>
    setEdges((eds) => [
      // The producer becomes THE source: drop the wallet fallback.
      ...eds.filter((e) => {
        if (e.target !== id) return true;
        const src = (allNodes as CanvasNode[]).find((n) => n.id === e.source);
        return (src?.data as { type?: string } | undefined)?.type !== "wallet";
      }),
      { id: `${sourceId}-${id}`, source: sourceId, target: id, type: "animatedEdge", animated: true },
    ]);

  // Follow the upstream asset when it changes
  const prevSuggestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!suggestedAsset) {
      prevSuggestedRef.current = null;
      return;
    }
    const addr = suggestedAsset.address.toLowerCase();
    if (addr === prevSuggestedRef.current) return;
    prevSuggestedRef.current = addr;
    const match = allAssets.find((a) => a.address.toLowerCase() === addr);
    updateNodeData(id, { loanAsset: match ?? suggestedAsset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedAsset, allAssets]);

  // A market lends exactly one token. If the asset moves, the old market no
  // longer fits.
  useEffect(() => {
    const marketLoan = d.market?.loanAsset?.address?.toLowerCase();
    if (d.market && marketLoan && loanAddr && marketLoan !== loanAddr) {
      updateNodeData(id, { market: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanAddr]);

  // ── Markets ─────────────────────────────────────────────────────────────────
  const loanAddresses = useMemo(() => (loanAsset?.address ? [loanAsset.address] : []), [loanAsset?.address]);
  const { markets, loading: marketsLoading } = useLendMarkets(loanAddresses, nodeChainId);

  const [sortBy, setSortBy] = useState<"size" | "apy">("size");
  const { visibleMarkets, hiddenCount } = useMemo(() => {
    const big = markets.filter((m) => (m.state.supplyAssetsUsd ?? 0) >= MIN_MARKET_TVL_USD);
    const sorted = [...big];
    if (sortBy === "apy") {
      sorted.sort(
        (a, b) =>
          (b.state.netSupplyApy ?? b.state.supplyApy ?? 0) - (a.state.netSupplyApy ?? a.state.supplyApy ?? 0)
      );
    }
    // "size": the query already orders by supply, largest first.
    return { visibleMarkets: sorted, hiddenCount: markets.length - big.length };
  }, [markets, sortBy]);

  const marketOptions = useMemo(
    () =>
      visibleMarkets.map((m) => {
        const apy = m.state.netSupplyApy ?? m.state.supplyApy;
        const util = m.state.utilization;
        return {
          value: m.uniqueKey,
          label: `${m.collateralAsset.symbol}/${m.loanAsset.symbol} — ${apy !== undefined ? formatApy(apy) : "—"} — util ${
            util !== undefined ? `${(util * 100).toFixed(0)}%` : "—"
          } — ${formatUsd(m.state.supplyAssetsUsd ?? 0)}`,
          icon: m.collateralAsset.logoURI,
        };
      }),
    [visibleMarkets]
  );

  // Live numbers for the selected market (the node holds the snapshot from selection)
  const liveMarket = useMemo(
    () => (d.market ? markets.find((m) => m.uniqueKey === d.market!.uniqueKey) ?? d.market : null),
    [d.market, markets]
  );
  const supplyApy = liveMarket ? liveMarket.state.netSupplyApy ?? liveMarket.state.supplyApy : undefined;
  const utilization = liveMarket?.state.utilization;
  const liquidityUsd = liveMarket?.state.liquidityAssetsUsd;

  // ── Prices + balance + amount ───────────────────────────────────────────────
  const { prices, loading: pricesLoading } = useAssetPrices(loanAsset?.address ? [loanAsset.address] : []);
  const price = loanAsset ? prices[loanAsset.address.toLowerCase()] ?? 0 : 0;

  const selectedAssets = useMemo(() => (loanAsset ? [loanAsset] : []), [loanAsset]);
  const { assetsWithBalances, isLoading: balanceLoading } = useTokenBalances(selectedAssets);
  const walletBalance = parseFloat(assetsWithBalances[0]?.balance ?? "0");

  const inputsWithBalances = inputs.map((i) =>
    i.kind === "wallet" ? { ...i, amount: walletBalance } : i
  );
  const totalFromUpstream = inputsWithBalances.reduce((sum, i) => sum + i.amount, 0);
  const totalAvailable = inputs.length === 0 ? walletBalance : totalFromUpstream;

  const currentAmount = parseFloat(d.amount || "0");
  const amountUsd = currentAmount * price;
  const exceedsBalance =
    !d.depositAll &&
    currentAmount > 0 &&
    (totalAvailable > 0 ? currentAmount > totalAvailable : hasWalletInput);

  const upstreamMismatch =
    !!suggestedAsset &&
    !!loanAsset &&
    suggestedAsset.address.toLowerCase() !== loanAsset.address.toLowerCase();

  // Fed by ONE producer (a swap, a borrow, a withdrawal…) → lend everything it
  // delivers by default. For a swap that is the only sound choice (the fill is
  // unknown until it executes); for a borrow it is what a carry trade means.
  // A wallet is a ceiling to pick from, not an amount to take whole.
  const soleProducer = inputs.length === 1 && inputs[0].kind !== "wallet" ? inputs[0] : null;
  const soleProducerId = soleProducer?.nodeId ?? null;
  const prevProducerRef = useRef<string | null>(null);
  useEffect(() => {
    if (soleProducerId && soleProducerId !== prevProducerRef.current) {
      prevProducerRef.current = soleProducerId;
      if (d.depositAll === undefined) updateNodeData(id, { depositAll: true });
    }
    if (!soleProducerId) {
      prevProducerRef.current = null;
      if (d.depositAll) updateNodeData(id, { depositAll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleProducerId]);

  useEffect(() => {
    if (!d.depositAll || !(totalAvailable > 0)) return;
    const next = totalAvailable.toFixed(6);
    if (next !== d.amount) updateNodeData(id, { amount: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.depositAll, totalAvailable]);

  useEffect(() => {
    if (Math.abs(amountUsd - (d.amountUsd ?? 0)) > 1e-9) {
      updateNodeData(id, { amountUsd });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountUsd]);

  const setAmount = (amount: string) =>
    updateNodeData(id, {
      amount,
      amountUsd: parseFloat(amount || "0") * price,
      depositAll: false,
    });

  const prevExceedsRef = useRef(false);
  const prevIncompleteRef = useRef(false);
  useEffect(() => {
    if (exceedsBalance !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsBalance;
      updateNodeData(id, { exceedsBalance });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exceedsBalance]);
  useEffect(() => {
    if (upstreamMismatch !== prevIncompleteRef.current) {
      prevIncompleteRef.current = upstreamMismatch;
      updateNodeData(id, { incomplete: upstreamMismatch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamMismatch]);

  const assetOptions = useMemo(
    () => allAssets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    [allAssets]
  );

  const highUtilization = utilization !== undefined && utilization > HIGH_UTILIZATION;
  const yearlyUsd = supplyApy !== undefined && amountUsd > 0 ? amountUsd * supplyApy : null;

  return (
    <NodeShell
      nodeType="lend"
      title="Lend"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsBalance}
      loading={marketsLoading || pricesLoading || balanceLoading || assetsLoading}
    >
      <div className="space-y-2">
        {/* Which chain the markets come from */}
        <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1">
          <span className="flex items-center gap-1 text-[9px] text-text-tertiary">
            <ChainIcon chainId={nodeChainId} size={12} />
            {chainLabel}
          </span>
          {nodeChainId !== homeChainId && (
            <span className="rounded bg-brand/15 px-1 py-0.5 text-[8px] font-semibold text-brand">via bridge</span>
          )}
        </div>

        {linkable.map((p) => (
          <div
            key={p.nodeId}
            className="nodrag flex items-center justify-between gap-2 rounded-lg border border-brand/30 bg-brand/5 px-2 py-1.5"
          >
            <span className="text-[10px] text-text-secondary">
              {p.label}
              {p.amount > 0 ? ` (${p.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${p.asset?.symbol})` : ""}{" "}
              is not connected — this Lend draws from your wallet.
            </span>
            <button
              type="button"
              onClick={() => linkProducer(p.nodeId)}
              className="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-white hover:bg-brand-hover"
            >
              Connect
            </button>
          </div>
        ))}

        {upstreamMismatch && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            Wired in: {suggestedAsset!.symbol} — but lending {loanAsset!.symbol}
          </div>
        )}

        {/* ── Asset ──────────────────────────────────────────────────────── */}
        <div>
          <label className="text-[10px] text-text-tertiary">Asset to lend</label>
          {d.market && loanAsset ? (
            <div
              className="mt-0.5 flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2 py-1.5"
              title="Locked by the market — a market lends exactly one token"
            >
              {loanAsset.logoURI && (
                <Image src={loanAsset.logoURI} alt="" width={16} height={16} className="rounded-full" unoptimized />
              )}
              <span className="flex-1 text-xs font-medium text-text-primary">{loanAsset.symbol}</span>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-text-tertiary">
                <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          ) : (
            <SearchSelect
              options={assetOptions}
              value={loanAsset?.address ?? ""}
              onChange={(addr) => {
                const asset = allAssets.find((a) => a.address === addr) ?? null;
                updateNodeData(id, { loanAsset: asset });
              }}
              placeholder="Search asset..."
            />
          )}
        </div>

        {/* ── Market ─────────────────────────────────────────────────────── */}
        {loanAsset && (
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-tertiary">Isolated market</label>
              <div className="nodrag flex items-center gap-1">
                {(["size", "apy"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSortBy(key)}
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
                      sortBy === key
                        ? "bg-brand/15 text-brand"
                        : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {key === "size" ? "Size" : "APY"}
                  </button>
                ))}
              </div>
            </div>
            {marketsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={marketOptions}
                value={d.market?.uniqueKey ?? ""}
                onChange={(v) => {
                  const market = visibleMarkets.find((m) => m.uniqueKey === v) ?? null;
                  updateNodeData(id, { market });
                }}
                placeholder="Search market..."
              />
            )}
            {!marketsLoading && markets.length === 0 && (
              <p className="mt-1 text-[10px] text-text-tertiary">
                No listed market lends {loanAsset.symbol} on {chainLabel}
              </p>
            )}
            {hiddenCount > 0 && (
              <p className="mt-1 text-[9px] text-text-tertiary">
                {hiddenCount} market{hiddenCount > 1 ? "s" : ""} under {formatUsd(MIN_MARKET_TVL_USD)} hidden
              </p>
            )}
          </div>
        )}

        {/* ── Selected market: the things that decide if this is a good idea ─ */}
        {d.market && liveMarket && (
          <>
            <div className="space-y-1.5 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="flex items-center gap-2">
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
                  {utilization !== undefined && <UtilizationRing pct={utilization} />}
                  <span className="text-[10px] font-semibold text-success">
                    {supplyApy !== undefined ? formatApy(supplyApy) : "—"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                <span>Exposed to</span>
                <span className="font-medium text-text-secondary">
                  {d.market.collateralAsset.symbol} · LLTV {formatLltv(d.market.lltv)}
                </span>
              </div>
              {utilization !== undefined && (
                <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                  <span>Utilization</span>
                  <span className={`font-medium ${highUtilization ? "text-error" : "text-text-secondary"}`}>
                    {(utilization * 100).toFixed(1)}%
                  </span>
                </div>
              )}
              {liquidityUsd != null && (
                <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                  <span>Withdrawable now</span>
                  <span className="font-medium text-text-secondary">{formatUsd(liquidityUsd)}</span>
                </div>
              )}
              {liveMarket.state.supplyAssetsUsd != null && (
                <div className="flex items-center justify-between text-[9px] text-text-tertiary">
                  <span>Market size</span>
                  <span className="font-medium text-text-secondary">{formatUsd(liveMarket.state.supplyAssetsUsd)}</span>
                </div>
              )}
            </div>

            {highUtilization && (
              <div className="rounded-lg border border-error/20 bg-error/5 px-2 py-1.5 text-[10px] text-error">
                Utilization above {HIGH_UTILIZATION * 100}% — withdrawals can be blocked until borrowers repay
              </div>
            )}
          </>
        )}

        {/* ── Amount ─────────────────────────────────────────────────────── */}
        {loanAsset && (
          <div className="space-y-1">
            {inputsWithBalances.length > 1 && (
              <div className="space-y-0.5 rounded-lg bg-bg-secondary px-2 py-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Sources</span>
                {inputsWithBalances.map((input) => (
                  <div key={input.nodeId} className="flex items-center justify-between">
                    <span className="text-[10px] text-text-tertiary">{input.label}</span>
                    <span className="text-[10px] text-text-secondary">
                      {input.amount.toFixed(4)} {loanAsset.symbol}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-0.5">
                  <span className="text-[10px] font-medium text-text-tertiary">Total</span>
                  <span className="text-[10px] font-medium text-text-primary">
                    {totalAvailable.toFixed(4)} {loanAsset.symbol}
                  </span>
                </div>
              </div>
            )}

            {(hasWalletInput || inputs.length === 0) && (
              <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1">
                <span className="text-[10px] text-text-tertiary">Wallet</span>
                {balanceLoading ? (
                  <div className="h-3 w-16 animate-pulse rounded bg-bg-primary" />
                ) : (
                  <span className="text-[10px] text-text-secondary">
                    {walletBalance.toFixed(4)} {loanAsset.symbol}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-tertiary">Amount</label>
              <div className="flex items-center gap-2">
                {soleProducer && (
                  <button
                    type="button"
                    onClick={() => updateNodeData(id, { depositAll: !d.depositAll })}
                    title={
                      soleProducer.kind === "swap"
                        ? "Lend the exact amount the swap delivers, whatever the fill turns out to be"
                        : "Lend everything the connected node delivers"
                    }
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
                      d.depositAll
                        ? "bg-brand/15 text-brand"
                        : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {soleProducer.kind === "swap" ? "All swap output" : "All upstream"}
                  </button>
                )}
                {totalAvailable > 0 && !d.depositAll && (
                  <button
                    type="button"
                    onClick={() => setAmount(totalAvailable.toFixed(6))}
                    className="text-[9px] text-text-tertiary transition-colors hover:text-brand"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>
            <div
              className={`nodrag relative flex items-center rounded-lg border bg-bg-secondary ${
                exceedsBalance ? "border-error" : "border-border"
              }`}
            >
              <input
                type="number"
                placeholder="0.00"
                disabled={!!d.depositAll}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={d.amount ?? ""}
                onChange={(e) => setAmount(e.target.value)}
              />
              {amountUsd > 0 && (
                <span className="pointer-events-none shrink-0 pr-2 text-[10px] text-text-tertiary">
                  ~${amountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
            {exceedsBalance && (
              <p className="text-[10px] text-error">
                Exceeds available balance ({totalAvailable.toFixed(4)} {loanAsset.symbol})
              </p>
            )}
            {totalAvailable > 0 && !d.depositAll && (
              <div className="nodrag">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.min(100, Math.round((currentAmount / totalAvailable) * 100))}
                  onChange={(e) => {
                    const p = parseInt(e.target.value);
                    setAmount(((totalAvailable * p) / 100).toFixed(6));
                  }}
                  className="w-full accent-brand"
                />
                <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                  <span className="text-[10px] text-text-tertiary">
                    {currentAmount.toFixed(4)} {loanAsset.symbol}
                  </span>
                  <span className="text-[10px] text-text-tertiary">of {totalAvailable.toFixed(4)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {yearlyUsd !== null && (
          <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
            <span className="text-[10px] text-text-tertiary">Est. yield / year</span>
            <span className="text-xs font-semibold text-success">
              +${yearlyUsd < 1000 ? yearlyUsd.toFixed(2) : Math.round(yearlyUsd).toLocaleString()}
            </span>
          </div>
        )}

        {d.market && <NodeImpact nodeId={id} />}
      </div>

      {/* A lend is terminal: what it holds is a claim on the market, not a
          transferable asset, so there is nothing to wire out. */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-green-500 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(LendNodeComponent);
