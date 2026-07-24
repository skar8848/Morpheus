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
import { VAULT_V2_ADDRESSES_QUERY, VAULT_V2_DETAILS_QUERY } from "@/lib/graphql/queries";
import type { UserVaultPosition } from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";

const PAGE_SIZE = 1000;

type SlimVault = { address: string; decimals: number };
interface V2Details {
  address: string;
  name: string;
  symbol: string;
  netApy: number | null;
  totalAssetsUsd: number | null;
  asset: { symbol: string; address: string; logoURI: string; decimals: number; price?: { usd: number | null } | null };
}

/** Fetch just the addresses (+ decimals) of every listed V2 vault. Cheap. */
async function fetchV2Addresses(chainId: number): Promise<SlimVault[]> {
  const all: SlimVault[] = [];
  let skip = 0;
  for (let page = 0; page < 10; page++) {
    const data = await morphoQuery<{
      vaultV2s: { items: { address: string; asset: { decimals: number } }[] };
    }>(VAULT_V2_ADDRESSES_QUERY, { chainId: [chainId], first: PAGE_SIZE, skip });
    const items = data.vaultV2s?.items ?? [];
    all.push(...items.map((v) => ({ address: v.address, decimals: v.asset.decimals })));
    if (items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

/** Rich details for the user's matched vaults only. */
async function fetchV2Details(chainId: number, addresses: string[]): Promise<Map<string, V2Details>> {
  if (addresses.length === 0) return new Map();
  const data = await morphoQuery<{ vaultV2s: { items: V2Details[] } }>(VAULT_V2_DETAILS_QUERY, {
    chainId: [chainId],
    addresses,
  });
  const map = new Map<string, V2Details>();
  for (const v of data.vaultV2s?.items ?? []) map.set(v.address.toLowerCase(), v);
  return map;
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
  // 1. List every listed V2 vault (addresses only — cheap query).
  let vaults: SlimVault[];
  try {
    vaults = await fetchV2Addresses(chainId);
  } catch (err) {
    console.warn("[vaultV2] failed to list V2 vaults:", err);
    return [];
  }

  if (vaults.length === 0) return [];

  // 2. Multicall balanceOf(user) for every V2 vault.
  let balances;
  try {
    balances = await readContracts(wagmiConfig, {
      contracts: vaults.map((v) => ({
        address: v.address as `0x${string}`,
        abi: erc4626Abi,
        functionName: "balanceOf" as const,
        args: [userAddress] as const,
        chainId: chainId as SupportedChainId,
      })),
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2] balanceOf multicall failed:", err);
    return [];
  }

  // 3. Filter to non-zero positions.
  type Hit = { vault: SlimVault; shares: bigint };
  const hits: Hit[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const result = balances[i];
    if (!result || result.status !== "success") continue;
    const shares = result.result as bigint;
    if (shares > 0n) hits.push({ vault: vaults[i], shares });
  }

  if (hits.length === 0) return [];

  // 4. Rich details + convertToAssets, both scoped to the matched vaults only.
  let details: Map<string, V2Details>;
  try {
    details = await fetchV2Details(chainId, hits.map((h) => h.vault.address));
  } catch (err) {
    console.warn("[vaultV2] failed to fetch V2 details:", err);
    details = new Map();
  }

  let assetResults;
  try {
    assetResults = await readContracts(wagmiConfig, {
      contracts: hits.map((h) => ({
        address: h.vault.address as `0x${string}`,
        abi: erc4626Abi,
        functionName: "convertToAssets" as const,
        args: [h.shares] as const,
        chainId: chainId as SupportedChainId,
      })),
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2] convertToAssets multicall failed:", err);
    assetResults = hits.map(() => ({ status: "failure" as const, result: undefined }));
  }

  // 5. Normalize into UserVaultPosition shape.
  return hits.map((h, i) => {
    const assetResult = assetResults[i];
    const assetsRaw =
      assetResult && assetResult.status === "success"
        ? (assetResult.result as bigint)
        : h.shares; // best-effort fallback

    const d = details.get(h.vault.address.toLowerCase());
    const decimals = d?.asset.decimals ?? h.vault.decimals;
    const assetsFloat = Number(assetsRaw) / 10 ** decimals;
    const priceUsd = d?.asset.price?.usd ?? 0;
    const assetsUsd = assetsFloat * priceUsd;

    return {
      vault: {
        address: h.vault.address,
        name: d?.name || "Vault V2",
        symbol: d?.symbol || "V2",
        asset: {
          symbol: d?.asset.symbol ?? "",
          address: d?.asset.address ?? h.vault.address,
          logoURI: d?.asset.logoURI ?? "",
          decimals,
        },
        state: {
          netApy: d?.netApy ?? 0,
          totalAssetsUsd: d?.totalAssetsUsd ?? null,
        },
      },
      state: {
        assets: assetsRaw.toString(),
        assetsUsd: assetsUsd > 0 ? assetsUsd : null,
        shares: h.shares.toString(),
        // V2 positions are discovered on-chain (no userAddress-filtered API
        // query), so there's no cost basis to derive earned interest from.
        pnl: null,
        pnlUsd: null,
      },
    };
  });
}
