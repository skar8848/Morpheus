// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect } from "react";
import type { SupportedChainId } from "@/lib/web3/chains";

/**
 * A single bridge route offer, comparable against the others.
 * Ranked like Stargate's UI: best net received first.
 */
export interface RouteQuote {
  id: string;
  /** Display name, e.g. "CCTP v2 · Fast" or "StargateV2 (Fast mode)". */
  name: string;
  provider: "cctp" | "lifi" | "stargate";
  /** Aggregator tool key, e.g. "stargateV2Bus". */
  tool?: string;
  logoURI?: string;
  /** USD delivered on the destination, after the bridge fee. */
  receivedUsd: number;
  /** Destination amount in raw token units, when the rail quotes it. */
  dstAmount: string | null;
  /** Bridge/protocol fee in USD. */
  feeUsd: number;
  /** Fee in basis points, when the rail quotes it that way. */
  feeBps: number | null;
  /** Estimated gas in USD (null when unknown). */
  gasUsd: number | null;
  etaSeconds: number;
  /** Shown first for USDC — the native, capital-efficient rail. */
  preferred?: boolean;
  /** Set when the route can't be used/quoted; it renders greyed out. */
  unavailable?: string;
}

export interface BridgeRoutesResult {
  loading: boolean;
  routes: RouteQuote[];
  error: string | null;
}

/** Rough source-chain gas for a burn/bridge tx, in USD. Chain-dependent. */
const GAS_USD_ESTIMATE: Partial<Record<SupportedChainId, number>> = {
  1: 2.5, // mainnet: dominated by L1 gas
  8453: 0.02,
  42161: 0.05,
  999: 0.02,
  143: 0.02,
};

interface ApiRoute {
  id: string;
  name: string;
  provider: "cctp" | "lifi" | "stargate";
  tool?: string;
  logoURI?: string;
  dstAmount: string | null;
  dstAmountUsd: number | null;
  feeUsd: number | null;
  feeBps: number | null;
  gasUsd: number | null;
  etaSeconds: number | null;
  preferred?: boolean;
  unavailable?: string;
}

/**
 * Debounce before hitting the quote API. LI.FI allows ~75 route requests per
 * 2h without a key, so re-quoting on every keystroke would burn the budget in
 * seconds. Server-side results are additionally cached for 30s.
 */
const QUOTE_DEBOUNCE_MS = 700;

export interface BridgeRoutesParams {
  srcChainId: SupportedChainId;
  dstChainId: SupportedChainId;
  amountUsd: number;
  /** Input amount in raw token units (needed for the Stargate quote). */
  amountRaw: string;
  srcToken: string | null;
  dstToken: string | null;
  isUsdc: boolean;
  wallet?: string;
}

/**
 * Quote every bridge rail for this hop and rank them by net value received
 * (received − gas), best first. CCTP is flagged `preferred` for USDC but never
 * forced — the user picks.
 */
export function useBridgeRoutes(params: BridgeRoutesParams): BridgeRoutesResult {
  const { srcChainId, dstChainId, amountUsd, amountRaw, srcToken, dstToken, isUsdc, wallet } = params;
  const [result, setResult] = useState<BridgeRoutesResult>({
    loading: false,
    routes: [],
    error: null,
  });

  // Same-chain isn't a bridge at all — derived below rather than pushed into
  // state, so the effect never has to setState just to blank the list.
  const sameChain = srcChainId === dstChainId;

  useEffect(() => {
    if (sameChain) return;

    const fallbackGas = GAS_USD_ESTIMATE[srcChainId] ?? null;
    let cancelled = false;

    const qs = new URLSearchParams({
      srcChainId: String(srcChainId),
      dstChainId: String(dstChainId),
      amountUsd: String(amountUsd),
      amountRaw,
      srcToken: srcToken ?? "",
      dstToken: dstToken ?? "",
      isUsdc: isUsdc ? "1" : "0",
      ...(wallet ? { wallet } : {}),
    });

    const timer = setTimeout(() => {
      // Flip to "loading" only once the debounce actually fires — while the
      // user is still typing there's nothing in flight to report.
      setResult((r) => ({ ...r, loading: true, error: null }));
      fetch(`/api/bridge-routes?${qs}`)
        .then((r) => r.json())
        .then((data: { ok: boolean; routes?: ApiRoute[]; error?: string }) => {
          if (cancelled) return;
          if (!data.ok) {
            setResult({ loading: false, routes: [], error: data.error ?? "quote failed" });
            return;
          }
          const routes: RouteQuote[] = (data.routes ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            provider: r.provider,
            tool: r.tool,
            logoURI: r.logoURI,
            receivedUsd: r.dstAmountUsd ?? 0,
            dstAmount: r.dstAmount,
            feeUsd: r.feeUsd ?? 0,
            feeBps: r.feeBps,
            // Aggregators report real gas; native CCTP doesn't, so estimate it.
            gasUsd: r.gasUsd ?? fallbackGas,
            etaSeconds: r.etaSeconds ?? 60,
            preferred: r.preferred,
            unavailable: r.unavailable,
          }));

          // Rank by net value received; unquotable routes sink to the end.
          routes.sort((a, b) => {
            if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? 1 : -1;
            const net = (r: RouteQuote) => r.receivedUsd - (r.gasUsd ?? 0);
            return net(b) - net(a);
          });

          setResult({ loading: false, routes, error: null });
        })
        .catch((err) => {
          if (!cancelled)
            setResult({
              loading: false,
              routes: [],
              error: err instanceof Error ? err.message : "quote failed",
            });
        });
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sameChain, srcChainId, dstChainId, amountUsd, amountRaw, srcToken, dstToken, isUsdc, wallet]);

  return sameChain ? { loading: false, routes: [], error: null } : result;
}
