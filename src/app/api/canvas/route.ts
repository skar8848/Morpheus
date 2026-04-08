// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * POST /api/canvas
 *
 * Stateless canvas API for AI agents and external integrations.
 *
 * Body: a JSON document matching the ImportedStrategy shape.
 *   {
 *     "nodes": [...],
 *     "edges": [...],
 *     "sourceAddress": "0x..."
 *   }
 *
 * Optional `chain` query param (or top-level `chain` field) selects the
 * canvas chain segment in the returned URL. Defaults to "ethereum".
 *
 * Returns:
 *   {
 *     "ok": true,
 *     "deepLinkUrl": "https://morpheus-app.vercel.app/ethereum/canvas?strategy=...",
 *     "warnings": []
 *   }
 *
 * Or on validation failure:
 *   {
 *     "ok": false,
 *     "errors": ["..."]
 *   }
 *
 * The endpoint is fully stateless — the canvas IS the URL. Nothing is
 * persisted server-side. Morpheus rejects payloads larger than 100 KB.
 *
 * CORS is permissive (Access-Control-Allow-Origin: *) so any origin
 * (CLI, agent, third-party app) can call it.
 */

import { NextResponse } from "next/server";
import {
  isValidImportedStrategyForApi,
  buildDeepLinkPayload,
  type CanvasApiRequest,
} from "@/lib/canvas/api";

export const runtime = "edge"; // fast, low-overhead
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

const VALID_CHAIN_SLUGS = new Set(["ethereum", "base"]);

function jsonError(status: number, message: string, extra: object = {}) {
  return NextResponse.json(
    { ok: false, errors: [message], ...extra },
    { status, headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  // Reject oversized payloads early via content-length when present
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError(413, `Payload too large (max ${MAX_BODY_BYTES} bytes)`);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return jsonError(400, "Body must be a JSON object");
  }

  const { chain, ...strategyPayload } = body as CanvasApiRequest;

  // Resolve chain
  const url = new URL(req.url);
  const chainSlug =
    (typeof chain === "string" && chain) ||
    url.searchParams.get("chain") ||
    "ethereum";

  if (!VALID_CHAIN_SLUGS.has(chainSlug)) {
    return jsonError(400, `Unknown chain "${chainSlug}". Supported: ethereum, base`);
  }

  // Validate the strategy shape
  const validation = isValidImportedStrategyForApi(strategyPayload);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, errors: validation.errors },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Build the deep link
  let deepLinkPayload: string;
  try {
    deepLinkPayload = buildDeepLinkPayload(validation.strategy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(500, `Failed to encode deep link: ${msg}`);
  }

  // Origin from request — use the request URL's origin so it works on any deploy
  const origin = url.origin;
  const deepLinkUrl = `${origin}/${chainSlug}/canvas?strategy=${deepLinkPayload}`;

  return NextResponse.json(
    {
      ok: true,
      deepLinkUrl,
      strategyHash: deepLinkPayload.slice(0, 12), // short identifier for logs/sharing
      chain: chainSlug,
      nodeCount: validation.strategy.nodes.length,
      edgeCount: validation.strategy.edges.length,
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
