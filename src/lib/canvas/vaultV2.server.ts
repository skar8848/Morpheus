// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Server-safe Vault V2 position discovery.
 *
 * Mirrors `src/lib/canvas/vaultV2.ts` but uses viem's createPublicClient
 * directly instead of wagmi/actions, so it can run in Edge or Node runtime
 * inside Next.js API routes.
 *
 * The Morpho MCP server's morpho_get_positions tool returns ONLY V1
 * (legacy MetaMorpho) vault positions. V2 vault positions are silently
 * dropped — the agent never sees them. This server-side helper closes that
 * gap so /api/positions can return the complete picture.
 */

import { createPublicClient, http, fallback, erc4626Abi, type PublicClient } from "viem";
import { mainnet, base } from "viem/chains";
import { morphoQuery } from "@/lib/graphql/client";
import { VAULT_V2_LIST_QUERY } from "@/lib/graphql/queries";
import type {
  VaultV2ListResponse,
  VaultV2Listing,
  UserVaultPosition,
} from "@/lib/graphql/types";

const PAGE_SIZE = 1000;

// Lazy-init public clients per chain. Edge runtime caches modules between
// requests so this is effectively a singleton.
// Typed loosely as PublicClient<any, any> because mainnet and base produce
// incompatible generic types when cached side-by-side in a Map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clients = new Map<number, PublicClient<any, any>>();

function getClient(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached as PublicClient;

  let c: PublicClient;
  if (chainId === 1) {
    c = createPublicClient({
      chain: mainnet,
      transport: fallback([
        http("https://1rpc.io/eth"),
        http("https://rpc.ankr.com/eth"),
        http("https://eth.llamarpc.com"),
        http(),
      ]),
    }) as PublicClient;
  } else if (chainId === 8453) {
    c = createPublicClient({
      chain: base,
      transport: fallback([
        http("https://1rpc.io/base"),
        http("https://rpc.ankr.com/base"),
        http("https://base.llamarpc.com"),
        http(),
      ]),
    }) as PublicClient;
  } else {
    throw new Error(`Unsupported chain ${chainId}`);
  }

  clients.set(chainId, c);
  return c;
}

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
 * Server-safe variant — uses viem `multicall` directly via a public client.
 * Returns positions in the same UserVaultPosition shape as the client helper.
 */
export async function fetchUserVaultV2PositionsServer(
  userAddress: `0x${string}`,
  chainId: number
): Promise<UserVaultPosition[]> {
  let vaults: VaultV2Listing[];
  try {
    vaults = await fetchAllV2Vaults(chainId);
  } catch (err) {
    console.warn("[vaultV2.server] V2 list fetch failed:", err);
    return [];
  }

  if (vaults.length === 0) return [];

  const client = getClient(chainId);

  // Multicall balanceOf for every V2 vault
  let balances;
  try {
    balances = await client.multicall({
      contracts: vaults.map((v) => ({
        address: v.address as `0x${string}`,
        abi: erc4626Abi,
        functionName: "balanceOf" as const,
        args: [userAddress] as const,
      })),
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2.server] balanceOf multicall failed:", err);
    return [];
  }

  type Hit = { vault: VaultV2Listing; shares: bigint };
  const hits: Hit[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const r = balances[i];
    if (!r || r.status !== "success") continue;
    const shares = r.result as bigint;
    if (shares > 0n) hits.push({ vault: vaults[i], shares });
  }

  if (hits.length === 0) return [];

  // Phase 2: convertToAssets for the small set with non-zero balances
  let assetResults;
  try {
    assetResults = await client.multicall({
      contracts: hits.map((h) => ({
        address: h.vault.address as `0x${string}`,
        abi: erc4626Abi,
        functionName: "convertToAssets" as const,
        args: [h.shares] as const,
      })),
      allowFailure: true,
    });
  } catch (err) {
    console.warn("[vaultV2.server] convertToAssets multicall failed:", err);
    assetResults = hits.map(() => ({ status: "failure" as const, result: undefined }));
  }

  return hits.map((h, i) => {
    const ar = assetResults[i];
    const assetsRaw =
      ar && ar.status === "success" ? (ar.result as bigint) : h.shares;
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
