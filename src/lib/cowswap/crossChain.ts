// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * CoW Protocol cross-chain swaps — an alternative bridge rail alongside LI.FI.
 *
 * Mechanism (not a new settlement layer): a normal CoW order on the source
 * chain into an intermediate token, with `receiver` overridden to the user's
 * CoW Shed proxy, plus a signed post-hook that deposits into a bridge provider
 * (Across / Bungee / NEAR Intents). Solvers compete on the swap leg, which is
 * where the MEV protection comes from.
 *
 * There is no public REST endpoint for this — quoting is SDK-only. Hence the
 * client-side integration rather than a server route like the other rails.
 *
 * Hard constraints, straight from CoW's docs — all enforced in `cowCrossChainAvailability`:
 *   - "not available for smart contract wallets" → Safe users cannot use it
 *   - "Tokens must be different. Bridging the same token between two networks
 *      is not yet supported."
 *   - sell orders only
 */

import type { PublicClient, WalletClient } from "viem";

/** Chains where CoW runs an orderbook AND we integrate the chain. */
const COW_CROSS_CHAIN_IDS = new Set([1, 8453, 42161]);

export interface CowCrossChainContext {
  srcChainId: number;
  dstChainId: number;
  srcToken: { address: string; symbol: string; decimals: number } | null;
  dstToken: { address: string; symbol: string; decimals: number } | null;
  isSmartAccount: boolean;
}

export interface CowAvailability {
  available: boolean;
  /** User-facing reason when unavailable — always specific, never generic. */
  reason?: string;
}

/**
 * Whether CoW cross-chain can serve this hop. Checked before quoting so the
 * route can be listed-but-disabled with the real reason, rather than silently
 * missing or failing at signature time.
 */
export function cowCrossChainAvailability(ctx: CowCrossChainContext): CowAvailability {
  if (ctx.srcChainId === ctx.dstChainId) {
    return { available: false, reason: "Not a cross-chain hop" };
  }
  if (ctx.isSmartAccount) {
    return { available: false, reason: "CoW cross-chain doesn't support smart contract wallets (Safe)" };
  }
  if (!COW_CROSS_CHAIN_IDS.has(ctx.srcChainId) || !COW_CROSS_CHAIN_IDS.has(ctx.dstChainId)) {
    return { available: false, reason: "CoW runs on Ethereum, Base and Arbitrum only" };
  }
  if (!ctx.srcToken || !ctx.dstToken) {
    return { available: false, reason: "Pick both assets to quote CoW" };
  }
  // CoW composes a *swap* with a bridge; it cannot move a token to itself.
  if (ctx.srcToken.symbol.toUpperCase() === ctx.dstToken.symbol.toUpperCase()) {
    return {
      available: false,
      reason: `CoW can't bridge ${ctx.srcToken.symbol} to itself — pick a different destination asset`,
    };
  }
  return { available: true };
}

export interface CowCrossChainQuote {
  ok: boolean;
  error?: string;
  /** Destination amount in raw units of the destination token. */
  buyAmount?: string;
  /** Provider that carries the bridge leg (Across, Bungee, …). */
  providerName?: string;
  etaSeconds?: number;
  /** Opaque handle used to post the order; only valid for this quote. */
  quote?: unknown;
}

/**
 * Request a cross-chain quote through the CoW bridging SDK.
 *
 * The SDK is imported lazily: it pulls ~500 KB and a dozen sub-packages, and
 * most sessions never open a bridge node, so it should not sit in the initial
 * bundle.
 */
export async function getCowCrossChainQuote(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  owner: `0x${string}`;
  srcChainId: number;
  dstChainId: number;
  sellToken: { address: string; decimals: number };
  buyToken: { address: string; decimals: number };
  /** Sell amount in raw units. CoW cross-chain is sell-orders only. */
  amountRaw: string;
  slippageBps?: number;
}): Promise<CowCrossChainQuote> {
  try {
    const [{ BridgingSdk, AcrossBridgeProvider }, { ViemAdapter }] = await Promise.all([
      import("@cowprotocol/sdk-bridging"),
      import("@cowprotocol/sdk-viem-adapter"),
    ]);

    const adapter = new ViemAdapter({
      provider: params.publicClient,
      walletClient: params.walletClient,
    });

    // Across only: it needs no API key and already covers every chain where
    // CoW runs an orderbook and we integrate (Ethereum, Base, Arbitrum).
    // Bungee's provider requires a mandatory options object; add it later if a
    // route it covers turns out to be missing.
    const sdk = new BridgingSdk({ providers: [new AcrossBridgeProvider()] }, adapter);

    const result = await sdk.getQuote({
      kind: "sell",
      amount: BigInt(params.amountRaw),
      owner: params.owner,
      sellTokenChainId: params.srcChainId,
      sellTokenAddress: params.sellToken.address,
      sellTokenDecimals: params.sellToken.decimals,
      buyTokenChainId: params.dstChainId,
      buyTokenAddress: params.buyToken.address,
      buyTokenDecimals: params.buyToken.decimals,
      appCode: "morpheus",
      signer: params.owner,
      slippageBps: params.slippageBps ?? 100,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    const bridge = r?.bridge ?? r?.bridgeQuote ?? null;

    return {
      ok: true,
      buyAmount: bridge?.amountsAndCosts?.afterSlippage?.buyAmount?.toString() ?? undefined,
      providerName: bridge?.providerInfo?.name ?? bridge?.provider?.info?.name ?? undefined,
      etaSeconds: bridge?.expectedFillTimeSeconds ?? undefined,
      quote: result,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "CoW quote failed" };
  }
}

/**
 * Post a previously fetched cross-chain quote.
 *
 * Two signatures are involved and the SDK handles both: one authorising the
 * bridge post-hook on the CoW Shed proxy, one for the order itself.
 */
export async function postCowCrossChainOrder(quote: unknown): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  try {
    const mod = await import("@cowprotocol/sdk-bridging");
    // A TS assertion function can only be called through an explicitly typed
    // binding, which a dynamic import doesn't give us — so it's invoked
    // indirectly. It still throws for a non-bridge quote, which is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assertBridgeQuote = mod.assertIsBridgeQuoteAndPost as (q: any) => void;
    assertBridgeQuote(quote);
    const { postSwapOrderFromQuote } = quote as {
      postSwapOrderFromQuote: () => Promise<unknown>;
    };
    const orderId = await postSwapOrderFromQuote();
    return { ok: true, orderId: String(orderId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to post CoW order" };
  }
}
