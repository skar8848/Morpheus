"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import { useChain } from "../context/ChainContext";

const PRICES_QUERY = `
  query GetAssetPrices($addresses: [String!]!, $chainId: [Int!]!) {
    assets(where: { address_in: $addresses, chainId_in: $chainId }) {
      items {
        address
        priceUsd
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
 */
export function useAssetPrices(addresses: string[]): {
  prices: Record<string, number>;
  loading: boolean;
} {
  const { chainId } = useChain();
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
