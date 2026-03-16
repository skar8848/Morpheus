// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Safely convert an API string/number/bigint to BigInt.
 * Returns fallback on any failure (null, undefined, empty string, non-numeric).
 */
export function safeBigInt(value: unknown, fallback: bigint = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}