// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useEffect, useMemo, useState } from "react";
import { morphoQueryAll } from "../graphql/client";
import type { Asset } from "../graphql/types";
import { COLLATERAL_ASSETS } from "../constants/assets";
import type { SupportedChainId } from "../web3/chains";
import { useChain } from "../context/ChainContext";

const LISTED_COLLATERALS_QUERY = `
  query GetListedCollaterals($chainId: [Int!]!, $first: Int, $skip: Int) {
    markets(
      first: $first
      skip: $skip
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
      where: { chainId_in: $chainId, listed: true }
    ) {
      items {
        state { supplyAssetsUsd }
        collateralAsset { symbol name address decimals logoURI }
        loanAsset { symbol name address decimals logoURI }
      }
      pageInfo { countTotal }
    }
  }
`;

interface Response {
  markets: {
    items: {
      state: { supplyAssetsUsd: number | null } | null;
      collateralAsset: Asset | null;
      loanAsset: Asset | null;
    }[];
  };
}

/**
 * Every asset that can be posted as collateral on a listed market of the chain.
 *
 * The hardcoded presets (`COLLATERAL_ASSETS`) come first — they are the assets
 * the wallet node shows balances for — then every other collateral token that
 * Morpho lists, biggest first. Without the second half, a market whose
 * collateral is not in the presets (sUSDS, say) had no matching option and its
 * collateral showed up empty.
 */
export function useCollateralAssets(overrideChainId?: number) {
  const { chainId: homeChainId } = useChain();
  const chainId = overrideChainId ?? homeChainId;
  // Keyed by chain: a late answer for the previous chain must never be shown
  // under the new one (it would offer tokens that do not exist there).
  const [result, setResult] = useState<{ chainId: number; collaterals: Asset[]; loans: Asset[] } | null>(null);
  const listed = useMemo(() => (result?.chainId === chainId ? result.collaterals : []), [result, chainId]);
  const listedLoans = useMemo(() => (result?.chainId === chainId ? result.loans : []), [result, chainId]);
  const loading = result?.chainId !== chainId;

  useEffect(() => {
    let cancelled = false;

    morphoQueryAll<Response>(LISTED_COLLATERALS_QUERY, { chainId: [chainId] }, "markets")
      .then((data) => {
        if (cancelled) return;
        // Items arrive biggest-market-first, so first sight order is the ranking.
        const collaterals = new Map<string, Asset>();
        const loans = new Map<string, Asset>();
        const keep = (into: Map<string, Asset>, a: Asset | null) => {
          if (!a?.address) return;
          const key = a.address.toLowerCase();
          if (into.has(key)) return;
          into.set(key, {
            symbol: a.symbol,
            name: a.name,
            address: a.address,
            decimals: a.decimals,
            logoURI: a.logoURI,
          });
        };
        for (const item of data.markets.items) {
          keep(collaterals, item.collateralAsset);
          keep(loans, item.loanAsset);
        }
        setResult({
          chainId,
          collaterals: Array.from(collaterals.values()),
          loans: Array.from(loans.values()),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ chainId, collaterals: [], loans: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [chainId]);

  const assets = useMemo(() => {
    const presets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];
    const known = new Set(presets.map((a) => a.address.toLowerCase()));
    return [...presets, ...listed.filter((a) => !known.has(a.address.toLowerCase()))];
  }, [chainId, listed]);

  // Everything a wallet could hold that Morpho can use: collaterals AND loan
  // tokens (EURCV sitting in the wallet is a loan asset, never a collateral).
  const walletAssets = useMemo(() => {
    const seen = new Set(assets.map((a) => a.address.toLowerCase()));
    return [...assets, ...listedLoans.filter((a) => !seen.has(a.address.toLowerCase()))];
  }, [assets, listedLoans]);

  return { assets, walletAssets, loading };
}
