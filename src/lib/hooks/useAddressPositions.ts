// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { morphoQuery } from "../graphql/client";
import {
  USER_MARKET_POSITIONS_QUERY,
  USER_VAULT_POSITIONS_QUERY,
  USER_TRANSACTIONS_QUERY,
} from "../graphql/queries";
import type {
  UserMarketPosition,
  UserVaultPosition,
  UserMarketPositionsResponse,
  UserVaultPositionsResponse,
  MorphoTransaction,
  TransactionsResponse,
} from "../graphql/types";
import { safeBigInt } from "../utils/bigint";
import { fetchUserVaultV2Positions } from "../canvas/vaultV2";

interface AddressData {
  marketPositions: UserMarketPosition[];
  vaultPositions: UserVaultPosition[];
  transactions: MorphoTransaction[];
  loading: boolean;
  error: string | null;
  loadMoreTransactions: () => void;
  hasMore: boolean;
}

const TX_PAGE_SIZE = 50;
const MAX_TRANSACTIONS = 1000;

export function useAddressPositions(
  address: string | null,
  chainId: number
): AddressData {
  const [marketPositions, setMarketPositions] = useState<UserMarketPosition[]>([]);
  const [vaultPositions, setVaultPositions] = useState<UserVaultPosition[]>([]);
  const [transactions, setTransactions] = useState<MorphoTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const skipRef = useRef(0);
  const loadingMoreRef = useRef(false);
  // Track current address to detect stale loadMore responses
  const addressRef = useRef(address);
  addressRef.current = address;

  // Initial fetch: positions + first page of transactions
  useEffect(() => {
    if (!address) {
      setMarketPositions([]);
      setVaultPositions([]);
      setTransactions([]);
      setHasMore(true);
      skipRef.current = 0;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    skipRef.current = 0;

    Promise.all([
      morphoQuery<UserMarketPositionsResponse>(USER_MARKET_POSITIONS_QUERY, {
        userAddress: [address],
        chainId: [chainId],
      }),
      morphoQuery<UserVaultPositionsResponse>(USER_VAULT_POSITIONS_QUERY, {
        userAddress: [address],
        chainId: [chainId],
      }),
      morphoQuery<TransactionsResponse>(USER_TRANSACTIONS_QUERY, {
        userAddress: [address],
        chainId: [chainId],
        first: TX_PAGE_SIZE,
        skip: 0,
      }),
      // V2 vaults are NOT in `vaultPositions` — discover via list + multicall
      fetchUserVaultV2Positions(address as `0x${string}`, chainId).catch((err) => {
        console.warn("[useAddressPositions] V2 fetch failed:", err);
        return [];
      }),
    ])
      .then(([marketData, vaultData, txData, v2Positions]) => {
        if (controller.signal.aborted) return;

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

        // Merge V1 + V2, dedupe by vault address
        const seenAddresses = new Set(
          activeV1Vaults.map((p) => p.vault.address.toLowerCase())
        );
        const mergedV2 = v2Positions.filter(
          (p) => !seenAddresses.has(p.vault.address.toLowerCase())
        );

        setMarketPositions(activeMarkets);
        setVaultPositions([...activeV1Vaults, ...mergedV2]);
        setTransactions(txData.transactions.items);
        setHasMore(txData.transactions.items.length === TX_PAGE_SIZE);
        skipRef.current = TX_PAGE_SIZE;
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [address, chainId]);

  const loadMoreTransactions = useCallback(() => {
    if (!address || !hasMore || loadingMoreRef.current) return;
    if (skipRef.current >= MAX_TRANSACTIONS) {
      setHasMore(false);
      return;
    }

    loadingMoreRef.current = true;
    const fetchAddress = address; // capture for stale check

    morphoQuery<TransactionsResponse>(USER_TRANSACTIONS_QUERY, {
      userAddress: [address],
      chainId: [chainId],
      first: TX_PAGE_SIZE,
      skip: skipRef.current,
    })
      .then((txData) => {
        // Discard if address changed while fetching
        if (addressRef.current !== fetchAddress) return;
        const newTxs = txData.transactions.items;
        setTransactions((prev) => [...prev, ...newTxs]);
        setHasMore(newTxs.length === TX_PAGE_SIZE && skipRef.current + TX_PAGE_SIZE < MAX_TRANSACTIONS);
        skipRef.current += TX_PAGE_SIZE;
      })
      .catch(() => {
        setHasMore(false);
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [address, chainId, hasMore]);

  return {
    marketPositions,
    vaultPositions,
    transactions,
    loading,
    error,
    loadMoreTransactions,
    hasMore,
  };
}