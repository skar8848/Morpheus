// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Midnight — Morpho's fixed-rate, fixed-maturity markets.
 *
 * Midnight trades zero-coupon *units*: one unit settles for exactly one loan
 * token at maturity, so units trade below par and the discount IS the yield.
 * A price of 0.95 six months out is a 5.26 % return over the term.
 *
 * Unlike Blue, this is a maker/taker order book. Offers are signed offchain and
 * merely logged by the mempool contract, so Morpho runs a router that aggregates
 * them — that router is what we read here (REST, not the GraphQL API the rest of
 * Morpheus uses).
 *
 * See docs/midnight-design.md.
 */

const MIDNIGHT_API = "https://api.morpho.org/v0/midnight";

/** Midnight is deployed on Base only. */
export const MIDNIGHT_CHAIN_ID = 8453;

/** The router caps page size; asking for more is a 400. */
const MAX_BOOKS_LIMIT = 20;

export interface MidnightLevel {
  /** Discrete price level. */
  tick: number;
  /** Unit price, 18 decimals, below 1e18. */
  price: string;
  /** Units available at this level. */
  units: string;
  /** Loan-token amount at this level. */
  assets: string;
  /** Number of offers aggregated into the level. */
  count: number;
}

export interface MidnightCollateral {
  token: string;
  lltv: string;
  oracle: string;
  liquidation_cursor: string;
}

export interface MidnightMarket {
  market_id: string;
  chain_id: number;
  midnight: string;
  loan_token: string;
  collaterals: MidnightCollateral[];
  /** Unix seconds. */
  maturity: number;
  enter_gate: string;
  liquidator_gate: string;
  /** Offers to LEND into (a borrower takes these). */
  asks: MidnightLevel[];
  /** Offers to BORROW from (a lender takes these). */
  bids: MidnightLevel[];
}

/** Price (1e18) → simple rate over the remaining term, and annualised. */
export function priceToRate(price: string | number, maturity: number, now = Date.now() / 1000) {
  const p = Number(price) / 1e18;
  if (!isFinite(p) || p <= 0) return { termRate: 0, annualRate: 0, days: 0 };
  // A unit redeems at par, so the discount to par is the whole return.
  const termRate = 1 / p - 1;
  const days = Math.max(0, (maturity - now) / 86_400);
  // Simple (not compounded) annualisation, matching how the docs quote it.
  const annualRate = days > 0 ? (termRate * 365) / days : 0;
  return { termRate, annualRate, days };
}

/** Inverse: the price a maker must post to earn/pay a given annualised rate. */
export function rateToPrice(annualRate: number, maturity: number, now = Date.now() / 1000): number {
  const days = Math.max(0, (maturity - now) / 86_400);
  if (days <= 0) return 1;
  const termRate = (annualRate * days) / 365;
  return 1 / (1 + termRate);
}

export async function fetchMidnightMarkets(chainId = MIDNIGHT_CHAIN_ID): Promise<MidnightMarket[]> {
  if (chainId !== MIDNIGHT_CHAIN_ID) return [];
  const res = await fetch(
    `${MIDNIGHT_API}/books?chain_ids=${chainId}&limit=${MAX_BOOKS_LIMIT}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Midnight books ${res.status}`);
  const json = (await res.json()) as { data?: MidnightMarket[] };
  return json.data ?? [];
}

export interface MidnightFill {
  /** Weighted average price actually paid (1e18). */
  avgPrice: string;
  /** Loan-token amount filled. */
  assets: string;
  /** Units received. */
  units: string;
  /** Levels consumed — a take can sweep several. */
  levels: number;
  /** True when the book can't cover the requested size. */
  partial: boolean;
}

/**
 * Simulate a market order against the book: walk price levels until the
 * requested size is covered, so the node can show the *real* average price and
 * the slippage against the best level rather than pretending the top of book
 * fills everything.
 */
export function simulateTake(levels: MidnightLevel[], assetsWanted: bigint): MidnightFill | null {
  if (levels.length === 0 || assetsWanted <= 0n) return null;

  let remaining = assetsWanted;
  let filledAssets = 0n;
  let filledUnits = 0n;
  let consumed = 0;

  for (const lvl of levels) {
    if (remaining <= 0n) break;
    const available = BigInt(lvl.assets);
    const take = available < remaining ? available : remaining;
    if (take <= 0n) continue;
    const price = BigInt(lvl.price);
    // units = assets / price, both scaled by 1e18
    filledUnits += (take * 10n ** 18n) / price;
    filledAssets += take;
    remaining -= take;
    consumed++;
  }

  if (filledAssets === 0n) return null;
  // Effective price across everything filled.
  const avgPrice = (filledAssets * 10n ** 18n) / filledUnits;

  return {
    avgPrice: avgPrice.toString(),
    assets: filledAssets.toString(),
    units: filledUnits.toString(),
    levels: consumed,
    partial: remaining > 0n,
  };
}

/** Slippage of an executed fill against the best level, expressed in rate terms. */
export function fillSlippage(
  fill: MidnightFill,
  levels: MidnightLevel[],
  maturity: number
): { bestRate: number; avgRate: number; rateSlippageBps: number } {
  const best = priceToRate(levels[0]?.price ?? "0", maturity).annualRate;
  const avg = priceToRate(fill.avgPrice, maturity).annualRate;
  return {
    bestRate: best,
    avgRate: avg,
    // Rate is what the user is actually choosing between, so express the cost
    // of sweeping the book that way rather than as a price delta.
    rateSlippageBps: (avg - best) * 10_000,
  };
}
