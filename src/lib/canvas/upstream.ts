// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * What is flowing INTO a node.
 *
 * Several nodes consume "an asset, in some amount, from whatever is wired in":
 * a borrow posts it as collateral, a lend supplies it. They all need the same
 * answer — which asset, how much is available, and where from — so it lives here
 * instead of being re-derived (slightly differently) in each node component.
 */

import type { Edge } from "@xyflow/react";
import type { Asset } from "@/lib/graphql/types";
import type { CanvasNode } from "./types";

export type UpstreamKind =
  | "wallet"
  | "swap"
  | "vaultWithdraw"
  | "lendWithdraw"
  | "borrow"
  | "repay"
  | "bridge";

export interface UpstreamInput {
  nodeId: string;
  label: string;
  /** Amount this source delivers, in human units. 0 for a wallet (the UI reads the balance). */
  amount: number;
  kind: UpstreamKind;
  /** The asset it delivers; null for a wallet, which carries no asset of its own. */
  asset: Asset | null;
}

export interface UpstreamResult {
  inputs: UpstreamInput[];
  /** The asset the last producing source delivers — what a consumer should default to. */
  suggestedAsset: Asset | null;
  /** The swap feeding this node, if any: its fill is unknown until it executes. */
  swapNodeId: string | null;
}

type AssetLike = {
  address: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  name?: string;
};

function toAsset(a: AssetLike | null | undefined): Asset | null {
  if (!a?.address) return null;
  return {
    symbol: a.symbol,
    name: a.name ?? a.symbol,
    address: a.address,
    decimals: a.decimals,
    logoURI: a.logoURI ?? "",
  };
}

export function collectUpstream(nodeId: string, nodes: CanvasNode[], edges: Edge[]): UpstreamResult {
  const inputs: UpstreamInput[] = [];
  let suggestedAsset: Asset | null = null;
  let swapNodeId: string | null = null;

  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const source = nodes.find((n) => n.id === edge.source);
    if (!source) continue;
    const sd = source.data as Record<string, unknown>;

    const push = (kind: UpstreamKind, label: string, amount: number, asset: Asset | null) => {
      inputs.push({ nodeId: source.id, label, amount: isFinite(amount) && amount > 0 ? amount : 0, kind, asset });
      if (asset) suggestedAsset = asset;
    };

    switch (sd.type) {
      case "swap": {
        const out = toAsset(sd.tokenOut as AssetLike | null);
        if (!out) break;
        swapNodeId = source.id;
        push("swap", `Swap → ${out.symbol}`, parseFloat((sd.quoteOut as string) || "0"), out);
        break;
      }
      case "vaultWithdraw": {
        const pos = sd.position as { vault: { asset: AssetLike; name: string } } | null;
        const asset = toAsset(pos?.vault.asset);
        if (!asset) break;
        push("vaultWithdraw", `Withdraw ${pos!.vault.name}`, parseFloat((sd.amount as string) || "0"), asset);
        break;
      }
      case "lendWithdraw": {
        const pos = sd.position as {
          market: { loanAsset: AssetLike; collateralAsset?: { symbol?: string } };
        } | null;
        const asset = toAsset(pos?.market.loanAsset);
        if (!asset) break;
        push(
          "lendWithdraw",
          `Withdraw ${pos!.market.collateralAsset?.symbol ?? "?"}/${asset.symbol}`,
          parseFloat((sd.amount as string) || "0"),
          asset
        );
        break;
      }
      case "borrow": {
        const market = sd.market as { loanAsset: AssetLike; collateralAsset?: { symbol?: string } } | null;
        const asset = toAsset(market?.loanAsset);
        if (!asset) break;
        push(
          "borrow",
          `Borrow ${market!.collateralAsset?.symbol ?? "?"} → ${asset.symbol}`,
          (sd.borrowAmount as number) || 0,
          asset
        );
        break;
      }
      case "repay": {
        // Only a repay that frees its collateral produces an asset — and it's the
        // COLLATERAL, not the loan token that was repaid.
        if (!sd.withdrawCollateralAfterRepay) break;
        const market = sd.market as { collateralAsset?: AssetLike } | null;
        const asset = toAsset(market?.collateralAsset);
        if (!asset) break;
        let amt = 0;
        try {
          // collateralToWithdraw is RAW units.
          amt = Number(BigInt((sd.collateralToWithdraw as string | undefined) ?? "0")) / 10 ** asset.decimals;
        } catch {
          /* not a valid integer string — leave at 0 */
        }
        push("repay", `Freed ${asset.symbol}`, amt, asset);
        break;
      }
      case "bridge": {
        const out = toAsset(sd.tokenOut as AssetLike | null);
        if (!out) break;
        push("bridge", `Bridge → ${out.symbol}`, parseFloat((sd.quoteOut as string) || "0"), out);
        break;
      }
      case "wallet":
        push("wallet", "Wallet", 0, null);
        break;
    }
  }

  return { inputs, suggestedAsset, swapNodeId };
}
