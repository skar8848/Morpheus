// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import type { Market, MarketsResponse } from "../graphql/types";
import { useChain } from "../context/ChainContext";

/**
 * Listed markets to borrow from, with OPTIONAL collateral / loan filters.
 *
 * Both filters are optional so the borrow node can be entered from either end:
 * narrow down by what you post and what you want to borrow, or search the
 * markets directly when you already know which one you want. The query is
 * built per filter combination because GraphQL rejects a declared-but-unused
 * variable, and an empty `_in` list is not a safe stand-in for "no filter".
 *
 * `listed: true` for the same reason as the lend query: unlisted markets
 * include fake-oracle ones that look huge and are not safe to borrow from.
 */
function buildQuery(hasCollateral: boolean, hasLoan: boolean): string {
  const decls = ["$chainId: [Int!]!"];
  const filters = ["chainId_in: $chainId", "listed: true"];
  if (hasCollateral) {
    decls.push("$collateralAssets: [String!]!");
    filters.push("collateralAssetAddress_in: $collateralAssets");
  }
  if (hasLoan) {
    decls.push("$loanAssets: [String!]!");
    filters.push("loanAssetAddress_in: $loanAssets");
  }
  return `
    query GetBorrowMarkets(${decls.join(", ")}) {
      markets(
        first: 100
        orderBy: SupplyAssetsUsd
        orderDirection: Desc
        where: { ${filters.join(" ")} }
      ) {
        items {
          uniqueKey: marketId
          lltv
          irmAddress
          oracle { address }
          collateralAsset { symbol address logoURI price { usd } decimals }
          loanAsset { symbol address logoURI price { usd } decimals }
          state {
            borrowApy
            netBorrowApy
            borrowAssets
            supplyAssets
            supplyAssetsUsd
            liquidityAssets
            liquidityAssetsUsd
            price
            rewards { asset { symbol address } supplyApr borrowApr }
          }
        }
      }
    }
  `;
}

export function useBorrowMarkets(
  collateralAddresses: string[],
  loanAddresses: string[],
  overrideChainId?: number,
  enabled = true
) {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () =>
      `${enabled}:${chainId}:${collateralAddresses.map((a) => a.toLowerCase()).sort().join(",")}:${loanAddresses
        .map((a) => a.toLowerCase())
        .sort()
        .join(",")}`,
    [enabled, chainId, collateralAddresses, loanAddresses]
  );

  useEffect(() => {
    abortRef.current?.abort();
    if (!enabled) {
      setMarkets([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const variables: Record<string, unknown> = { chainId: [chainId] };
    if (collateralAddresses.length > 0) variables.collateralAssets = collateralAddresses;
    if (loanAddresses.length > 0) variables.loanAssets = loanAddresses;

    morphoQuery<MarketsResponse>(
      buildQuery(collateralAddresses.length > 0, loanAddresses.length > 0),
      variables
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        // A market with no collateral asset has no oracle worth borrowing against.
        setMarkets(data.markets.items.filter((m) => !!m.collateralAsset?.address));
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { markets, loading };
}
