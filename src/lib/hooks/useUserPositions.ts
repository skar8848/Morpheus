// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

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
import { safeBigInt } from "../utils/bigint";
import { fetchUserVaultV2Positions } from "../canvas/vaultV2";

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
      // V2 vaults are NOT in `vaultPositions` — discover via list + multicall
      fetchUserVaultV2Positions(address, chainId).catch((err) => {
        console.warn("[useUserPositions] V2 fetch failed:", err);
        return [];
      }),
    ])
      .then(([marketData, vaultData, v2Positions]) => {
        if (controller.signal.aborted) return;

        // Filter out empty positions
        const activeMarkets = marketData.marketPositions.items.filter((p) => {
          if (!p.state) return false;
          const hasBorrow = safeBigInt(p.state.borrowAssets) > 0n;
          const hasSupply = safeBigInt(p.state.supplyAssets) > 0n;
          const hasCollateral = safeBigInt(p.state.collateral) > 0n;
          return hasBorrow || hasSupply || hasCollateral;
        });

        const activeV1Vaults = vaultData.vaultPositions.items.filter(
          (p) => p.state && safeBigInt(p.state.shares) > 0n
        );

        // Merge V1 + V2, dedupe by vault address (V1 wins on conflict)
        const seenAddresses = new Set(
          activeV1Vaults.map((p) => p.vault.address.toLowerCase())
        );
        const mergedV2 = v2Positions.filter(
          (p) => !seenAddresses.has(p.vault.address.toLowerCase())
        );

        setMarketPositions(activeMarkets);
        setVaultPositions([...activeV1Vaults, ...mergedV2]);
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