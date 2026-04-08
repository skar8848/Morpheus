// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * POST /api/canvas/validate
 *
 * Validates a Morpheus canvas JSON without storing or producing a deep link.
 * Useful for AI agents that want to verify their generated canvas before
 * presenting it to a user.
 *
 * Body: same shape as POST /api/canvas (an ImportedStrategy)
 *
 * Returns:
 *   {
 *     "ok": true,
 *     "warnings": []  // currently always empty; reserved for future graph-level checks
 *   }
 *
 * Or on failure:
 *   {
 *     "ok": false,
 *     "errors": ["..."]
 *   }
 */

import { NextResponse } from "next/server";
import { isValidImportedStrategyForApi } from "@/lib/canvas/api";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

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

  const validation = isValidImportedStrategyForApi(body);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, errors: validation.errors },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      warnings: [],
      nodeCount: validation.strategy.nodes.length,
      edgeCount: validation.strategy.edges.length,
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
