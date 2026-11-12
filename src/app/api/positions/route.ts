// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * GET /api/positions?address=0x...&chain=ethereum|base
 *
 * Returns ALL Morpho positions held by an address — V1 (legacy MetaMorpho)
 * AND V2 vault positions, plus all market positions (borrows + supplies).
 *
 * This exists because the public Morpho MCP server's `morpho_get_positions`
 * tool only returns V1 vault positions — V2 vaults are silently dropped.
 * Agents using the Morpheus skill should call THIS endpoint instead of the
 * Morpho MCP when discovering a user's positions, so they don't miss V2
 * vault deposits (which is most new vaults on Ethereum/Base today).
 *
 * Response shape (flat, agent-friendly):
 *   {
 *     "ok": true,
 *     "address": "0x...",
 *     "chain": "ethereum",
 *     "marketPositions": [
 *       {
 *         "marketId": "0x...",
 *         "collateralSymbol": "wstETH",
 *         "collateralAddress": "0x...",
 *         "loanSymbol": "EURCV",
 *         "loanAddress": "0x...",
 *         "collateral": "920000000000000000",
 *         "collateralUsd": 3500.42,
 *         "borrow": "1300080000000000000000",
 *         "borrowUsd": 1300.08,
 *         "healthFactor": 1.85,
 *         "lltv": "860000000000000000"
 *       }
 *     ],
 *     "vaultPositions": [
 *       {
 *         "vaultAddress": "0x...",
 *         "vaultName": "Steakhouse Prime Instant EURCV",
 *         "assetSymbol": "EURCV",
 *         "assetAddress": "0x...",
 *         "assetDecimals": 18,
 *         "shares": "...",
 *         "assets": "...",
 *         "assetsUsd": 1200.50,
 *         "version": "v2"
 *       }
 *     ]
 *   }
 *
 * CORS is permissive (`*`) so any agent can call from anywhere.
 */

import { isAddress } from "viem";
import { morphoQuery } from "@/lib/graphql/client";
import {
  USER_MARKET_POSITIONS_QUERY,
  USER_VAULT_POSITIONS_QUERY,
} from "@/lib/graphql/queries";
import type {
  UserMarketPositionsResponse,
  UserVaultPositionsResponse,
} from "@/lib/graphql/types";
import { fetchUserVaultV2PositionsServer } from "@/lib/canvas/vaultV2.server";

