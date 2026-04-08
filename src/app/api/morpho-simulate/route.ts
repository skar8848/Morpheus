// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * POST /api/morpho-simulate
 *
 * Server-side proxy to the Morpho MCP server (https://mcp.morpho.org/).
 *
 * Forwards a list of unsigned transactions to morpho_simulate_transactions
 * and returns the rich post-state analysis (HF, APY deltas, decoded events).
 * Used by the canvas SimulationPreview to enrich the local viem-based diff
 * with verified Morpho-side data.
 *
 * Body:
 *   {
 *     chain: "ethereum" | "base",
 *     from: "0x...",
 *     transactions: [{ to, data, value, chainId }]
 *   }
 *
 * Returns the raw simulate-transactions response from the Morpho MCP, or
 * an error envelope if the call fails.
 *
 * NOTE: The Morpho MCP uses Streamable HTTP transport per the MCP spec.
 * We do a minimal JSON-RPC handshake (initialize → tools/call) per request.
 * This is intentionally stateless on Morpheus's side — no session is reused
 * across requests, which keeps the proxy simple at the cost of one extra
 * round-trip per simulation.
 */

const MORPHO_MCP_URL = "https://mcp.morpho.org/";
const MAX_BODY_BYTES = 200_000;
const REQUEST_TIMEOUT_MS = 25_000;

export const runtime = "nodejs"; // need Node fetch + longer timeout
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

interface SimulateRequest {
  chain: "ethereum" | "base";
  from: string;
  transactions: Array<{
    to: string;
    data: string;
    value?: string;
    chainId?: string;
  }>;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Perform a single JSON-RPC call against the Morpho MCP HTTP endpoint.
 * Handles both plain JSON and SSE responses (the streamable HTTP transport
 * may return either depending on whether the call streams).
 */
async function mcpCall(request: JsonRpcRequest, sessionId?: string): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(MORPHO_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    // Parse SSE: look for "data: {...}" lines
    const text = await res.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          return JSON.parse(payload) as JsonRpcResponse;
        } catch {
          // skip non-JSON SSE lines
        }
      }
    }
    throw new Error("MCP SSE response contained no parseable JSON-RPC payload");
  }

  return (await res.json()) as JsonRpcResponse;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  // Reject oversized payloads
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError(413, `Payload too large (max ${MAX_BODY_BYTES} bytes)`);
  }

  let body: SimulateRequest;
  try {
    body = (await req.json()) as SimulateRequest;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  // Validate
  if (
    !body ||
    typeof body.from !== "string" ||
    !Array.isArray(body.transactions) ||
    (body.chain !== "ethereum" && body.chain !== "base")
  ) {
    return jsonError(400, "Body must include { chain: 'ethereum'|'base', from: '0x...', transactions: [...] }");
  }
  if (body.transactions.length === 0 || body.transactions.length > 50) {
    return jsonError(400, "transactions must be 1-50 items");
  }
  for (const tx of body.transactions) {
    if (typeof tx.to !== "string" || typeof tx.data !== "string") {
      return jsonError(400, "Each transaction must have string 'to' and 'data'");
    }
  }

  // Extract session id from initialize response (if needed)
  let sessionId: string | undefined;

  try {
    // Step 1: initialize handshake
    const initReq: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        clientInfo: { name: "morpheus", version: "0.1.0" },
      },
    };

    const initController = new AbortController();
    const initTimer = setTimeout(() => initController.abort(), REQUEST_TIMEOUT_MS);
    let initRes: Response;
    try {
      initRes = await fetch(MORPHO_MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(initReq),
        signal: initController.signal,
      });
    } finally {
      clearTimeout(initTimer);
    }

    if (!initRes.ok) {
      throw new Error(`MCP initialize HTTP ${initRes.status}: ${await initRes.text().then((t) => t.slice(0, 200))}`);
    }
    sessionId = initRes.headers.get("mcp-session-id") ?? undefined;

    // Drain the initialize response so the connection cleans up
    try {
      await initRes.text();
    } catch { /* ignore */ }

    // Step 2: notifications/initialized (some servers require this)
    if (sessionId) {
      try {
        await fetch(MORPHO_MCP_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-session-id": sessionId,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }),
        });
      } catch { /* notification — best effort */ }
    }

    // Step 3: tools/call → morpho_simulate_transactions
    const callReq: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "morpho_simulate_transactions",
        arguments: {
          chain: body.chain,
          from: body.from,
          transactions: body.transactions,
        },
      },
    };

    const callRes = await mcpCall(callReq, sessionId);

    if (callRes.error) {
      return jsonError(
        502,
        `Morpho MCP error: ${callRes.error.message} (code ${callRes.error.code})`
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: callRes.result,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[morpho-simulate] failed:", msg);
    return jsonError(502, `Failed to reach Morpho MCP: ${msg.slice(0, 200)}`);
  }
}
