"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { morphoQuery } from "../graphql/client";
import { VAULTS_QUERY } from "../graphql/queries";
import type { Vault, VaultsResponse } from "../graphql/types";
import { useChain } from "../context/ChainContext";

export function useVaults(assetAddresses: string[]) {
  const { chainId } = useChain();
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => `${chainId}:${assetAddresses.join(",")}`,
    [chainId, assetAddresses]
  );

  useEffect(() => {
    if (assetAddresses.length === 0) {
      setVaults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    morphoQuery<VaultsResponse>(VAULTS_QUERY, {
      assetAddresses,
      chainId: [chainId],
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          const sorted = data.vaults.items
            .filter((v) => v.state.netApy > 0)
            .sort((a, b) => b.state.netApy - a.state.netApy);
          setVaults(sorted);
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

  return { vaults, loading, error };
}
