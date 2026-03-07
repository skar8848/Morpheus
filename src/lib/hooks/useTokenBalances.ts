"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import type { Asset, AssetWithBalance } from "../graphql/types";

export function useTokenBalances(assets: Asset[]): {
  assetsWithBalances: AssetWithBalance[];
  isLoading: boolean;
} {
  const { address: account, isConnected } = useAccount();

  const contracts = useMemo(() => {
    if (!isConnected || !account) return [];
    return assets.map((asset) => ({
      address: asset.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [account] as const,
    }));
  }, [assets, account, isConnected]);

  const { data, isLoading } = useReadContracts({
    contracts: contracts.length > 0 ? contracts : undefined,
    query: {
      enabled: isConnected && contracts.length > 0,
      refetchInterval: 30_000,
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
        formatted = `${intPart}.${fracStr}`.replace(/\.?0+$/, "") || "0";
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
