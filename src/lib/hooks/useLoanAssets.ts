"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import { LOAN_ASSETS_QUERY } from "../graphql/queries";
import type { Asset, LoanAssetsResponse } from "../graphql/types";
import { useChain } from "../context/ChainContext";

export function useLoanAssets(collateralAddresses: string[]) {
  const { chainId } = useChain();
  const [loanAssets, setLoanAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => `${chainId}:${collateralAddresses.slice().sort().join(",")}`,
    [chainId, collateralAddresses]
  );

  useEffect(() => {
    if (collateralAddresses.length === 0) {
      setLoanAssets([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    morphoQuery<LoanAssetsResponse>(LOAN_ASSETS_QUERY, {
      collateralAssets: collateralAddresses,
      chainId: [chainId],
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          // Deduplicate by address
          const seen = new Map<string, Asset>();
          for (const item of data.markets.items) {
            const la = item.loanAsset;
            const addr = la.address.toLowerCase();
            if (!seen.has(addr)) {
              seen.set(addr, {
                symbol: la.symbol,
                name: la.name,
                address: la.address,
                decimals: la.decimals,
                logoURI: la.logoURI,
                priceUsd: la.priceUsd ?? undefined,
              });
            }
          }
          setLoanAssets(Array.from(seen.values()));
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

  return { loanAssets, loading, error };
}
