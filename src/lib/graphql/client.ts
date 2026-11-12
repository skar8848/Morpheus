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

/**
 * A slow API is worse than a failing one: the call eventually resolves, no
 * `catch` fires, and the UI sits on "loading" (or, server-side, the route hits
 * its maxDuration and answers 504 with no body). Every request is cut off after
 * this long so slowness surfaces as an error.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  // AbortSignal.any is recent; without it the caller's own signal still wins.
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

/**
 * `signal` lets a hook cancel the request itself when its inputs change or the
 * component unmounts, instead of only ignoring the late answer.
 */
export async function morphoQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(MORPHO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      // Never served from Next's data cache: inside a route handler a POST with
      // `revalidate` is cached by URL + body, so /api/positions re-read right
      // after a transaction could answer with the pre-transaction state.
      cache: "no-store",
      signal: requestSignal(signal),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`Morpho API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

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
 * `signal` cancels every page at once.
 */
export async function morphoQueryAll<T extends object>(
  query: string,
  variables: Record<string, unknown>,
  field: keyof T & string,
  signal?: AbortSignal,
  pageSize = 200,
  maxPages = 25
): Promise<T> {
  const first = await morphoQuery<T>(query, { ...variables, first: pageSize, skip: 0 }, signal);
  const head = (first as unknown as Record<string, Page>)[field];
  const total = head.pageInfo?.countTotal ?? head.items.length;
  const pages = Math.min(Math.ceil(total / pageSize), maxPages);
  if (pages <= 1) return first;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      morphoQuery<Record<string, Page>>(
        query,
        {
          ...variables,
          first: pageSize,
          skip: (i + 1) * pageSize,
        },
        signal
      )
    )
  );
  const items = [head.items, ...rest.map((r) => r[field].items)].flat();
  return { ...first, [field]: { ...head, items } };
}
