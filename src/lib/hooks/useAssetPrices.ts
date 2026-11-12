// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import { useChain } from "../context/ChainContext";

const PRICES_QUERY = `
  query GetAssetPrices($addresses: [String!]!, $chainId: [Int!]!) {
    assets(where: { address_in: $addresses, chainId_in: $chainId }) {
      items {
        address
        price { usd }
        symbol
      }
    }
  }
`;

interface PricesResponse {
  assets: {
    items: { address: string; priceUsd: number | null; symbol: string }[];
  };
}

/**
 * Fetch USD prices for a list of asset addresses from Morpho API.
 * Returns a map of lowercase address → priceUsd.
 *
 * Defaults to the canvas home chain; pass the chain the assets actually live
 * on (a node downstream of a bridge, a bridge's destination token). Asking the
 * home chain for another chain's addresses returns nothing, which priced every
 * node after a bridge at $0.
 */
export function useAssetPrices(addresses: string[], overrideChainId?: number): {
  prices: Record<string, number>;
  loading: boolean;
} {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => `${chainId}:${addresses.slice().sort().join(",")}`,
    [chainId, addresses]
  );

  useEffect(() => {
    if (addresses.length === 0) {
      setPrices({});
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    morphoQuery<PricesResponse>(PRICES_QUERY, {
      addresses,
      chainId: [chainId],
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const map: Record<string, number> = {};
        for (const item of data.assets.items) {
          if (item.priceUsd != null) {
            map[item.address.toLowerCase()] = item.priceUsd;
          }
        }
        setPrices(map);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [key]);

  return { prices, loading };
}