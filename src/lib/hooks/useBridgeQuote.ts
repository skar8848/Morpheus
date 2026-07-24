// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect } from "react";
import { CCTP_DOMAINS } from "@/lib/canvas/bridge";
import type { BridgeRoute } from "@/lib/canvas/bridge";
import type { SupportedChainId } from "@/lib/web3/chains";

export interface BridgeQuote {
  loading: boolean;
  /** Fast-transfer fee in basis points (null if unavailable). */
  fastFeeBps: number | null;
  standardFeeBps: number;
  /** Fee in USD on the bridged amount, using the fast fee. */
  feeUsd: number;
  /** Estimated USD received on the destination after the bridge fee. */
  receivedUsd: number;
  etaFastSeconds: number;
  etaStandardSeconds: number;
  error: string | null;
}

const EMPTY: BridgeQuote = {
  loading: false,
  fastFeeBps: null,
  standardFeeBps: 0,
  feeUsd: 0,
  receivedUsd: 0,
  etaFastSeconds: 15,
  etaStandardSeconds: 120,
  error: null,
};

/** Standard-transfer latency ≈ source-chain finality. Rough, chain-dependent. */
function standardEta(src: SupportedChainId): number {
  return src === 1 ? 900 : 120; // mainnet finality ~15 min; L2s ~2 min
}

/**
 * Live CCTP v2 quote from Circle's Iris fee schedule (via /api/bridge-quote).
 * Only the cctp-v2 rail is quoted here; other rails return the empty quote.
 */
export function useBridgeQuote(
  srcChainId: SupportedChainId,
  dstChainId: SupportedChainId,
  amountUsd: number,
  route: BridgeRoute
): BridgeQuote {
  const [quote, setQuote] = useState<BridgeQuote>(EMPTY);

  const srcDomain = CCTP_DOMAINS[srcChainId];
  const dstDomain = CCTP_DOMAINS[dstChainId];
  const active = route.rail === "cctp-v2" && srcDomain !== undefined && dstDomain !== undefined;

  useEffect(() => {
    if (!active) {
      setQuote(EMPTY);
      return;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true, error: null }));
    fetch(`/api/bridge-quote?src=${srcDomain}&dst=${dstDomain}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; fastFeeBps: number | null; standardFeeBps: number; error?: string }) => {
        if (cancelled) return;
        if (!data.ok) {
          setQuote({ ...EMPTY, error: data.error ?? "quote failed" });
          return;
        }
        const feeBps = data.fastFeeBps ?? 0;
        const feeUsd = (amountUsd * feeBps) / 10_000;
        setQuote({
          loading: false,
          fastFeeBps: data.fastFeeBps,
          standardFeeBps: data.standardFeeBps ?? 0,
          feeUsd,
          receivedUsd: Math.max(0, amountUsd - feeUsd),
          etaFastSeconds: 15,
          etaStandardSeconds: standardEta(srcChainId),
          error: null,
        });
      })
      .catch((err) => {
        if (!cancelled) setQuote({ ...EMPTY, error: err instanceof Error ? err.message : "quote failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [active, srcDomain, dstDomain, amountUsd, srcChainId]);

  return quote;
}
