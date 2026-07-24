// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { UserMarketPosition, UserVaultPosition } from "@/lib/graphql/types";

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
