// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Unified bridge route quoting.
 *
 * Queries every rail we support in parallel and returns them as one comparable
 * list (the client ranks/renders; see useBridgeRoutes):
 *   - CCTP v2  — Circle Iris fee schedule (USDC only, no key needed)
 *   - Stargate — LayerZero Value Transfer API (any supported token, needs a key)
 *
 * The LayerZero key is read from LAYERZERO_API_KEY and never leaves the server.
 */

const IRIS_FEES = "https://iris-api.circle.com/v2/burn/USDC/fees";
const LZ_QUOTES = "https://transfer.layerzero-api.com/v1/quotes";

/** CCTP v2 domain ids (≠ chainId). */
const CCTP_DOMAINS: Record<number, number> = {
  1: 0,
  8453: 6,
  42161: 3,
  999: 19,
  143: 15,
};

/** LayerZero chainKey per chainId — verified against GET /v1/chains. */
const LZ_CHAIN_KEYS: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  999: "hyperliquid",
  143: "monad",
};

/** Quote-only placeholder when no wallet is connected (docs' own example). */
const PLACEHOLDER_WALLET = "0x1234567890123456789012345678901234567890";

export interface ApiRoute {
  id: string;
  name: string;
  provider: "cctp" | "stargate";
  /** Destination amount in raw token units, when the rail quotes it. */
  dstAmount: string | null;
  dstAmountUsd: number | null;
  feeUsd: number | null;
  feeBps: number | null;
  etaSeconds: number | null;
  preferred?: boolean;
  unavailable?: string;
}

async function cctpRoutes(
  srcChainId: number,
  dstChainId: number,
  amountUsd: number,
  isUsdc: boolean
): Promise<ApiRoute[]> {
  const src = CCTP_DOMAINS[srcChainId];
  const dst = CCTP_DOMAINS[dstChainId];
  if (!isUsdc || src === undefined || dst === undefined) return [];

  try {
    const res = await fetch(`${IRIS_FEES}/${src}/${dst}`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const fees = (await res.json()) as { finalityThreshold: number; minimumFee: number }[];
    const fast = fees.find((f) => f.finalityThreshold <= 1000);
    const std = fees.find((f) => f.finalityThreshold >= 2000);

    const mk = (id: string, name: string, bps: number, eta: number, preferred?: boolean): ApiRoute => {
      const feeUsd = (amountUsd * bps) / 10_000;
      return {
        id,
        name,
        provider: "cctp",
        dstAmount: null,
        dstAmountUsd: Math.max(0, amountUsd - feeUsd),
        feeUsd,
        feeBps: bps,
        etaSeconds: eta,
        preferred,
      };
    };

    const out: ApiRoute[] = [];
    if (fast) out.push(mk("cctp-fast", "CCTP v2 · Fast", fast.minimumFee, 15, true));
    // Standard waits for source-chain hard finality: ~15 min on mainnet, ~2 min on L2s.
    if (std) out.push(mk("cctp-standard", "CCTP v2 · Standard", std.minimumFee, srcChainId === 1 ? 900 : 120));
    return out;
  } catch {
    return [];
  }
}

async function stargateRoutes(
  srcChainId: number,
  dstChainId: number,
  srcToken: string,
  dstToken: string,
  amountRaw: string,
  wallet: string
): Promise<ApiRoute[]> {
  const apiKey = process.env.LAYERZERO_API_KEY;
  const srcKey = LZ_CHAIN_KEYS[srcChainId];
  const dstKey = LZ_CHAIN_KEYS[dstChainId];
  if (!srcKey || !dstKey) return [];
  if (!apiKey) {
    return [
      {
        id: "stargate",
        name: "Stargate",
        provider: "stargate",
        dstAmount: null,
        dstAmountUsd: null,
        feeUsd: null,
        feeBps: null,
        etaSeconds: null,
        unavailable: "LAYERZERO_API_KEY not configured",
      },
    ];
  }

  try {
    const res = await fetch(LZ_QUOTES, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        srcChainKey: srcKey,
        dstChainKey: dstKey,
        srcTokenAddress: srcToken,
        dstTokenAddress: dstToken,
        srcWalletAddress: wallet,
        dstWalletAddress: wallet,
        amount: amountRaw,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const reason = res.status === 401 ? "Invalid LayerZero API key" : `LayerZero ${res.status}`;
      return [
        {
          id: "stargate",
          name: "Stargate",
          provider: "stargate",
          dstAmount: null,
          dstAmountUsd: null,
          feeUsd: null,
          feeBps: null,
          etaSeconds: null,
          unavailable: reason,
        },
      ];
    }

    const data = (await res.json()) as {
      quotes?: {
        id?: string;
        routeSteps?: { type?: string; description?: string }[];
        duration?: { estimated?: string | null };
        feeUsd?: string;
        dstAmount?: string;
        dstAmountUsd?: string;
        srcAmountUsd?: string;
      }[];
    };

    const quotes = data.quotes ?? [];
    if (quotes.length === 0) return [];

    return quotes.map((q, i) => {
      const srcUsd = Number(q.srcAmountUsd ?? 0);
      const feeUsd = Number(q.feeUsd ?? 0);
      const dstUsd = Number(q.dstAmountUsd ?? 0);
      // Name the route by its steps when available (e.g. "Stargate · CCTP").
      const step = q.routeSteps?.find((s) => s.type)?.type;
      return {
        id: q.id ? `stargate-${q.id}` : `stargate-${i}`,
        name: step ? `Stargate · ${step}` : "Stargate",
        provider: "stargate" as const,
        dstAmount: q.dstAmount ?? null,
        dstAmountUsd: isFinite(dstUsd) && dstUsd > 0 ? dstUsd : null,
        feeUsd: isFinite(feeUsd) ? feeUsd : null,
        feeBps: srcUsd > 0 && isFinite(feeUsd) ? (feeUsd / srcUsd) * 10_000 : null,
        etaSeconds: q.duration?.estimated ? Number(q.duration.estimated) : null,
      };
    });
  } catch (err) {
    return [
      {
        id: "stargate",
        name: "Stargate",
        provider: "stargate",
        dstAmount: null,
        dstAmountUsd: null,
        feeUsd: null,
        feeBps: null,
        etaSeconds: null,
        unavailable: err instanceof Error ? err.message : "quote failed",
      },
    ];
  }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const srcChainId = Number(p.get("srcChainId"));
  const dstChainId = Number(p.get("dstChainId"));
  const amountUsd = Number(p.get("amountUsd") ?? 0);
  const amountRaw = p.get("amountRaw") ?? "0";
  const srcToken = p.get("srcToken") ?? "";
  const dstToken = p.get("dstToken") ?? "";
  const isUsdc = p.get("isUsdc") === "1";
  const wallet = p.get("wallet") || PLACEHOLDER_WALLET;

  if (!srcChainId || !dstChainId || srcChainId === dstChainId) {
    return Response.json({ ok: false, error: "distinct srcChainId and dstChainId required" }, { status: 400 });
  }

  const canQuoteStargate = /^0x[0-9a-fA-F]{40}$/.test(srcToken) && /^0x[0-9a-fA-F]{40}$/.test(dstToken) && amountRaw !== "0";

  const [cctp, stargate] = await Promise.all([
    cctpRoutes(srcChainId, dstChainId, amountUsd, isUsdc),
    canQuoteStargate
      ? stargateRoutes(srcChainId, dstChainId, srcToken, dstToken, amountRaw, wallet)
      : Promise.resolve([] as ApiRoute[]),
  ]);

  return Response.json({ ok: true, routes: [...cctp, ...stargate] });
}
