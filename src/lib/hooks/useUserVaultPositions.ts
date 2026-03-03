"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import type { Vault } from "../graphql/types";

export interface VaultPosition {
  vault: Vault;
  shares: bigint;
  sharesFormatted: string;
}

export function useUserVaultPositions(vaults: Vault[]): {
  positions: VaultPosition[];
  isLoading: boolean;
} {
  const { address: account, isConnected } = useAccount();

  // Vault shares are ERC20 — read balanceOf for each vault
  const contracts = useMemo(() => {
    if (!isConnected || !account || vaults.length === 0) return [];
    return vaults.map((vault) => ({
      address: vault.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [account] as const,
    }));
  }, [vaults, account, isConnected]);

  const { data, isLoading } = useReadContracts({
    contracts: contracts.length > 0 ? contracts : undefined,
    query: {
      enabled: isConnected && contracts.length > 0,
      refetchInterval: 30_000,
    },
  });

  const positions = useMemo(() => {
    if (!data) return [];
    return vaults
      .map((vault, i) => {
        const result = data[i];
        const shares =
          result?.status === "success" ? (result.result as bigint) : 0n;
        if (shares === 0n) return null;
        const decimals = vault.asset.decimals;
        const formatted = (Number(shares) / 10 ** decimals).toFixed(
          Math.min(decimals, 6)
        );
        return { vault, shares, sharesFormatted: formatted } as VaultPosition;
      })
      .filter((p): p is VaultPosition => p !== null);
  }, [vaults, data]);

  return { positions, isLoading };
}
