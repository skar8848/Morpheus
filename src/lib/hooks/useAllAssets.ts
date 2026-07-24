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
    setLoading(true);
    morphoQuery<AllAssetsResponse>(ALL_ASSETS_QUERY, { chainId: [chainId] })
      .then((data) => {
        const seen = new Map<string, Asset>();
        for (const item of data.markets.items) {
          for (const a of [item.collateralAsset, item.loanAsset]) {
            if (a?.address && !seen.has(a.address.toLowerCase())) {
              seen.set(a.address.toLowerCase(), {
                symbol: a.symbol,
                name: a.name,
                address: a.address,
                decimals: a.decimals,
                logoURI: a.logoURI,
              });
            }
          }
        }
        setAssets(
          Array.from(seen.values()).sort((a, b) =>
            a.symbol.localeCompare(b.symbol)
          )
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [chainId]);

  return { assets, loading };
}