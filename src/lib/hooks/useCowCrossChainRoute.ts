// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { useSmartAccount } from "./useSmartAccount";
import { cowCrossChainAvailability, getCowCrossChainQuote } from "@/lib/cowswap/crossChain";
import type { RouteQuote } from "./useBridgeRoutes";
import type { Asset } from "@/lib/graphql/types";

/**
 * CoW cross-chain offered as an alternative rail next to the LI.FI routes.
 *
 * It is deliberately shown even when unusable — listed and disabled with the
 * concrete reason — so a Safe user learns *why* the option is closed rather
 * than wondering where it went.
 */
export function useCowCrossChainRoute(params: {
  srcChainId: number;
  dstChainId: number;
  tokenIn: Asset | null;
  tokenOut: Asset | null;
  amountRaw: string;
  owner?: `0x${string}`;
  /** Price of the destination token, to express the quote in USD. */
  tokenOutPrice: number;
}): RouteQuote | null {
  const { srcChainId, dstChainId, tokenIn, tokenOut, amountRaw, owner, tokenOutPrice } = params;
  const { isSmartAccount } = useSmartAccount();
  const publicClient = usePublicClient({ chainId: srcChainId });
  const { data: walletClient } = useWalletClient({ chainId: srcChainId });
  const [route, setRoute] = useState<RouteQuote | null>(null);

  const availability = cowCrossChainAvailability({
    srcChainId,
    dstChainId,
    srcToken: tokenIn,
    dstToken: tokenOut,
    isSmartAccount,
  });

  const blocked = !availability.available;
  const blockedReason = availability.reason;

  // Unavailable is a *derived* state, not something to push through setState —
  // the reason is known synchronously from the availability check.
  const blockedRoute: RouteQuote | null = useMemo(() => {
    if (!blocked || srcChainId === dstChainId) return null;
    return {
      id: "cow-crosschain",
      name: "CoW cross-chain",
      provider: "cow",
      receivedUsd: 0,
      dstAmount: null,
      feeUsd: 0,
      feeBps: null,
      gasUsd: null,
      etaSeconds: 60,
      unavailable: blockedReason,
    };
  }, [blocked, blockedReason, srcChainId, dstChainId]);

  useEffect(() => {
    if (blocked) return;
    if (!publicClient || !owner || !tokenIn || !tokenOut || amountRaw === "0") return;

    let cancelled = false;
    getCowCrossChainQuote({
      publicClient,
      walletClient: walletClient ?? undefined,
      owner,
      srcChainId,
      dstChainId,
      sellToken: { address: tokenIn.address, decimals: tokenIn.decimals },
      buyToken: { address: tokenOut.address, decimals: tokenOut.decimals },
      amountRaw,
    })
      .then((q) => {
        if (cancelled) return;
        if (!q.ok) {
          setRoute({
            id: "cow-crosschain",
            name: "CoW cross-chain",
            provider: "cow",
            receivedUsd: 0,
            dstAmount: null,
            feeUsd: 0,
            feeBps: null,
            gasUsd: null,
            etaSeconds: 60,
            unavailable: q.error ?? "No CoW route for this pair",
          });
          return;
        }
        const tokens = q.buyAmount ? Number(q.buyAmount) / 10 ** tokenOut.decimals : 0;
        setRoute({
          id: "cow-crosschain",
          name: q.providerName ? `CoW cross-chain · ${q.providerName}` : "CoW cross-chain",
          provider: "cow",
          receivedUsd: tokens * tokenOutPrice,
          dstAmount: q.buyAmount ?? null,
          feeUsd: 0,
          feeBps: null,
          gasUsd: null,
          etaSeconds: q.etaSeconds ?? 60,
        });
      })
      .catch(() => {
        /* leave the previous quote in place rather than blanking the row */
      });

    return () => {
      cancelled = true;
    };
  }, [
    blocked,
    publicClient,
    walletClient,
    owner,
    srcChainId,
    dstChainId,
    tokenIn,
    tokenOut,
    amountRaw,
    tokenOutPrice,
  ]);

  return blockedRoute ?? route;
}
