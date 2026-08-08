// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import {
  fetchMidnightMarkets,
  priceToRate,
  rateToPrice,
  simulateTake,
  fillSlippage,
  MIDNIGHT_CHAIN_ID,
  type MidnightMarket,
} from "@/lib/midnight/api";

interface Props {
  /** Loan token the user wants to borrow, to match against Midnight markets. */
  loanTokenAddress?: string;
  loanSymbol?: string;
  loanDecimals?: number;
  /** Size the user is borrowing, in loan-token units. */
  amount: number;
  /** Floating rate from the Blue market, for the side-by-side comparison. */
  floatingApy?: number;
}

type OrderMode = "market" | "limit";

const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

/**
 * Fixed-rate borrowing through Midnight, shown inside the Borrow node.
 *
 * Deliberately not a separate node type: borrowing is the same intent either
 * way, and only the rate model differs — so floating and fixed belong side by
 * side where the comparison is free, rather than in two blocks the user has to
 * know to reach for.
 */
export default function MidnightPanel({
  loanTokenAddress,
  loanSymbol,
  loanDecimals = 6,
  amount,
  floatingApy,
}: Props) {
  const [markets, setMarkets] = useState<MidnightMarket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marketId, setMarketId] = useState<string | null>(null);
  const [mode, setMode] = useState<OrderMode>("market");
  const [limitRate, setLimitRate] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMidnightMarkets(MIDNIGHT_CHAIN_ID)
      .then((m) => !cancelled && setMarkets(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Only markets for the token being borrowed are relevant.
  const candidates = useMemo(() => {
    if (!markets || !loanTokenAddress) return [];
    const want = loanTokenAddress.toLowerCase();
    return markets
      .filter((m) => m.loan_token.toLowerCase() === want)
      .sort((a, b) => a.maturity - b.maturity);
  }, [markets, loanTokenAddress]);

  const market = useMemo(
    () => candidates.find((m) => m.market_id === marketId) ?? candidates[0] ?? null,
    [candidates, marketId]
  );

  // Borrowing means selling units, so a borrower lifts the BIDS.
  const levels = useMemo(() => market?.bids ?? [], [market]);

  const fill = useMemo(() => {
    if (!market || amount <= 0 || levels.length === 0) return null;
    try {
      return simulateTake(levels, parseUnits(amount.toFixed(loanDecimals), loanDecimals));
    } catch {
      return null;
    }
  }, [market, levels, amount, loanDecimals]);

  const slip = useMemo(
    () => (fill && market ? fillSlippage(fill, levels, market.maturity) : null),
    [fill, levels, market]
  );

  if (error) {
    return <p className="text-[9px] text-error">Midnight: {error}</p>;
  }
  if (!markets) {
    return <p className="text-[9px] text-text-tertiary">Loading fixed-rate markets…</p>;
  }
  if (candidates.length === 0) {
    return (
      <p className="text-[9px] text-text-tertiary">
        No fixed-rate market for {loanSymbol ?? "this asset"} yet
      </p>
    );
  }

  const bestRate = levels.length > 0 && market ? priceToRate(levels[0].price, market.maturity) : null;
  const limitPrice =
    market && limitRate ? rateToPrice(parseFloat(limitRate) / 100 || 0, market.maturity) : null;

  return (
    <div className="space-y-1.5">
      {/* Maturity picker — a fixed-rate leg introduces a clock the rest of the
          canvas doesn't have, so it stays visible. */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {candidates.map((m) => {
          const r = m.bids.length > 0 ? priceToRate(m.bids[0].price, m.maturity) : null;
          const active = m.market_id === market?.market_id;
          return (
            <button
              key={m.market_id}
              type="button"
              onClick={() => setMarketId(m.market_id)}
              className={`shrink-0 rounded-lg border px-1.5 py-1 text-left transition-colors ${
                active ? "border-brand/50 bg-brand/10" : "border-border bg-bg-secondary hover:border-brand/30"
              }`}
            >
              <div className="text-[9px] font-semibold text-text-primary">
                {new Date(m.maturity * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
              <div className="text-[8px] text-text-tertiary">
                {r ? `${fmtPct(r.annualRate)} · ${Math.round(r.days)}d` : "no bids"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Fixed vs floating — the whole reason to surface this here. */}
      {bestRate && (
        <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1 text-[9px]">
          <span className="text-text-tertiary">
            Floating{" "}
            <span className="text-text-secondary">
              {floatingApy !== undefined ? fmtPct(Math.abs(floatingApy)) : "—"}
            </span>
          </span>
          <span className="text-text-tertiary">
            Fixed <span className="font-semibold text-brand">{fmtPct(bestRate.annualRate)}</span> to{" "}
            {new Date((market?.maturity ?? 0) * 1000).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      )}

      {/* Order mode */}
      <div className="flex items-center gap-1">
        {(["market", "limit"] as OrderMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-1.5 py-0.5 text-[9px] font-semibold capitalize transition-colors ${
              mode === m ? "bg-brand/15 text-brand" : "bg-bg-secondary text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {m} order
          </button>
        ))}
      </div>

      {/* Order book preview */}
      <div className="rounded-lg bg-bg-secondary px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[8px] uppercase tracking-wider text-text-tertiary">
          <span>Rate</span>
          <span>Size ({loanSymbol})</span>
        </div>
        {levels.length === 0 ? (
          <p className="text-[9px] text-text-tertiary">No offers on this maturity</p>
        ) : (
          levels.slice(0, 5).map((l) => {
            const r = priceToRate(l.price, market!.maturity);
            const size = Number(l.assets) / 10 ** loanDecimals;
            return (
              <div key={l.tick} className="flex items-center justify-between text-[9px] tabular-nums">
                <span className="text-success">{fmtPct(r.annualRate)}</span>
                <span className="text-text-secondary">
                  {size.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {l.count > 1 && <span className="ml-1 text-text-tertiary">×{l.count}</span>}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Market order: the real fill, swept across levels */}
      {mode === "market" && fill && slip && (
        <div className="rounded-lg border border-border/60 bg-bg-secondary/50 px-2 py-1.5 text-[9px]">
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Effective rate</span>
            <span className="font-semibold text-text-primary">{fmtPct(slip.avgRate)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-text-tertiary">
              Slippage vs best {fill.levels > 1 && `(${fill.levels} levels)`}
            </span>
            <span className={slip.rateSlippageBps > 25 ? "text-yellow-400" : "text-text-secondary"}>
              +{slip.rateSlippageBps.toFixed(1)} bps
            </span>
          </div>
          {fill.partial && (
            <p className="mt-0.5 text-[9px] text-yellow-400">
              Book only covers{" "}
              {(Number(fill.assets) / 10 ** loanDecimals).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              {loanSymbol} — the rest won&apos;t fill
            </p>
          )}
        </div>
      )}

      {/* Limit order: you name the rate, the price follows */}
      {mode === "limit" && market && (
        <div className="rounded-lg border border-border/60 bg-bg-secondary/50 px-2 py-1.5 text-[9px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-tertiary">Your rate</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                min={0}
                value={limitRate}
                placeholder={bestRate ? (bestRate.annualRate * 100).toFixed(2) : "0.00"}
                onChange={(e) => setLimitRate(e.target.value)}
                className="w-14 rounded bg-bg-card px-1 py-0.5 text-right text-[9px] text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-text-tertiary">%</span>
            </div>
          </div>
          {limitPrice !== null && limitRate && (
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-text-tertiary">Offer price</span>
              <span className="text-text-secondary">{limitPrice.toFixed(6)}</span>
            </div>
          )}
          <p className="mt-1 text-[9px] text-text-tertiary">
            Posts a signed offer at your rate. It fills only if someone takes it — partially or in
            full.
          </p>
        </div>
      )}
    </div>
  );
}
