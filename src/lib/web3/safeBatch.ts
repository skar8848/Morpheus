// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Submit a whole strategy to a Safe as ONE batched transaction.
 *
 * Sending transactions one by one through the normal flow creates a separate
 * Safe queue entry per approval and per bundle — each needing its own signature
 * round, and each executable out of order. The Safe Apps SDK accepts an array
 * instead and wraps it in a single multisend: one queue entry, one round of
 * signatures, atomic ordering.
 *
 * Only meaningful when Morpheus runs inside the Safe interface (as a Safe App);
 * `isInsideSafe()` reports that.
 */

export interface BatchTx {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Wei, as a decimal string. Defaults to "0". */
  value?: string;
}

export interface SafeBatchResult {
  ok: boolean;
  /** Safe transaction hash — NOT an on-chain hash until the Safe executes it. */
  safeTxHash?: string;
  error?: string;
}

/** True when the page is embedded in another window, as a Safe App is. */
export function isInsideSafe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access throws — which itself means we're framed.
    return true;
  }
}

/**
 * Send a batch to the Safe queue. Returns the Safe transaction hash; the
 * transaction is queued, not mined, so callers must not wait for a receipt.
 */
export async function sendSafeBatch(txs: BatchTx[]): Promise<SafeBatchResult> {
  if (txs.length === 0) return { ok: false, error: "Nothing to batch" };
  if (!isInsideSafe()) {
    return { ok: false, error: "Not running inside the Safe interface" };
  }

  try {
    const { default: SafeAppsSDK } = await import("@safe-global/safe-apps-sdk");
    const sdk = new SafeAppsSDK();

    // Confirms we're really talking to a Safe rather than any other iframe.
    const safeInfo = await sdk.safe.getInfo();
    if (!safeInfo?.safeAddress) {
      return { ok: false, error: "Could not reach the Safe interface" };
    }

    const { safeTxHash } = await sdk.txs.send({
      txs: txs.map((t) => ({ to: t.to, data: t.data, value: t.value ?? "0" })),
    });

    return { ok: true, safeTxHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send the Safe batch" };
  }
}

/**
 * Deep link that opens Morpheus as a Safe App inside the Safe interface, with
 * the strategy preloaded via the existing `?strategy=` deep link.
 *
 * This is the handoff for someone browsing Morpheus in a normal tab with a Safe:
 * rather than asking them to find the app inside Safe, send them straight there.
 */
export function safeAppDeepLink(params: {
  safeAddress: string;
  /** Safe's short chain prefix, e.g. "eth", "base", "arb1". */
  chainPrefix: string;
  /** Absolute Morpheus URL, strategy deep link included. */
  appUrl: string;
}): string {
  const safe = `${params.chainPrefix}:${params.safeAddress}`;
  return `https://app.safe.global/apps/open?safe=${encodeURIComponent(safe)}&appUrl=${encodeURIComponent(params.appUrl)}`;
}

/** Safe's short-name prefixes for the chains Morpheus integrates. */
export const SAFE_CHAIN_PREFIX: Record<number, string> = {
  1: "eth",
  8453: "base",
  42161: "arb1",
};
