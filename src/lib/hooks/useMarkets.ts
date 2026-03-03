"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import { MARKETS_QUERY } from "../graphql/queries";
import type { Market, MarketsResponse } from "../graphql/types";
import { useChain } from "../context/ChainContext";

export function useMarkets(collateralAddresses: string[], loanAddresses: string[]) {
  const { chainId } = useChain();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => `${chainId}:${collateralAddresses.join(",")}:${loanAddresses.join(",")}`,
    [chainId, collateralAddresses, loanAddresses]
  );

  useEffect(() => {
    if (collateralAddresses.length === 0 || loanAddresses.length === 0) {
      setMarkets([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    morphoQuery<MarketsResponse>(MARKETS_QUERY, {
      collateralAssets: collateralAddresses,
      loanAssets: loanAddresses,
      chainId: [chainId],
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setMarkets(data.markets.items);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [key]);

  return { markets, loading, error };
}
