// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import type { Asset } from "../graphql/types";
import { useChain } from "../context/ChainContext";

const ALL_ASSETS_QUERY = `
  query GetAllAssets($chainId: [Int!]!) {
    markets(where: { chainId_in: $chainId }, first: 500) {
      items {
        state {
          supplyAssetsUsd
        }
        collateralAsset {
          symbol
          name
          address
          decimals
          logoURI
        }
        loanAsset {
          symbol
          name
          address
          decimals
          logoURI
        }
      }
    }
  }
`;

interface AllAssetsResponse {
  markets: {
    items: {
      state: { supplyAssetsUsd: number | null } | null;
      collateralAsset: Asset;
      loanAsset: Asset;
    }[];
  };
}

/**
 * Assets available on a chain. Defaults to the canvas home chain; pass an
 * explicit chainId to fetch another chain's assets (e.g. a bridge destination).
 */
export function useAllAssets(overrideChainId?: number) {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Blank the list immediately on a chain change. Keeping the previous
    // chain's assets visible while the new query runs offered tokens that don't
    // exist on the selected network (EURCV showing up under Base, for one).
    setAssets([]);
    setLoading(true);

    // Responses can land out of order; only the newest chain's may apply.
    let cancelled = false;

    morphoQuery<AllAssetsResponse>(ALL_ASSETS_QUERY, { chainId: [chainId] })
      .then((data) => {
        if (cancelled) return;
        // Rank by how much liquidity actually sits behind each asset, so the
        // list opens on real markets instead of alphabetical trivia.
        const seen = new Map<string, Asset>();
        const weight = new Map<string, number>();
        for (const item of data.markets.items) {
          const usd = item.state?.supplyAssetsUsd ?? 0;
          for (const a of [item.collateralAsset, item.loanAsset]) {
            if (!a?.address) continue;
            const key = a.address.toLowerCase();
            if (!seen.has(key)) {
              seen.set(key, {
                symbol: a.symbol,
                name: a.name,
                address: a.address,
                decimals: a.decimals,
                logoURI: a.logoURI,
              });
            }
            weight.set(key, (weight.get(key) ?? 0) + (isFinite(usd) ? usd : 0));
          }
        }

        setAssets(
          Array.from(seen.entries())
            .sort(([ka, a], [kb, b]) => {
              const diff = (weight.get(kb) ?? 0) - (weight.get(ka) ?? 0);
              return diff !== 0 ? diff : a.symbol.localeCompare(b.symbol);
            })
            .map(([, a]) => a)
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId]);

  return { assets, loading };
}
