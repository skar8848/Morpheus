"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { morphoQuery } from "../graphql/client";
import {
  USER_MARKET_POSITIONS_QUERY,
  USER_VAULT_POSITIONS_QUERY,
} from "../graphql/queries";
import type {
  UserMarketPosition,
  UserVaultPosition,
  UserMarketPositionsResponse,
  UserVaultPositionsResponse,
} from "../graphql/types";
import { useChain } from "../context/ChainContext";

export function useUserPositions() {
  const { chainId } = useChain();
  const { address, isConnected } = useAccount();

  const [marketPositions, setMarketPositions] = useState<UserMarketPosition[]>(
    []
  );
  const [vaultPositions, setVaultPositions] = useState<UserVaultPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setMarketPositions([]);
      setVaultPositions([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    Promise.all([
      morphoQuery<UserMarketPositionsResponse>(USER_MARKET_POSITIONS_QUERY, {
        userAddress: [address],
        chainId: [chainId],
      }),
      morphoQuery<UserVaultPositionsResponse>(USER_VAULT_POSITIONS_QUERY, {
        userAddress: [address],
        chainId: [chainId],
      }),
    ])
      .then(([marketData, vaultData]) => {
        if (controller.signal.aborted) return;

        // Filter out empty positions
        const activeMarkets = marketData.marketPositions.items.filter((p) => {
          if (!p.state) return false;
          const hasBorrow =
            p.state.borrowAssets && BigInt(p.state.borrowAssets) > 0n;
          const hasSupply =
            p.state.supplyAssets && BigInt(p.state.supplyAssets) > 0n;
          const hasCollateral = BigInt(p.state.collateral) > 0n;
          return hasBorrow || hasSupply || hasCollateral;
        });

        const activeVaults = vaultData.vaultPositions.items.filter(
          (p) => p.state && BigInt(p.state.shares) > 0n
        );

        setMarketPositions(activeMarkets);
        setVaultPositions(activeVaults);
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [address, isConnected, chainId]);

  return { marketPositions, vaultPositions, loading, error };
}
