// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * CCTP v2 bridge fee proxy.
 *
 * Circle's Iris API (`iris-api.circle.com`) publishes the per-route fee schedule
 * for USDC burns. We proxy it server-side to dodge browser CORS and to cache the
 * (slow-moving) fee for a short window.
 *
 * Iris returns, for a source→destination domain pair:
 *   [{ finalityThreshold: 1000, minimumFee: <bps> },   // Fast Transfer
 *    { finalityThreshold: 2000, minimumFee: 0 }]        // Standard (free, slower)
 * where `minimumFee` is the fee in basis points (can be fractional).
 */

const IRIS_BASE = "https://iris-api.circle.com/v2/burn/USDC/fees";

interface IrisFee {
  finalityThreshold: number;
  minimumFee: number;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const src = searchParams.get("src");
  const dst = searchParams.get("dst");

  if (src === null || dst === null || !/^\d+$/.test(src) || !/^\d+$/.test(dst)) {
    return Response.json({ ok: false, error: "src and dst domain ids required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${IRIS_BASE}/${src}/${dst}`, {
      // Fees move slowly; cache 5 min at the edge.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: `Iris ${res.status}` }, { status: 502 });
    }
    const fees = (await res.json()) as IrisFee[];
    const fast = fees.find((f) => f.finalityThreshold <= 1000);
    const standard = fees.find((f) => f.finalityThreshold >= 2000);
    return Response.json({
      ok: true,
      fastFeeBps: fast?.minimumFee ?? null,
      standardFeeBps: standard?.minimumFee ?? 0,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }
}
