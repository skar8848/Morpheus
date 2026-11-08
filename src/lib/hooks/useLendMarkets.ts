// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQueryAll, morphoQuery } from "../graphql/client";
import { LEND_MARKETS_QUERY, MARKETS_BY_KEY_QUERY } from "../graphql/queries";
import type { Market, MarketsResponse } from "../graphql/types";
import { useChain } from "../context/ChainContext";

/**
 * Listed Morpho Blue markets that accept `loanAddresses` as the loan asset —
 * i.e. the isolated markets a user can lend into. Ordered by size.
 */
export function useLendMarkets(loanAddresses: string[], overrideChainId?: number) {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => `${chainId}:${loanAddresses.map((a) => a.toLowerCase()).sort().join(",")}`,
    [chainId, loanAddresses]
  );

  useEffect(() => {
    if (loanAddresses.length === 0) {
      setMarkets([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    morphoQueryAll<MarketsResponse>(
      LEND_MARKETS_QUERY,
      { loanAssets: loanAddresses, chainId: [chainId] },
      "markets"
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        // A market with no collateral asset has no oracle to speak of — skip it.
        setMarkets(data.markets.items.filter((m) => !!m.collateralAsset?.address));
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { markets, loading, error };
}

/** Live supply-side state of specific markets, keyed by `uniqueKey`. */
export type MarketLiveState = NonNullable<Pick<Market["state"], "supplyApy" | "netSupplyApy" | "utilization" | "supplyAssets" | "liquidityAssets" | "liquidityAssetsUsd">>;

export function useMarketLiveState(uniqueKeys: string[], overrideChainId?: number) {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  const [states, setStates] = useState<Record<string, MarketLiveState>>({});
  const [loading, setLoading] = useState(false);

  const key = useMemo(
    () => `${chainId}:${uniqueKeys.slice().sort().join(",")}`,
    [chainId, uniqueKeys]
  );

  useEffect(() => {
    if (uniqueKeys.length === 0) {
      setStates({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    morphoQuery<{ markets: { items: { uniqueKey: string; state: MarketLiveState }[] } }>(
      MARKETS_BY_KEY_QUERY,
      { keys: uniqueKeys, chainId: [chainId] }
    )
      .then((data) => {
        if (cancelled) return;
        const next: Record<string, MarketLiveState> = {};
        for (const m of data.markets.items) next[m.uniqueKey] = m.state;
        setStates(next);
        setLoading(false);
      })
      .catch(() => {
        // Live state is a refinement — the node still works on its snapshot.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { states, loading };
}
