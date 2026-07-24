// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect } from "react";
import { CCTP_DOMAINS } from "@/lib/canvas/bridge";
import type { SupportedChainId } from "@/lib/web3/chains";

/**
 * A single bridge route offer, comparable against the others.
 * Ranked like Stargate's UI: best net received first.
 */
export interface RouteQuote {
  id: string;
  /** Display name, e.g. "CCTP v2 · Fast". */
  name: string;
  provider: "cctp" | "stargate";
  /** USD delivered on the destination, after the bridge fee. */
  receivedUsd: number;
  /** Bridge/protocol fee in USD. */
  feeUsd: number;
  /** Fee in basis points, when the rail quotes it that way. */
  feeBps: number | null;
  /** Estimated source-chain gas in USD (null when unknown). */
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

/** Standard-transfer latency ≈ source-chain hard finality. */
function standardEta(src: SupportedChainId): number {
  return src === 1 ? 900 : 120;
}

/**
 * Quote every bridge route available for this hop and rank them by net value
 * received (received − gas), best first. CCTP is marked `preferred` for USDC
 * but never forced — the user picks.
 */
export function useBridgeRoutes(
  srcChainId: SupportedChainId,
  dstChainId: SupportedChainId,
  amountUsd: number,
  tokenIsUsdc: boolean
): BridgeRoutesResult {
  const [result, setResult] = useState<BridgeRoutesResult>({
    loading: false,
    routes: [],
    error: null,
  });

  const srcDomain = CCTP_DOMAINS[srcChainId];
  const dstDomain = CCTP_DOMAINS[dstChainId];
  const cctpPossible =
    tokenIsUsdc && srcDomain !== undefined && dstDomain !== undefined && srcChainId !== dstChainId;

  useEffect(() => {
    if (srcChainId === dstChainId) {
      setResult({ loading: false, routes: [], error: null });
      return;
    }

    const gasUsd = GAS_USD_ESTIMATE[srcChainId] ?? null;

    // Stargate: pooled-liquidity rail that also covers non-USDC assets. Its
    // quote API (transfer.layerzero-api.com/v1/quotes) requires an API key, so
    // we surface the route without inventing numbers rather than hide it.
    const stargate: RouteQuote = {
      id: "stargate",
      name: "Stargate",
      provider: "stargate",
      receivedUsd: 0,
      feeUsd: 0,
      feeBps: null,
      gasUsd,
      etaSeconds: 60,
      unavailable: "Quote unavailable (API key required)",
    };

    if (!cctpPossible) {
      // Non-USDC or non-CCTP chain: Stargate is the only candidate.
      setResult({ loading: false, routes: [stargate], error: null });
      return;
    }

    let cancelled = false;
    setResult((r) => ({ ...r, loading: true, error: null }));

    fetch(`/api/bridge-quote?src=${srcDomain}&dst=${dstDomain}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; fastFeeBps: number | null; standardFeeBps: number; error?: string }) => {
        if (cancelled) return;
        if (!data.ok) {
          setResult({ loading: false, routes: [stargate], error: data.error ?? "quote failed" });
          return;
        }
        const fastBps = data.fastFeeBps ?? 0;
        const fastFee = (amountUsd * fastBps) / 10_000;
        const stdBps = data.standardFeeBps ?? 0;
        const stdFee = (amountUsd * stdBps) / 10_000;

        const routes: RouteQuote[] = [
          {
            id: "cctp-fast",
            name: "CCTP v2 · Fast",
            provider: "cctp",
            receivedUsd: Math.max(0, amountUsd - fastFee),
            feeUsd: fastFee,
            feeBps: fastBps,
            gasUsd,
            etaSeconds: 15,
            preferred: true,
          },
          {
            id: "cctp-standard",
            name: "CCTP v2 · Standard",
            provider: "cctp",
            receivedUsd: Math.max(0, amountUsd - stdFee),
            feeUsd: stdFee,
            feeBps: stdBps,
            gasUsd,
            etaSeconds: standardEta(srcChainId),
          },
          stargate,
        ];

        // Rank by net value received; unavailable routes always sink to the end.
        routes.sort((a, b) => {
          if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? 1 : -1;
          return b.receivedUsd - b.gasUsd! - (a.receivedUsd - a.gasUsd!) || 0;
        });

        setResult({ loading: false, routes, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setResult({
            loading: false,
            routes: [stargate],
            error: err instanceof Error ? err.message : "quote failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [cctpPossible, srcDomain, dstDomain, amountUsd, srcChainId, dstChainId]);

  return result;
}
