// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import type { Asset, AssetWithBalance } from "../graphql/types";
import { useChain } from "../context/ChainContext";
import type { SupportedChainId } from "../web3/chains";

/**
 * ERC-20 balances of the connected wallet (or of `addressOverride`).
 *
 * Read on the canvas chain, or on `overrideChainId` for a node that runs on
 * another chain (downstream of a bridge). Without an explicit chain wagmi reads
 * on whatever network the wallet is connected to: a wallet left on Base read
 * mainnet token addresses on Base, showed zeros, and "Insufficient balance"
 * blocked a funded strategy.
 */
export function useTokenBalances(
  assets: Asset[],
  addressOverride?: `0x${string}`,
  overrideChainId?: number
): {
  assetsWithBalances: AssetWithBalance[];
  isLoading: boolean;
} {
  const { chainId: homeChainId } = useChain();
  const chainId = (overrideChainId ?? homeChainId) as SupportedChainId;
  const { address: connected, isConnected: walletConnected } = useAccount();
  // In Safe mode the strategy is built against the Safe's holdings, not the
  // signer's — reading the signer's balances there would be plainly wrong.
  const account = addressOverride ?? connected;
  const isConnected = addressOverride ? true : walletConnected;

  const contracts = useMemo(() => {
    if (!isConnected || !account) return [];
    return assets.map((asset) => ({
      address: asset.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [account] as const,
      chainId,
    }));
  }, [assets, account, isConnected, chainId]);

  const { data, isLoading } = useReadContracts({
    contracts: contracts.length > 0 ? contracts : undefined,
    query: {
      enabled: isConnected && contracts.length > 0,
      refetchInterval: 30_000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    },
  });

  const assetsWithBalances = useMemo(() => {
    return assets.map((asset, i) => {
      const result = data?.[i];
      const rawBalance =
        result?.status === "success" ? (result.result as bigint) : 0n;

      let formatted = "0";
      if (rawBalance > 0n) {
        const divisor = 10n ** BigInt(asset.decimals);
        const intPart = rawBalance / divisor;
        const fracPart = rawBalance % divisor;
        const fracStr = fracPart
          .toString()
          .padStart(asset.decimals, "0")
          .slice(0, 6);
        formatted = `${intPart}.${fracStr}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") || "0";
      }

      return {
        ...asset,
        balance: formatted,
        balanceRaw: rawBalance,
      };
    });
  }, [assets, data]);

  return { assetsWithBalances, isLoading };
}