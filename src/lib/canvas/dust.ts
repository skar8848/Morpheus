// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { Edge } from "@xyflow/react";
import type { UserMarketPosition, UserVaultPosition } from "@/lib/graphql/types";
import type { CanvasNode } from "./types";

/**
 * Positions worth less than this (in USD) are "dust": leftover sub-cent
 * balances that aren't worth surfacing. Hidden by default in the sidebar
 * (behind the "Hide dust" toggle) and never placed on the graph.
 * Single source of truth so the sidebar and the canvas agree.
 */
export const DUST_USD_THRESHOLD = 1;

/** A borrow-market position is dust when its outstanding debt is below the threshold. */
export function isBorrowDust(p: UserMarketPosition): boolean {
  return (p.state?.borrowAssetsUsd ?? 0) < DUST_USD_THRESHOLD;
}

/** A supply-only market position is dust when its supplied value is below the threshold. */
export function isSupplyDust(p: UserMarketPosition): boolean {
  const usd = (p.state?.supplyAssetsUsd ?? 0) + (p.state?.collateralUsd ?? 0);
  return usd < DUST_USD_THRESHOLD;
}

/** A vault position is dust when its asset value is below the threshold. */
export function isVaultDust(p: UserVaultPosition): boolean {
  return (p.state?.assetsUsd ?? 0) < DUST_USD_THRESHOLD;
}

/**
 * Remove auto-imported nodes that represent a dust position (plus their edges).
 * Scoped to import-/position-prefixed ids so nodes the user built by hand are
 * never touched. Used when restoring a persisted canvas, so a sub-$1 position
 * saved before dust filtering existed doesn't linger on the graph.
 */
export function stripDustNodes(nodes: CanvasNode[], edges: Edge[]): {
  nodes: CanvasNode[];
  edges: Edge[];
} {
  const dustIds = new Set<string>();
  for (const n of nodes) {
    if (!n.id.startsWith("import-") && !n.id.startsWith("position-")) continue;
    const d = n.data;
    let dust = false;
    if (d.type === "vaultDeposit") {
      dust = (d.amountUsd ?? 0) < DUST_USD_THRESHOLD;
    } else if (d.type === "position") {
      if (d.vaultPosition) {
        dust = isVaultDust(d.vaultPosition);
      } else if (d.marketPosition) {
        dust =
          d.positionType === "borrow"
            ? isBorrowDust(d.marketPosition)
            : isSupplyDust(d.marketPosition);
      }
    }
    if (dust) dustIds.add(n.id);
  }
  if (dustIds.size === 0) return { nodes, edges };
  return {
    nodes: nodes.filter((n) => !dustIds.has(n.id)),
    edges: edges.filter((e) => !dustIds.has(e.source) && !dustIds.has(e.target)),
  };
}
