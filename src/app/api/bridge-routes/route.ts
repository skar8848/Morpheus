// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Unified bridge route quoting.
 *
 * Queries every rail we support in parallel and returns one comparable list
 * (the client ranks/renders; see useBridgeRoutes):
 *
 *   - CCTP v2  — Circle Iris fee schedule. Keyless. This is the *native* rail
 *                our own executor implements (depositForBurn), so it stays
 *                quoted separately from any aggregator-wrapped CCTP route.
 *   - LI.FI    — aggregator covering Stargate V2 (Fast + Economy), Across,
 *                Relay, Eco, Mayan… Keyless; a free key only raises rate
 *                limits. This is what surfaces Stargate today, since
 *                LayerZero's own Value Transfer API is partner-gated.
 *   - LayerZero VT — optional, only when LAYERZERO_API_KEY is set.
 *
 * Rate limits: LI.FI allows ~75 route requests / 2h without a key, so results
 * are cached in-process (QUOTE_TTL_MS) and the client debounces.
 */

const IRIS_FEES = "https://iris-api.circle.com/v2/burn/USDC/fees";
const LIFI_ROUTES = "https://li.quest/v1/advanced/routes";
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

/** Quote-only placeholder when no wallet is connected. */
const PLACEHOLDER_WALLET = "0x1234567890123456789012345678901234567890";

const QUOTE_TTL_MS = 30_000;

export interface ApiRoute {
  id: string;
  name: string;
  provider: "cctp" | "lifi" | "stargate";
  /** Aggregator tool key, e.g. "stargateV2Bus". */
  tool?: string;
  logoURI?: string;
  /** Destination amount in raw token units, when the rail quotes it. */
  dstAmount: string | null;
  dstAmountUsd: number | null;
  feeUsd: number | null;
  feeBps: number | null;
  gasUsd: number | null;
  etaSeconds: number | null;
  preferred?: boolean;
  unavailable?: string;
}

// --- tiny in-process TTL cache (keeps us under LI.FI's keyless rate limit) ---
const cache = new Map<string, { at: number; routes: ApiRoute[] }>();

function cacheGet(key: string): ApiRoute[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > QUOTE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.routes;
}

function cacheSet(key: string, routes: ApiRoute[]) {
  // Bound the map so a long-lived instance can't grow without limit.
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), routes });
}

// --- providers ---

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
        gasUsd: null,
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

interface LifiStep {
  tool?: string;
  toolDetails?: { key?: string; name?: string; logoURI?: string };
  estimate?: {
    executionDuration?: number;
    feeCosts?: { amountUSD?: string }[];
  };
}

async function lifiRoutes(
  srcChainId: number,
  dstChainId: number,
  srcToken: string,
  dstToken: string,
  amountRaw: string,
  wallet: string
): Promise<ApiRoute[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Optional: a free self-serve key (portal.li.fi) only raises rate limits.
    if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;

    const res = await fetch(LIFI_ROUTES, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fromChainId: srcChainId,
        toChainId: dstChainId,
        fromTokenAddress: srcToken,
        toTokenAddress: dstToken,
        fromAmount: amountRaw,
        fromAddress: wallet,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const reason =
        res.status === 429 ? "LI.FI rate limit reached — retry shortly" : `LI.FI ${res.status}`;
      return [
        {
          id: "lifi",
          name: "Bridges (LI.FI)",
          provider: "lifi",
          dstAmount: null,
          dstAmountUsd: null,
          feeUsd: null,
          feeBps: null,
          gasUsd: null,
          etaSeconds: null,
          unavailable: reason,
        },
      ];
    }

    const data = (await res.json()) as {
      routes?: {
        id?: string;
        steps?: LifiStep[];
        toAmount?: string;
        toAmountUSD?: string;
        fromAmountUSD?: string;
        gasCostUSD?: string;
      }[];
    };

    return (data.routes ?? []).map((r, i) => {
      const steps = r.steps ?? [];
      const head = steps[0];
      const fromUsd = Number(r.fromAmountUSD ?? 0);
      const toUsd = Number(r.toAmountUSD ?? 0);
      const feeUsd = steps.reduce(
        (sum, s) => sum + (s.estimate?.feeCosts ?? []).reduce((a, f) => a + Number(f.amountUSD ?? 0), 0),
        0
      );
      const eta = steps.reduce((sum, s) => sum + (s.estimate?.executionDuration ?? 0), 0);
      const gasUsd = Number(r.gasCostUSD ?? 0);
      const tool = head?.tool;

      return {
        id: r.id ? `lifi-${r.id}` : `lifi-${i}`,
        name: head?.toolDetails?.name ?? "LI.FI route",
        // Tag Stargate routes as such so the UI can group/badge them.
        provider: tool?.toLowerCase().startsWith("stargate") ? "stargate" : "lifi",
        tool,
        logoURI: head?.toolDetails?.logoURI,
        dstAmount: r.toAmount ?? null,
        dstAmountUsd: isFinite(toUsd) && toUsd > 0 ? toUsd : null,
        feeUsd: isFinite(feeUsd) ? feeUsd : null,
        feeBps: fromUsd > 0 && isFinite(feeUsd) ? (feeUsd / fromUsd) * 10_000 : null,
        gasUsd: isFinite(gasUsd) ? gasUsd : null,
        etaSeconds: eta > 0 ? eta : null,
      } satisfies ApiRoute;
    });
  } catch (err) {
    return [
      {
        id: "lifi",
        name: "Bridges (LI.FI)",
        provider: "lifi",
        dstAmount: null,
        dstAmountUsd: null,
        feeUsd: null,
        feeBps: null,
        gasUsd: null,
        etaSeconds: null,
        unavailable: err instanceof Error ? err.message : "quote failed",
      },
    ];
  }
}