// Use Node runtime — viem multicall via createPublicClient is faster on Node
// than Edge for this workload (multiple RPC roundtrips).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const CHAIN_SLUG_TO_ID: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  "1": 1,
  base: 8453,
  "8453": 8453,
};

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function safeBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v !== "string" && typeof v !== "number") return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addressParam = url.searchParams.get("address");
  const chainParam = (url.searchParams.get("chain") ?? "ethereum").toLowerCase();

  if (!addressParam || !isAddress(addressParam)) {
    return jsonError(400, "Missing or invalid `address` query param (must be 0x...)");
  }
  const userAddress = addressParam.toLowerCase() as `0x${string}`;

  const chainId = CHAIN_SLUG_TO_ID[chainParam];
  if (!chainId) {
    return jsonError(
      400,
      `Unknown chain "${chainParam}". Supported: ethereum, base`
    );
  }
  const chainSlug = chainId === 1 ? "ethereum" : "base";

  // V2 discovery is a multicall over public RPCs and can fail on its own; it is
  // reported in `warnings` rather than failing the whole call. The two Morpho
  // API queries are not optional: if they fail, an empty list would read as
  // "this address holds nothing", and an agent would act on that.
  const warnings: string[] = [];
  let upstreamFailed = false;
  const upstream = <T,>(p: Promise<T>) =>
    p.catch((err) => {
      upstreamFailed = true;
      throw err;
    });

  try {
    const [marketData, vaultV1Data, v2Positions] = await Promise.all([
      upstream(
        morphoQuery<UserMarketPositionsResponse>(USER_MARKET_POSITIONS_QUERY, {
          userAddress: [userAddress],
          chainId: [chainId],
        })
      ),
      upstream(
        morphoQuery<UserVaultPositionsResponse>(USER_VAULT_POSITIONS_QUERY, {
          userAddress: [userAddress],
          chainId: [chainId],
        })
      ),
      fetchUserVaultV2PositionsServer(userAddress, chainId).catch((err) => {
        console.warn("[/api/positions] V2 fetch failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`V2 vault discovery failed, V2 positions may be missing: ${msg.slice(0, 200)}`);
        return [];
      }),
    ]);

    // Filter active market positions (any of: borrow, supply, collateral > 0)
    const activeMarkets = marketData.marketPositions.items.filter((p) => {
      if (!p.state) return false;
      const hasBorrow = safeBigInt(p.state.borrowAssets) > 0n;
      const hasSupply = safeBigInt(p.state.supplyAssets) > 0n;
      const hasCollateral = safeBigInt(p.state.collateral) > 0n;
      return hasBorrow || hasSupply || hasCollateral;
    });

    // Filter active V1 vault positions
    const activeV1Vaults = vaultV1Data.vaultPositions.items.filter(
      (p) => p.state && safeBigInt(p.state.shares) > 0n
    );

    // Merge V1 + V2 vaults by address (V1 wins on conflict — there shouldn't be any)
    const seenAddresses = new Set(
      activeV1Vaults.map((p) => p.vault.address.toLowerCase())
    );
    const mergedV2 = v2Positions.filter(
      (p) => !seenAddresses.has(p.vault.address.toLowerCase())
    );

    // Build the flat agent-friendly response
    const marketPositions = activeMarkets.map((p) => ({
      marketId: p.market.uniqueKey,
      collateralSymbol: p.market.collateralAsset.symbol,
      collateralAddress: p.market.collateralAsset.address,
      collateralDecimals: p.market.collateralAsset.decimals,
      loanSymbol: p.market.loanAsset.symbol,
      loanAddress: p.market.loanAsset.address,
      loanDecimals: p.market.loanAsset.decimals,
      collateral: p.state?.collateral ?? "0",
      collateralUsd: p.state?.collateralUsd ?? null,
      supply: p.state?.supplyAssets ?? "0",
      supplyUsd: p.state?.supplyAssetsUsd ?? null,
      borrow: p.state?.borrowAssets ?? "0",
      borrowUsd: p.state?.borrowAssetsUsd ?? null,
      healthFactor: p.healthFactor,
      lltv: p.market.lltv,
    }));

    const vaultPositions = [
      ...activeV1Vaults.map((p) => ({
        vaultAddress: p.vault.address,
        vaultName: p.vault.name,
        vaultSymbol: p.vault.symbol,
        assetSymbol: p.vault.asset.symbol,
        assetAddress: p.vault.asset.address,
        assetDecimals: p.vault.asset.decimals,
        shares: p.state?.shares ?? "0",
        assets: p.state?.assets ?? "0",
        assetsUsd: p.state?.assetsUsd ?? null,
        netApy: p.vault.state.netApy,
        version: "v1" as const,
      })),
      ...mergedV2.map((p) => ({
        vaultAddress: p.vault.address,
        vaultName: p.vault.name,
        vaultSymbol: p.vault.symbol,
        assetSymbol: p.vault.asset.symbol,
        assetAddress: p.vault.asset.address,
        assetDecimals: p.vault.asset.decimals,
        shares: p.state?.shares ?? "0",
        assets: p.state?.assets ?? "0",
        assetsUsd: p.state?.assetsUsd ?? null,
        netApy: p.vault.state.netApy,
        version: "v2" as const,
      })),
    ];

    return new Response(
      JSON.stringify({
        ok: true,
        address: userAddress,
        chain: chainSlug,
        chainId,
        marketPositions,
        vaultPositions,
        counts: {
          markets: marketPositions.length,
          vaultsV1: activeV1Vaults.length,
          vaultsV2: mergedV2.length,
        },
        ...(warnings.length > 0 ? { warnings } : {}),
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/positions] failed:", msg);
    if (upstreamFailed) {
      // Outage, timeout or a query the API rejects: either way nothing is known.
      return jsonError(502, `Morpho API error, positions unknown: ${msg.slice(0, 200)}`);
    }
    return jsonError(500, `Failed to fetch positions: ${msg.slice(0, 200)}`);
  }
}
