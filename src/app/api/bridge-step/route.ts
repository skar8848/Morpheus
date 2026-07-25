// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Build the executable transaction for a bridge route (LI.FI rail).
 *
 * Quotes expire, so the flow is: re-quote at execution time, pick the route the
 * user selected (matched on `tool`, which is stable across quotes — the numeric
 * route id is not), then ask LI.FI for the transaction to sign.
 *
 * Returns the approval target and a ready transactionRequest; LI.FI's own
 * relayers deliver on the destination chain, so this is a single user
 * transaction rather than a multi-phase settlement.
 */

const LIFI_ROUTES = "https://li.quest/v1/advanced/routes";
const LIFI_STEP_TX = "https://li.quest/v1/advanced/stepTransaction";

interface LifiStep {
  tool?: string;
  toolDetails?: { name?: string };
  estimate?: { approvalAddress?: string; toAmountMin?: string; executionDuration?: number };
}

interface LifiRoute {
  id?: string;
  steps?: LifiStep[];
  toAmount?: string;
  toAmountMin?: string;
  gasCostUSD?: string;
}

function lifiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.LIFI_API_KEY) h["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  return h;
}

export async function POST(req: Request) {
  let body: {
    srcChainId?: number;
    dstChainId?: number;
    srcToken?: string;
    dstToken?: string;
    amountRaw?: string;
    wallet?: string;
    tool?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { srcChainId, dstChainId, srcToken, dstToken, amountRaw, wallet, tool } = body;

  if (!srcChainId || !dstChainId || srcChainId === dstChainId) {
    return Response.json({ ok: false, error: "distinct source and destination chains required" }, { status: 400 });
  }
  if (!srcToken || !dstToken || !amountRaw || amountRaw === "0") {
    return Response.json({ ok: false, error: "tokens and a non-zero amount required" }, { status: 400 });
  }
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return Response.json({ ok: false, error: "a connected wallet address is required" }, { status: 400 });
  }

  try {
    // 1. Fresh quote — never execute against a stale one.
    const routesRes = await fetch(LIFI_ROUTES, {
      method: "POST",
      headers: lifiHeaders(),
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
    if (!routesRes.ok) {
      return Response.json(
        { ok: false, error: routesRes.status === 429 ? "LI.FI rate limit reached — retry shortly" : `LI.FI ${routesRes.status}` },
        { status: 502 }
      );
    }
    const { routes = [] } = (await routesRes.json()) as { routes?: LifiRoute[] };
    if (routes.length === 0) {
      return Response.json({ ok: false, error: "no route available for this pair right now" }, { status: 404 });
    }

    // 2. Prefer the tool the user picked; fall back to the best-ranked route.
    const chosen = (tool && routes.find((r) => r.steps?.[0]?.tool === tool)) || routes[0];
    const step = chosen.steps?.[0];
    if (!step) {
      return Response.json({ ok: false, error: "route has no executable step" }, { status: 502 });
    }
    const substituted = !!tool && chosen.steps?.[0]?.tool !== tool;

    // 3. Ask LI.FI to build the transaction for that step.
    const txRes = await fetch(LIFI_STEP_TX, {
      method: "POST",
      headers: lifiHeaders(),
      body: JSON.stringify(step),
      cache: "no-store",
    });
    if (!txRes.ok) {
      return Response.json({ ok: false, error: `LI.FI stepTransaction ${txRes.status}` }, { status: 502 });
    }
    const stepTx = (await txRes.json()) as {
      transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number; gasLimit?: string };
      estimate?: { approvalAddress?: string; toAmountMin?: string };
    };

    const tr = stepTx.transactionRequest;
    if (!tr?.to || !tr?.data) {
      return Response.json({ ok: false, error: "LI.FI returned no transaction" }, { status: 502 });
    }

    return Response.json({
      ok: true,
      tool: step.tool ?? null,
      toolName: step.toolDetails?.name ?? null,
      // Whether we had to fall back to a different route than the one selected.
      substituted,
      approvalAddress: stepTx.estimate?.approvalAddress ?? step.estimate?.approvalAddress ?? null,
      minReceived: stepTx.estimate?.toAmountMin ?? chosen.toAmountMin ?? null,
      etaSeconds: step.estimate?.executionDuration ?? null,
      transaction: {
        to: tr.to,
        data: tr.data,
        value: tr.value ?? "0x0",
        chainId: tr.chainId ?? srcChainId,
        gasLimit: tr.gasLimit ?? null,
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to build bridge transaction" },
      { status: 502 }
    );
  }
}
