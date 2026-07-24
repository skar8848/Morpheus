// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * CCTP v2 attestation proxy.
 *
 * After a depositForBurn on the source chain, the destination mint needs
 * Circle's signed attestation. We poll Iris:
 *   GET https://iris-api.circle.com/v2/messages/{sourceDomain}?transactionHash={hash}
 * and relay the message + attestation + status. Proxied server-side to avoid
 * browser CORS. NOT cached — the status transitions pending → complete.
 */

const IRIS_BASE = "https://iris-api.circle.com/v2/messages";

interface IrisMessage {
  message?: string;
  attestation?: string | null;
  status?: string;
  eventNonce?: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");
  const hash = searchParams.get("hash");

  if (domain === null || !/^\d+$/.test(domain)) {
    return Response.json({ ok: false, error: "source domain id required" }, { status: 400 });
  }
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return Response.json({ ok: false, error: "valid transaction hash required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${IRIS_BASE}/${domain}?transactionHash=${hash}`, {
      cache: "no-store",
    });
    // 404 = Iris hasn't indexed the burn yet; report as pending, not an error.
    if (res.status === 404) {
      return Response.json({ ok: true, status: "pending", message: null, attestation: null });
    }
    if (!res.ok) {
      return Response.json({ ok: false, error: `Iris ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { messages?: IrisMessage[] };
    const m = data.messages?.[0];
    const complete = m?.status === "complete" && !!m.attestation && m.attestation !== "PENDING";
    return Response.json({
      ok: true,
      status: complete ? "complete" : "pending",
      message: complete ? m!.message : null,
      attestation: complete ? m!.attestation : null,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }
}
