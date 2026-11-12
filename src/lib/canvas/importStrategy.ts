// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { Edge } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData } from "./types";
import type {
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";

import { safeBigInt } from "@/lib/utils/bigint";
import { isBorrowDust, isSupplyDust, isVaultDust } from "./dust";
import { isValidImportedStrategyForApi } from "./api";

const COL = { wallet: 50, borrow: 380, vault: 710 };
const ROW_GAP = 220;
const START_Y = 80;

const STORAGE_KEY = "morpho-canvas-import";

export interface ImportedStrategy {
  nodes: CanvasNode[];
  edges: Edge[];
  sourceAddress: string;
}

/**
 * Build a canvas graph from an address's Morpho positions.
 *
 * Layout:
 *   Wallet → Borrow → VaultDeposit
 *
 * For each borrow position: one Borrow node (it carries its own collateral).
 * For each supply-only market position: one Lend node.
 * For each vault position: one VaultDeposit node.
 * Links borrows to vault deposits when the borrowed asset matches the vault asset.
 */
export function buildStrategyFromPositions(
  address: string,
  chain: string,
  chainId: number,
  marketPositions: UserMarketPosition[],
  vaultPositions: UserVaultPosition[]
): ImportedStrategy {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];
  let nodeCounter = 0;

  const makeId = (prefix: string) => `import-${prefix}-${++nodeCounter}`;

  // 1. Wallet node
  const walletId = makeId("wallet");
  nodes.push({
    id: walletId,
    type: "walletNode",
    position: { x: COL.wallet, y: START_Y },
    data: {
      type: "wallet",
      address,
      chain,
      chainId,
      balances: [],
    },
  });

  // Separate borrow positions from supply-only. Dust (sub-$1) positions are
  // dropped — a sub-cent leftover isn't worth a node on the graph.
  const borrowPositions = marketPositions.filter(
    (p) =>
      p.state?.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n && !isBorrowDust(p)
  );
  const supplyOnlyPositions = marketPositions.filter(
    (p) =>
      p.state?.supplyAssets &&
      safeBigInt(p.state.supplyAssets) > 0n &&
      (!p.state?.borrowAssets || safeBigInt(p.state.borrowAssets) === 0n) &&
      !isSupplyDust(p)
  );

  // Track borrow node outputs by loan asset address (for linking to vaults)
  const borrowNodesByLoanAsset: Map<string, string[]> = new Map();
  let borrowRow = 0;

  // 2. For each borrow position: Wallet → Borrow (the node carries its collateral)
  for (const pos of borrowPositions) {
    const y = START_Y + borrowRow * ROW_GAP;

    const collateralAsset = pos.market.collateralAsset;
    const collateralAmt = pos.state
      ? (Number(pos.state.collateral) / 10 ** (collateralAsset?.decimals ?? 18)).toFixed(6)
      : "";

    const borrowId = makeId("borrow");
    const borrowAmt = pos.state?.borrowAssets
      ? Number(pos.state.borrowAssets) / 10 ** pos.market.loanAsset.decimals
      : 0;
    const collateralUsd = pos.state?.collateralUsd ?? 0;
    const borrowUsd = pos.state?.borrowAssetsUsd ?? 0;
    const lltv = Number(pos.market.lltv) / 1e18;
    const ltvPct = collateralUsd > 0 ? Math.round((borrowUsd / collateralUsd) * 100) : 50;

    nodes.push({
      id: borrowId,
      type: "borrowNode",
      position: { x: COL.borrow, y },
      data: {
        type: "borrow",
        collateralAsset: collateralAsset
          ? {
              symbol: collateralAsset.symbol,
              name: collateralAsset.symbol,
              address: collateralAsset.address,
              decimals: collateralAsset.decimals,
              logoURI: collateralAsset.logoURI,
            }
          : null,
        collateralAmount: collateralAmt,
        collateralAmountUsd: collateralUsd,
        market: {
          uniqueKey: pos.market.uniqueKey,
          lltv: pos.market.lltv,
          irmAddress: pos.market.irmAddress,
          oracle: pos.market.oracle,
          collateralAsset: pos.market.collateralAsset ?? {
            symbol: "?",
            address: "",
            logoURI: "",
            priceUsd: null,
            decimals: 18,
          },
          loanAsset: pos.market.loanAsset,
          state: {
            borrowApy: pos.market.state.borrowApy,
            netBorrowApy: pos.market.state.netBorrowApy,
            supplyApy: pos.market.state.supplyApy,
            netSupplyApy: pos.market.state.netSupplyApy,
            borrowAssets: "0",
            supplyAssets: "0",
            liquidityAssets: "0",
            price: null,
            rewards: [],
          },
        },
        ltvPercent: Math.min(ltvPct, Math.round(lltv * 100)),
        borrowAmount: borrowAmt,
        borrowAmountUsd: borrowUsd,
        healthFactor: pos.healthFactor,
      } as CanvasNodeData,
    });

    // Wallet → Borrow
    edges.push({
      id: `${walletId}-${borrowId}`,
      source: walletId,
      target: borrowId,
      type: "animatedEdge",
      animated: true,
    });

    // Track for vault linking
    const loanAddr = pos.market.loanAsset.address.toLowerCase();
    const arr = borrowNodesByLoanAsset.get(loanAddr) ?? [];
    arr.push(borrowId);
    borrowNodesByLoanAsset.set(loanAddr, arr);

    borrowRow++;
  }

  // 3. Supply-only market positions: Borrow → Lend (or Wallet → Lend). These are bare supply
  // positions in an isolated market — they used to be forced into a Supply
  // Collateral node, which meant "supplying the LOAN token as collateral".
  for (const pos of supplyOnlyPositions) {
    const y = START_Y + borrowRow * ROW_GAP;

    const lendId = makeId("lend");
    const loanAsset = pos.market.loanAsset;
    const supplyAmt = pos.state?.supplyAssets
      ? (Number(pos.state.supplyAssets) / 10 ** loanAsset.decimals).toFixed(6)
      : "";

    nodes.push({
      id: lendId,
      type: "lendNode",
      position: { x: COL.borrow, y },
      data: {
        type: "lend",
        loanAsset: {
          symbol: loanAsset.symbol,
          name: loanAsset.symbol,
          address: loanAsset.address,
          decimals: loanAsset.decimals,
          logoURI: loanAsset.logoURI,
        },
        market: {
          uniqueKey: pos.market.uniqueKey,
          lltv: pos.market.lltv,
          irmAddress: pos.market.irmAddress,
          oracle: pos.market.oracle,
          collateralAsset: pos.market.collateralAsset ?? {
            symbol: "?",
            address: "",
            logoURI: "",
            priceUsd: null,
            decimals: 18,
          },
          loanAsset: pos.market.loanAsset,
          state: {
            borrowApy: pos.market.state.borrowApy,
            netBorrowApy: pos.market.state.netBorrowApy,
            supplyApy: pos.market.state.supplyApy,
            netSupplyApy: pos.market.state.netSupplyApy,
            borrowAssets: "0",
            supplyAssets: "0",
            liquidityAssets: "0",
            price: null,
            rewards: [],
          },
        },
        amount: supplyAmt,
        amountUsd: pos.state?.supplyAssetsUsd ?? 0,
      } as CanvasNodeData,
    });

    // Where did the lent funds come from? Same rule as the vault deposits below:
    // borrows of the same asset feed it (carry trade: borrow EURCV, lend EURCV),
    // otherwise it is a direct earn from the wallet.
    const sources = borrowNodesByLoanAsset.get(loanAsset.address.toLowerCase()) ?? [];
    if (sources.length > 0) {
      for (const sourceId of sources) {
        edges.push({
          id: `${sourceId}-${lendId}`,
          source: sourceId,
          target: lendId,
          type: "animatedEdge",
          animated: true,
        });
      }
    } else {
      edges.push({
        id: `${walletId}-${lendId}`,
        source: walletId,
        target: lendId,
        type: "animatedEdge",
        animated: true,
      });
    }

    borrowRow++;
  }

  // 4. Vault positions: VaultDeposit nodes (dust vaults dropped)
  let vaultRow = 0;
  for (const pos of vaultPositions) {
    if (isVaultDust(pos)) continue;
    const y = START_Y + vaultRow * ROW_GAP;

    const vaultId = makeId("vault");
    const amt = pos.state?.assets
      ? (Number(pos.state.assets) / 10 ** pos.vault.asset.decimals).toFixed(6)
      : "";

    nodes.push({
      id: vaultId,
      type: "vaultDepositNode",
      position: { x: COL.vault, y },
      data: {
        type: "vaultDeposit",
        vault: {
          address: pos.vault.address,
          name: pos.vault.name,
          symbol: pos.vault.symbol,
          asset: pos.vault.asset,
          state: {
            totalAssets: "0",
            totalAssetsUsd: pos.vault.state.totalAssetsUsd,
            curator: null,
            netApy: pos.vault.state.netApy,
            fee: 0,
            allocation: [],
          },
        },
        amount: amt,
        amountUsd: pos.state?.assetsUsd ?? 0,
      } as CanvasNodeData,
    });

    // Link from borrow nodes whose loan asset matches the vault asset
    const vaultAssetAddr = pos.vault.asset.address.toLowerCase();
    const sourceBorrows = borrowNodesByLoanAsset.get(vaultAssetAddr) ?? [];

    if (sourceBorrows.length > 0) {
      // Link from matching borrow nodes (carry-trade flow)
      for (const borrowId of sourceBorrows) {
        edges.push({
          id: `${borrowId}-${vaultId}`,
          source: borrowId,
          target: vaultId,
          type: "animatedEdge",
          animated: true,
        });
      }
    } else {
      // No matching borrow — direct earn flow: wallet → vault deposit.
      // VALID_CONNECTIONS allows this directly; no bridge needed.
      edges.push({
        id: `${walletId}-${vaultId}`,
        source: walletId,
        target: vaultId,
        type: "animatedEdge",
        animated: true,
      });
    }

    vaultRow++;
  }

  return { nodes, edges, sourceAddress: address };
}

