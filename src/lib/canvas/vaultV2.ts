// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Vault V2 position discovery.
 *
 * The Morpho API exposes V2 positions ONLY via `vaultV2PositionByAddress`
 * (singular — one user, one vault). There is no `vaultV2Positions` query
 * with a `userAddress_in` filter, unlike the legacy `vaultPositions` query.
 *
 * To find all V2 positions a user holds we therefore have to:
 *   1. List all V2 vaults on the chain via GraphQL (currently a few hundred)
 *   2. Multicall `balanceOf(user)` on each vault address (vaults are ERC-4626)
 *   3. Filter to non-zero balances
 *   4. Multicall `convertToAssets(shares)` for the matched set to compute
 *      the asset value, then derive USD via the vault's asset.priceUsd
 *
 * Result is normalized to the same `UserVaultPosition` shape used for V1
 * positions so callers can merge both lists transparently.
 */

import { readContracts } from "wagmi/actions";
import { erc4626Abi } from "viem";
import { wagmiConfig } from "@/lib/web3/config";
import { morphoQuery } from "@/lib/graphql/client";
import { VAULT_V2_LIST_QUERY } from "@/lib/graphql/queries";
import type {
  VaultV2ListResponse,
  VaultV2Listing,
  UserVaultPosition,
} from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";

const PAGE_SIZE = 1000;

/** Fetch all V2 vaults for a chain via paginated GraphQL. */
async function fetchAllV2Vaults(chainId: number): Promise<VaultV2Listing[]> {
  const all: VaultV2Listing[] = [];
  let skip = 0;
  for (let page = 0; page < 10; page++) {
    const data = await morphoQuery<VaultV2ListResponse>(VAULT_V2_LIST_QUERY, {
      chainId: [chainId],
      first: PAGE_SIZE,
      skip,
    });
    const items = data.vaultV2s?.items ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

/**
 * Fetch all V2 vault positions held by `userAddress` on a given chain.
 * Returns positions in the same shape as the V1 `UserVaultPosition` so
 * callers can merge both lists.
 */
export async function fetchUserVaultV2Positions(
  userAddress: `0x${string}`,
  chainId: number
): Promise<UserVaultPosition[]> {
  // 1. List all V2 vaults
  let vaults: VaultV2Listing[];
  try {
    vaults = await fetchAllV2Vaults(chainId);
  } catch (err) {
    console.warn("[vaultV2] failed to list V2 vaults:", err);
    return [];
  }

  if (vaults.length === 0) return [];

  // 2. Multicall balanceOf(user) for every V2 vault
  const balanceContracts = vaults.map((v) => ({
    address: v.address as `0x${string}`,
    abi: erc4626Abi,
    functionName: "balanceOf" as const,
    args: [userAddress] as const,
    chainId: chainId as SupportedChainId,
  }));

  let balances;
  try {
    balances = await readContracts(wagmiConfig, {
      contracts: balanceContracts,
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2] balanceOf multicall failed:", err);
    return [];
  }

  // 3. Filter to non-zero positions and remember their indexes
  type Hit = { vault: VaultV2Listing; shares: bigint };
  const hits: Hit[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const result = balances[i];
    if (!result || result.status !== "success") continue;
    const shares = result.result as bigint;
    if (shares > 0n) hits.push({ vault: vaults[i], shares });
  }

  if (hits.length === 0) return [];

  // 4. For each hit, fetch convertToAssets(shares) to get the actual asset
  // amount (V2 vaults have continuous interest accrual so shares × sharePrice
  // can drift). One additional multicall over a small set.
  const assetContracts = hits.map((h) => ({
    address: h.vault.address as `0x${string}`,
    abi: erc4626Abi,
    functionName: "convertToAssets" as const,
    args: [h.shares] as const,
    chainId: chainId as SupportedChainId,
  }));

  let assetResults;
  try {
    assetResults = await readContracts(wagmiConfig, {
      contracts: assetContracts,
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2] convertToAssets multicall failed:", err);
    // Fall back to using shares directly — assets value will be inaccurate
    // but the position still surfaces.
    assetResults = hits.map(() => ({ status: "failure" as const, result: undefined }));
  }

  // 5. Normalize into UserVaultPosition shape
  return hits.map((h, i) => {
    const assetResult = assetResults[i];
    const assetsRaw =
      assetResult && assetResult.status === "success"
        ? (assetResult.result as bigint)
        : h.shares; // best-effort fallback

    const decimals = h.vault.asset.decimals;
    const assetsFloat = Number(assetsRaw) / 10 ** decimals;
    const priceUsd = h.vault.asset.priceUsd ?? 0;
    const assetsUsd = assetsFloat * priceUsd;

    return {
      vault: {
        address: h.vault.address,
        name: h.vault.name || "Vault V2",
        symbol: h.vault.symbol || "V2",
        asset: {
          symbol: h.vault.asset.symbol,
          address: h.vault.asset.address,
          logoURI: h.vault.asset.logoURI,
          decimals,
        },
        state: {
          netApy: h.vault.netApy ?? 0,
          totalAssetsUsd: h.vault.totalAssetsUsd,
        },
      },
      state: {
        assets: assetsRaw.toString(),
        assetsUsd: assetsUsd > 0 ? assetsUsd : null,
        shares: h.shares.toString(),
      },
    };
  });
}
