// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useBorrowMarkets } from "@/lib/hooks/useBorrowMarkets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { useCollateralAssets } from "@/lib/hooks/useCollateralAssets";
import { formatApy, formatLltv, formatUsd } from "@/lib/utils/format";
import { getNodeChainId } from "@/lib/canvas/bridge";
import { collectUpstream } from "@/lib/canvas/upstream";
import { MIDNIGHT_CHAIN_ID } from "@/lib/midnight/api";
import type { BorrowNodeData, CanvasNode } from "@/lib/canvas/types";
import type { SupportedChainId } from "@/lib/web3/chains";
import NodeShell from "./NodeShell";
import NodeImpact from "./NodeImpact";
import MidnightPanel from "./MidnightPanel";
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

/**
 * Borrow against collateral on one isolated market.
 *
 * One node owns the whole leg — the collateral it posts and the loan it draws —
 * because on Morpho Blue they are one position: collateral with no borrow sits
 * idle, a borrow with no collateral reverts. The collateral asset is chosen (or
 * inherited from whatever is wired in) first, because it is what narrows the
 * list of markets that can exist for this node.
 */
function BorrowNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as BorrowNodeData;
  const edges = useEdges();
  const nodes = useNodes();

  // Effective chain: home chain, or the bridge's destination chain if this
  // borrow sits downstream of a bridge — so we propose markets on that chain.
  const nodeChainId = useMemo(
    () => getNodeChainId(id, nodes as CanvasNode[], edges, chainId as SupportedChainId),
    [id, nodes, edges, chainId]
  );
  // Presets + every collateral token Morpho lists on this chain.
  const { assets: collateralOptionsAssets } = useCollateralAssets(nodeChainId);

  // ── Upstream: what is being wired in as collateral ──────────────────────────
  const { inputs, suggestedAsset } = useMemo(
    () => collectUpstream(id, nodes as CanvasNode[], edges),
    [id, nodes, edges]
  );
  const hasWalletInput = inputs.some((i) => i.kind === "wallet");

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
    const match = collateralOptionsAssets.find((a) => a.address.toLowerCase() === addr);
    updateNodeData(id, { collateralAsset: match ?? suggestedAsset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedAsset]);

  const collateralAsset = d.collateralAsset ?? null;
  const collateralAddr = collateralAsset?.address?.toLowerCase() ?? null;

  // A market only exists for one collateral token. If the collateral asset moves
  // (picked by hand or inherited from upstream), a previously chosen market no
  // longer fits — drop it and everything derived from it.
  useEffect(() => {
    const marketCollateral = d.market?.collateralAsset?.address?.toLowerCase();
    const orphaned = !!d.market && !collateralAddr; // collateral filter cleared
    const mismatched = !!d.market && !!marketCollateral && !!collateralAddr && marketCollateral !== collateralAddr;
    if (orphaned || mismatched) {
      updateNodeData(id, {
        loanAssetAddress: undefined,
        market: null,
        borrowAmount: 0,
        borrowAmountUsd: 0,
        healthFactor: null,
        ltvPercent: 50,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collateralAddr]);

  // ── Prices + wallet balance ─────────────────────────────────────────────────
  const priceAddresses = useMemo(() => {
    const addrs: string[] = [];
    if (collateralAsset?.address) addrs.push(collateralAsset.address);
    if (d.market?.loanAsset?.address) addrs.push(d.market.loanAsset.address);
    return addrs;
  }, [collateralAsset?.address, d.market?.loanAsset?.address]);
  const { prices, loading: pricesLoading } = useAssetPrices(priceAddresses);
  const collateralPrice = collateralAsset
    ? prices[collateralAsset.address.toLowerCase()] ?? 0
    : 0;
  // Loan asset price — needed to convert USD borrow amount to token amount
  const loanAssetPrice = d.market?.loanAsset?.address
    ? prices[d.market.loanAsset.address.toLowerCase()] ?? 0
    : 0;

  const selectedAssets = useMemo(() => (collateralAsset ? [collateralAsset] : []), [collateralAsset]);
  const { assetsWithBalances, isLoading: balanceLoading } = useTokenBalances(selectedAssets);
  const walletBalance = parseFloat(assetsWithBalances[0]?.balance ?? "0");

  // What is available to post: the sum of every wired source (a wallet counts as
  // its balance of the chosen asset), or the wallet balance when nothing is wired.
  const inputsWithBalances = inputs.map((i) =>
    i.kind === "wallet" ? { ...i, amount: walletBalance } : i
  );
  const totalFromUpstream = inputsWithBalances.reduce((sum, i) => sum + i.amount, 0);
  const totalAvailable = inputs.length === 0 ? walletBalance : totalFromUpstream;

  const currentAmount = parseFloat(d.collateralAmount || "0");
  const exceedsBalance =
    !d.collateralAll &&
    currentAmount > 0 &&
    (totalAvailable > 0 ? currentAmount > totalAvailable : hasWalletInput);

  // The wired asset must be the one being posted
  const upstreamMismatch =
    !!suggestedAsset &&
    !!collateralAsset &&
    suggestedAsset.address.toLowerCase() !== collateralAsset.address.toLowerCase();

  // The wired asset has no collateral markets on this chain
  const upstreamNotSupported = useMemo(() => {
    if (!suggestedAsset) return null;
    const match = collateralOptionsAssets.find(
      (a) => a.address.toLowerCase() === suggestedAsset.address.toLowerCase()
    );
    return match ? null : suggestedAsset;
  }, [suggestedAsset, collateralOptionsAssets]);

  // When ONE producer feeds this node (a swap, a withdrawal, another borrow…),
  // the natural intent is "post everything it delivers" — and for a swap that is
  // the only sound choice, since its fill is unknown until it executes. So follow
  // the feed by default. A wallet is not a producer: its balance is a ceiling the
  // user picks from, not an amount to take whole.
  const soleProducer = inputs.length === 1 && inputs[0].kind !== "wallet" ? inputs[0] : null;
  const soleProducerId = soleProducer?.nodeId ?? null;
  const prevProducerRef = useRef<string | null>(null);
  useEffect(() => {
    if (soleProducerId && soleProducerId !== prevProducerRef.current) {
      prevProducerRef.current = soleProducerId;
      if (d.collateralAll === undefined) updateNodeData(id, { collateralAll: true });
    }
    if (!soleProducerId) {
      prevProducerRef.current = null;
      if (d.collateralAll) updateNodeData(id, { collateralAll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleProducerId]);

  // While following the feed, the amount tracks it live, so the LTV maths below
  // runs on the best estimate available (the quote, for a swap).
  useEffect(() => {
    if (!d.collateralAll || !(totalAvailable > 0)) return;
    const next = totalAvailable.toFixed(6);
    if (next !== d.collateralAmount) updateNodeData(id, { collateralAmount: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.collateralAll, totalAvailable]);

  // Keep the USD value in step with amount × price (price arrives after the amount)
  const collateralUsd = currentAmount * collateralPrice;
  useEffect(() => {
    if (Math.abs(collateralUsd - (d.collateralAmountUsd ?? 0)) > 1e-9) {
      updateNodeData(id, { collateralAmountUsd: collateralUsd });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collateralUsd]);

  const setAmount = (amount: string) =>
    updateNodeData(id, {
      collateralAmount: amount,
      collateralAmountUsd: parseFloat(amount || "0") * collateralPrice,
      // Typing an amount is an explicit choice — stop following the swap fill.
      collateralAll: false,
    });

  // Persist states for edge rendering + the Execute button
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
    const incomplete = !!upstreamNotSupported || upstreamMismatch;
    if (incomplete !== prevIncompleteRef.current) {
      prevIncompleteRef.current = incomplete;
      updateNodeData(id, { incomplete });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNotSupported, upstreamMismatch]);

  // ── Market selection ────────────────────────────────────────────────────────
  // Two ways in. Filter by what you post (collateral) and what you want to
  // borrow, then pick from the markets that match — or search the markets
  // directly when you already know which one you want, which then fills in
  // the collateral and the loan asset for you. Both filters are optional.
  const collateralAddresses = useMemo(
    () => (collateralAsset?.address ? [collateralAsset.address] : []),
    [collateralAsset?.address]
  );

  // An imported node arrives with a market but no remembered loan-asset pick.
  const selectedLoanAddress = d.loanAssetAddress ?? d.market?.loanAsset?.address;
  const loanAddresses = useMemo(
    () => (selectedLoanAddress ? [selectedLoanAddress] : []),
    [selectedLoanAddress]
  );

  // Markets for the collateral filter alone: they define which loan assets exist.
  const { markets: collateralMarkets, loading: collateralMarketsLoading } = useBorrowMarkets(
    collateralAddresses,
    [],
    nodeChainId
  );
  // Narrowed by the loan asset too — only fetched once one is chosen.
  const { markets: loanFilteredMarkets, loading: loanMarketsLoading } = useBorrowMarkets(
    collateralAddresses,
    loanAddresses,
    nodeChainId,
    loanAddresses.length > 0
  );
  const markets = loanAddresses.length > 0 ? loanFilteredMarkets : collateralMarkets;
  const marketsLoading = collateralMarketsLoading || loanMarketsLoading;
  const loanAssetsLoading = collateralMarketsLoading;

  const loanAssets = useMemo(() => {
    const seen = new Map<string, { address: string; symbol: string; logoURI: string }>();
    for (const m of collateralMarkets) {
      const key = m.loanAsset.address.toLowerCase();
      if (!seen.has(key)) seen.set(key, m.loanAsset);
    }
    return Array.from(seen.values());
  }, [collateralMarkets]);

  // ── LTV → borrow amount + HF, reactively ────────────────────────────────────
  // borrowAmountUsd = USD value, borrowAmount = token amount (for executor)
  const depositUsd = d.collateralAmountUsd || collateralUsd;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const prevLiquidityRef = useRef(false);
  useEffect(() => {
    if (exceedsLiquidity !== prevLiquidityRef.current) {
      prevLiquidityRef.current = exceedsLiquidity;
      updateNodeData(id, { exceedsLiquidity });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exceedsLiquidity]);

  const hfColor = (hf: number | null) => {
    if (hf === null) return "text-text-tertiary";
    if (hf > 2) return "text-success";
    if (hf > 1.2) return "text-yellow-400";
    return "text-error";
  };

  // Floating (Blue) vs fixed (Midnight). Same intent — borrow X against Y —
  // so it's a mode here, not a separate node the user must know to reach for.
  // The choice lives in the node data, not local state: the executor and the
  // Execute button read it there, and a reload or an import must not silently
  // turn a fixed-rate leg back into a floating Blue borrow.
  const rateMode = d.rateMode ?? "floating";
  const setRateMode = (mode: "floating" | "fixed") =>
    updateNodeData(
      id,
      mode === "fixed" ? { rateMode: "fixed" } : { rateMode: "floating", fixedRate: undefined }
    );
  const midnightAvailable = nodeChainId === MIDNIGHT_CHAIN_ID;

  // The maturity and size picked in the Midnight panel become the leg's
  // `fixedRate`. Only written when it actually changed, since the panel reports
  // on every render of this node.
  const fixedRate = d.fixedRate;
  const onFixedRateSelect = useCallback(
    (sel: { marketId: string; maturity: number; assetsRaw: string } | null) => {
      if (!sel) {
        if (fixedRate) updateNodeData(id, { fixedRate: undefined });
        return;
      }
      if (
        fixedRate &&
        fixedRate.marketId === sel.marketId &&
        fixedRate.maturity === sel.maturity &&
        fixedRate.assetsRaw === sel.assetsRaw
      )
        return;
      // A borrower sells units, so the leg lifts the bids.
      updateNodeData(id, { fixedRate: { ...sel, side: "bids" } });
    },
    [id, fixedRate, updateNodeData]
  );

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

  // SearchSelect options. "Any" clears a filter — the filters are optional.
  const ANY = "__any__";
  const collateralOptions = useMemo(
    () => [
      { value: ANY, label: "Any collateral" },
      ...collateralOptionsAssets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    ],
    [collateralOptionsAssets]
  );
  const loanOptions = useMemo(
    () => [
      { value: ANY, label: "Any asset" },
      ...loanAssets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    ],
    [loanAssets]
  );
  const marketOptions = useMemo(
    () =>
      markets.map((m) => ({
        value: m.uniqueKey,
        label: `${m.collateralAsset.symbol}/${m.loanAsset.symbol} — LLTV ${formatLltv(m.lltv)} — ${formatApy(
          Math.abs(m.state.netBorrowApy)
        )} — ${formatUsd(m.state.liquidityAssetsUsd ?? 0)} liq.`,
        icon: m.loanAsset.logoURI,
      })),
    [markets]
  );

  /** Pick a market directly: it dictates the collateral and the loan asset. */
  const selectMarket = (key: string) => {
    const market = markets.find((m) => m.uniqueKey === key) ?? null;
    if (!market) return;
    const c = market.collateralAsset;
    updateNodeData(id, {
      market,
      collateralAsset: {
        symbol: c.symbol,
        name: c.symbol,
        address: c.address,
        decimals: c.decimals,
        logoURI: c.logoURI,
      },
      loanAssetAddress: market.loanAsset.address,
    });
  };

  return (
    <NodeShell
      nodeType="borrow"
      title="Borrow"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsLiquidity || exceedsBalance}
      loading={loanAssetsLoading || marketsLoading || pricesLoading || balanceLoading}
    >
      <div className="space-y-2">
        {/* ── Collateral ─────────────────────────────────────────────────── */}
        {upstreamNotSupported && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            {upstreamNotSupported.symbol} has no collateral markets on this chain
          </div>
        )}
        {upstreamMismatch && !upstreamNotSupported && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            Wired in: {suggestedAsset!.symbol} — but collateral is {collateralAsset!.symbol}
          </div>
        )}

        {/* ── Find a market: filter by collateral / borrow asset, or search it directly ── */}
        <div>
          <label className="text-[10px] text-text-tertiary">Collateral</label>
          <SearchSelect
            options={collateralOptions}
            value={collateralAsset?.address ?? ""}
            onChange={(addr) => {
              const asset =
                addr === ANY ? null : collateralOptionsAssets.find((a) => a.address === addr) ?? null;
              // Changing the collateral invalidates a market picked for the old one
              // (the effect above clears it); the loan filter no longer applies either.
              updateNodeData(id, { collateralAsset: asset, loanAssetAddress: undefined });
            }}
            placeholder="Search collateral..."
          />
        </div>

        <div>
          <label className="text-[10px] text-text-tertiary">Borrow Asset</label>
          {loanAssetsLoading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={loanOptions}
              value={selectedLoanAddress ?? ""}
              onChange={(v) =>
                updateNodeData(id, { loanAssetAddress: v === ANY ? undefined : v, market: null })
              }
              placeholder="Search asset..."
            />
          )}
        </div>

        <div>
          <label className="text-[10px] text-text-tertiary">Market</label>
          {marketsLoading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={marketOptions}
              value={d.market?.uniqueKey ?? ""}
              onChange={selectMarket}
              placeholder="Search market..."
            />
          )}
        </div>

        {/* Multi-input sources breakdown */}
        {collateralAsset && inputsWithBalances.length > 1 && (
          <div className="space-y-0.5 rounded-lg bg-bg-secondary px-2 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Sources</span>
            {inputsWithBalances.map((input) => (
              <div key={input.nodeId} className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">{input.label}</span>
                <span className="text-[10px] text-text-secondary">
                  {input.amount.toFixed(4)} {collateralAsset.symbol}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-0.5">
              <span className="text-[10px] font-medium text-text-tertiary">Total</span>
              <span className="text-[10px] font-medium text-text-primary">
                {totalAvailable.toFixed(4)} {collateralAsset.symbol}
              </span>
            </div>
          </div>
        )}

        {/* Wallet balance indicator */}
        {collateralAsset && (hasWalletInput || inputs.length === 0) && (
          <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1">
            <span className="text-[10px] text-text-tertiary">Wallet</span>
            {balanceLoading ? (
              <div className="h-3 w-16 animate-pulse rounded bg-bg-primary" />
            ) : (
              <span className="text-[10px] text-text-secondary">
                {walletBalance.toFixed(4)} {collateralAsset.symbol}
              </span>
            )}
          </div>
        )}

        {/* Collateral amount: input + USD inline + slider */}
        {collateralAsset && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-tertiary">Amount</label>
              <div className="flex items-center gap-2">
                {soleProducer && (
                  <button
                    type="button"
                    onClick={() => updateNodeData(id, { collateralAll: !d.collateralAll })}
                    title={
                      soleProducer.kind === "swap"
                        ? "Post the exact amount the swap delivers, whatever the fill turns out to be"
                        : "Post everything the connected node delivers"
                    }
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
                      d.collateralAll
                        ? "bg-brand/15 text-brand"
                        : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {soleProducer.kind === "swap" ? "All swap output" : "All upstream"}
                  </button>
                )}
                {totalAvailable > 0 && !d.collateralAll && (
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
                disabled={!!d.collateralAll}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={d.collateralAmount ?? ""}
                onChange={(e) => setAmount(e.target.value)}
              />
              {collateralUsd > 0 && (
                <span className="pointer-events-none shrink-0 pr-2 text-[10px] text-text-tertiary">
                  ~${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
            {exceedsBalance && (
              <p className="text-[10px] text-error">
                Exceeds available balance ({totalAvailable.toFixed(4)} {collateralAsset.symbol})
              </p>
            )}
            {totalAvailable > 0 && !d.collateralAll && (
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
                    {currentAmount.toFixed(4)} {collateralAsset.symbol}
                  </span>
                  <span className="text-[10px] text-text-tertiary">of {totalAvailable.toFixed(4)}</span>
                </div>
              </div>
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

            {/* Rate model — fixed rate is Base-only, so say so elsewhere
                rather than hiding the option without explanation. */}
            <div className="nodrag flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRateMode("floating")}
                className={`flex-1 rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                  rateMode === "floating"
                    ? "bg-brand/15 text-brand"
                    : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Floating
              </button>
              <button
                type="button"
                disabled={!midnightAvailable}
                onClick={() => setRateMode("fixed")}
                title={midnightAvailable ? "Fixed rate via Midnight" : "Midnight is deployed on Base only"}
                className={`flex-1 rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                  !midnightAvailable
                    ? "cursor-not-allowed bg-bg-secondary text-text-tertiary opacity-40"
                    : rateMode === "fixed"
                      ? "bg-brand/15 text-brand"
                      : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
                }`}
              >
                🕛 Fixed
              </button>
            </div>

            {/* A fixed leg that ends up on another chain (bridge upstream, old
                draft) keeps its choice so it cannot turn into a floating borrow
                unnoticed, but it can't be executed or edited here: say how out. */}
            {rateMode === "fixed" && !midnightAvailable && (
              <p className="text-[9px] text-yellow-400">
                Fixed rate is Base-only: switch this borrow back to Floating to execute it here.
              </p>
            )}

            {rateMode === "fixed" && midnightAvailable && (
              <MidnightPanel
                loanTokenAddress={d.market.loanAsset.address}
                loanSymbol={d.market.loanAsset.symbol}
                loanDecimals={d.market.loanAsset.decimals}
                amount={d.borrowAmount}
                floatingApy={d.market.state?.netBorrowApy}
                selectedMarketId={d.fixedRate?.marketId}
                onSelect={onFixedRateSelect}
              />
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

            <NodeImpact nodeId={id} />

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