/** Save an imported strategy to localStorage for the canvas to pick up */
export function saveImportedStrategy(strategy: ImportedStrategy) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(strategy));
}

/**
 * Validate that an imported strategy has valid structure. Delegates to the same
 * validator the public API uses (api.ts), so a deep link, a localStorage handoff
 * and a POST /api/canvas are held to exactly one schema.
 */
function isValidImportedStrategy(data: unknown): data is ImportedStrategy {
  return isValidImportedStrategyForApi(data).ok;
}

/** Load and consume (delete) an imported strategy from localStorage */
export function consumeImportedStrategy(): ImportedStrategy | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  localStorage.removeItem(STORAGE_KEY);
  // Reject excessively large payloads (500KB)
  if (raw.length > 500_000) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidImportedStrategy(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// --- Deep link API ---
//
// Agents can deep-link a user directly into a pre-built canvas via URL params:
//
//   /<chain>/canvas?strategy=<base64url(JSON)>
//
// Where the JSON matches the ImportedStrategy shape (nodes + edges + sourceAddress).
// Documented in AGENTS.md at the repo root.
//
// Morpheus NEVER auto-executes from a deep link. The user must always click Execute.

const MAX_DEEP_LINK_BYTES = 100_000; // 100 KB after base64 decoding

/** Decode a base64url string back to UTF-8. */
function decodeBase64Url(input: string): string | null {
  try {
    // base64url → base64
    let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    // pad
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad !== 0) return null;
    // decode
    if (typeof atob !== "function") return null;
    const binary = atob(b64);
    if (binary.length > MAX_DEEP_LINK_BYTES) return null;
    // binary → UTF-8 string
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Encode a UTF-8 string as base64url (used by callers building deep links). */
export function encodeBase64Url(input: string): string {
  if (typeof btoa !== "function") return "";
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse a deep link from URL search params and return an ImportedStrategy.
 *
 * Supported parameters (in order of precedence):
 *   - ?strategy=<base64url(ImportedStrategy json)>  → full graph shape
 *
 * Returns null when no deep link is present or the payload is invalid.
 * The caller is responsible for clearing the URL param after consumption.
 */
export function parseDeepLink(
  searchParams: URLSearchParams | null | undefined
): ImportedStrategy | null {
  if (!searchParams) return null;

  const strategyParam = searchParams.get("strategy");
  if (!strategyParam || strategyParam.length > MAX_DEEP_LINK_BYTES * 2) return null;

  const json = decodeBase64Url(strategyParam);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);
    if (!isValidImportedStrategy(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Helper for agents/tests: build a deep link URL from an ImportedStrategy.
 * Returns the path-relative query string, e.g. "?strategy=...".
 */
export function buildDeepLinkQuery(strategy: ImportedStrategy): string {
  const json = JSON.stringify(strategy);
  return `?strategy=${encodeBase64Url(json)}`;
}