/** Native Stargate via LayerZero's Value Transfer API — partner-gated, opt-in. */
async function layerZeroRoutes(
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
  if (!apiKey || !srcKey || !dstKey) return [];

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
    if (!res.ok) return [];

    const data = (await res.json()) as {
      quotes?: {
        id?: string;
        duration?: { estimated?: string | null };
        feeUsd?: string;
        dstAmount?: string;
        dstAmountUsd?: string;
        srcAmountUsd?: string;
      }[];
    };

    return (data.quotes ?? []).map((q, i) => {
      const srcUsd = Number(q.srcAmountUsd ?? 0);
      const feeUsd = Number(q.feeUsd ?? 0);
      const dstUsd = Number(q.dstAmountUsd ?? 0);
      return {
        id: q.id ? `lz-${q.id}` : `lz-${i}`,
        name: "Stargate (native)",
        provider: "stargate" as const,
        dstAmount: q.dstAmount ?? null,
        dstAmountUsd: isFinite(dstUsd) && dstUsd > 0 ? dstUsd : null,
        feeUsd: isFinite(feeUsd) ? feeUsd : null,
        feeBps: srcUsd > 0 && isFinite(feeUsd) ? (feeUsd / srcUsd) * 10_000 : null,
        gasUsd: null,
        etaSeconds: q.duration?.estimated ? Number(q.duration.estimated) : null,
      };
    });
  } catch {
    return [];
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
    return Response.json(
      { ok: false, error: "distinct srcChainId and dstChainId required" },
      { status: 400 }
    );
  }

  const key = `${srcChainId}:${dstChainId}:${srcToken}:${dstToken}:${amountRaw}:${isUsdc}`;
  const cached = cacheGet(key);
  if (cached) return Response.json({ ok: true, routes: cached, cached: true });

  const canQuoteAggregators =
    /^0x[0-9a-fA-F]{40}$/.test(srcToken) && /^0x[0-9a-fA-F]{40}$/.test(dstToken) && amountRaw !== "0";

  const [cctp, lifi, lz] = await Promise.all([
    cctpRoutes(srcChainId, dstChainId, amountUsd, isUsdc),
    canQuoteAggregators
      ? lifiRoutes(srcChainId, dstChainId, srcToken, dstToken, amountRaw, wallet)
      : Promise.resolve([] as ApiRoute[]),
    canQuoteAggregators
      ? layerZeroRoutes(srcChainId, dstChainId, srcToken, dstToken, amountRaw, wallet)
      : Promise.resolve([] as ApiRoute[]),
  ]);

  const routes = [...cctp, ...lz, ...lifi];
  cacheSet(key, routes);
  return Response.json({ ok: true, routes });
}
