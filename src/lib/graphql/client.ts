// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

const MORPHO_API = "https://api.morpho.org/graphql";

/**
 * The Morpho API moved scalar asset prices behind a nested `price { usd }`
 * object (and renamed Market.uniqueKey -> marketId, aliased back in queries).
 * To keep every consumer reading the flat `asset.priceUsd` number, we walk the
 * response and copy `price.usd` up to `priceUsd` on any object that carries it.
 * Market.state.price stays a scalar string, so it is left untouched.
 */
function normalizePrices(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizePrices(item);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const price = obj.price;
  if (
    price !== null &&
    typeof price === "object" &&
    typeof (price as Record<string, unknown>).usd === "number"
  ) {
    obj.priceUsd = (price as Record<string, unknown>).usd;
  }

  for (const value of Object.values(obj)) normalizePrices(value);
}

export async function morphoQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 60 },
  });

  // Morpho returns GraphQL validation errors with a 400 status and a JSON
  // body, so parse before checking res.ok to surface the real message.
  let json: { data?: T; errors?: { message?: string }[] };
  try {
    json = await res.json();
  } catch {
    throw new Error(`Morpho API error: ${res.status}`);
  }

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "GraphQL error");
  }

  if (!res.ok) {
    throw new Error(`Morpho API error: ${res.status}`);
  }

  normalizePrices(json.data);
  return json.data as T;
}