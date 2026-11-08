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

interface Page {
  items: unknown[];
  pageInfo?: { countTotal?: number | null } | null;
}

/**
 * Fetch EVERY item of a paginated root field.
 *
 * The Morpho API silently caps a list at 100 items when `first` is omitted, and
 * mainnet alone has 362 listed markets (1860 in total), so a plain query returns
 * a truncated list with no error. The query must declare `$first: Int, $skip: Int`,
 * pass them to `field(first: $first skip: $skip ...)`, ask for `pageInfo { countTotal }`
 * and use a deterministic `orderBy`, otherwise pages can overlap or skip rows.
 *
 * The first page tells us the total; the remaining pages are fetched in parallel.
 * The result keeps the usual `{ [field]: { items } }` shape, so callers stay unchanged.
 */
export async function morphoQueryAll<T extends object>(
  query: string,
  variables: Record<string, unknown>,
  field: keyof T & string,
  pageSize = 200,
  maxPages = 25
): Promise<T> {
  const first = await morphoQuery<T>(query, { ...variables, first: pageSize, skip: 0 });
  const head = (first as unknown as Record<string, Page>)[field];
  const total = head.pageInfo?.countTotal ?? head.items.length;
  const pages = Math.min(Math.ceil(total / pageSize), maxPages);
  if (pages <= 1) return first;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      morphoQuery<Record<string, Page>>(query, {
        ...variables,
        first: pageSize,
        skip: (i + 1) * pageSize,
      })
    )
  );
  const items = [head.items, ...rest.map((r) => r[field].items)].flat();
  return { ...first, [field]: { ...head, items } };
}
