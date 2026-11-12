// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { Node } from "@xyflow/react";
import type {
  Asset,
  AssetWithBalance,
  Market,
  Vault,
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";

// --- Node Data Interfaces ---
// Index signatures required for React Flow compatibility

export interface WalletNodeData {
  [key: string]: unknown;
  type: "wallet";
  address: string | undefined;
  chain: string;
  chainId: number;
  balances: AssetWithBalance[];
  /** Build the strategy for a Safe rather than the connected signer. */
  safeMode?: boolean;
  /** The Safe holding the funds, when safeMode is on. */
  safeAddress?: string;
}

/**
 * Borrow against collateral on one isolated Morpho Blue market.
 *
 * A single node owns the whole leg: the collateral posted into the market AND
 * the loan drawn against it. On-chain these are two calls (supplyCollateral then
 * borrow), but they only make sense together — collateral without a borrow just
 * sits idle, a borrow without collateral reverts — so the canvas models them as
 * one position rather than two nodes the user has to keep in sync.
 */
export interface BorrowNodeData {
  [key: string]: unknown;
  type: "borrow";
  /** Asset posted as collateral. Locked to the market's collateral once one is picked. */
  collateralAsset: Asset | null;
  /** Collateral posted by this node, in human units. */
  collateralAmount: string;
  collateralAmountUsd: number;
  /** Post the ENTIRE amount delivered by an upstream swap (known only after the fill). */
  collateralAll?: boolean;
  /** Loan asset picked in the UI (narrows the market list); the market has the final say. */
  loanAssetAddress?: string;
  market: Market | null;
  ltvPercent: number;
  borrowAmount: number;
  borrowAmountUsd: number;
  healthFactor: number | null;
  /** Fixed-rate borrow through Midnight instead of a floating Blue market. */
  fixedRate?: {
    marketId: string;
    /** Book side being lifted — a borrower lifts the bids. */
    side: "bids" | "asks";
    /** Loan-token amount to take, raw units. */
    assetsRaw: string;
    maturity: number;
  };
}

/**
 * Lend the loan asset into one isolated Morpho Blue market (a bare supply
 * position — no collateral, no debt). The supplier is exposed only to that
 * market's collateral asset, which is the whole point of picking it explicitly
 * instead of going through a curated vault.
 */
export interface LendNodeData {
  [key: string]: unknown;
  type: "lend";
  /** The asset being lent. Follows the upstream feed when there is one. */
  loanAsset: Asset | null;
  market: Market | null;
  /** Amount supplied, in human units of the market's loan asset. */
  amount: string;
  amountUsd: number;
  /** Supply the ENTIRE amount delivered by an upstream swap (known only after the fill). */
  depositAll?: boolean;
}

/**
 * Take supply back out of an isolated market. Mirrors VaultWithdraw: the
 * position is picked from what the connected wallet actually holds.
 */
export interface LendWithdrawNodeData {
  [key: string]: unknown;
  type: "lendWithdraw";
  position: UserMarketPosition | null;
  amount: string;
  /** Exit completely: burns every supply share instead of withdrawing a fixed
   *  amount, so no dust is left behind. Set by MAX, cleared by editing the amount. */
  withdrawAll?: boolean;
}

export interface SwapNodeData {
  [key: string]: unknown;
  type: "swap";
  tokenIn: Asset | null;
  tokenOut: Asset | null;
  amountIn: string;
  quoteOut: string;
  quoteLoading: boolean;
  chainId: number;
}

export interface VaultDepositNodeData {
  [key: string]: unknown;
  type: "vaultDeposit";
  vault: Vault | null;
  /** Asset picked by hand when the deposit is fed straight from the wallet.
   *  Every other source decides the asset itself (loan, swap output...). */
  asset?: Asset | null;
  amount: string;
  amountUsd: number;
  /** Deposit entire upstream swap output (default true when connected to swap) */
  depositAll?: boolean;
  /** Per-source allocation percentages keyed by source node id */
  allocPcts?: Record<string, number>;
}

export interface VaultWithdrawNodeData {
  [key: string]: unknown;
  type: "vaultWithdraw";
  position: UserVaultPosition | null;
  amount: string;
}

export interface RepayNodeData {
  [key: string]: unknown;
  type: "repay";
  market: Market | null;
  amount: string;
  amountUsd: number;
  /** When true, the executor emits a morpho.withdrawCollateral call after
   * the repay so the user gets their collateral back in their wallet.
   * Defaults to false (legacy behavior). Auto-enabled by the UI when the
   * user picks MAX (full repayment) since that's the typical "close out
   * this borrow" intent. */
  withdrawCollateralAfterRepay?: boolean;
  /** Amount of collateral to withdraw after the repay (raw token units,
   * decimals from market.collateralAsset.decimals). Required when
   * withdrawCollateralAfterRepay is true. Typically the user's full
   * collateral on the position. */
  collateralToWithdraw?: string;
}

/**
 * Cross-chain bridge — CowSwap-style: resolves its route from tokenIn (source
 * chain) → tokenOut (destination chain). See docs/cross-chain-design.md.
 */
export interface BridgeNodeData {
  [key: string]: unknown;
  type: "bridge";
  srcChainId: SupportedChainId;
  dstChainId: SupportedChainId;
  tokenIn: Asset | null; // asset entering on the source chain (from upstream)
  tokenOut: Asset | null; // asset delivered on the destination chain
  amountIn: string;
  amountInUsd: number;
  /** Estimated amount received on the destination chain, in tokenOut units —
   *  same convention as SwapNode.quoteOut so downstream nodes can read either. */
  quoteOut: string;
  /** USD value of quoteOut. */
  quoteOutUsd: number;
  quoteLoading: boolean;
  /** Chosen route id (e.g. "cctp-fast"); defaults to the best-ranked one. */
  routeId?: string;
  /** Aggregator tool key of the chosen route (e.g. "stargateV2Bus"). Stable
   *  across re-quotes, unlike the numeric route id — used at execution time. */
  routeTool?: string;
}

export interface PositionNodeData {
  [key: string]: unknown;
  type: "position";
  positionType: "borrow" | "supply" | "vault" | "collateral";
  marketPosition: UserMarketPosition | null;
  vaultPosition: UserVaultPosition | null;
}

// --- Union type ---

export type CanvasNodeData =
  | WalletNodeData
  | BorrowNodeData
  | LendNodeData
  | LendWithdrawNodeData
  | SwapNodeData
  | VaultDepositNodeData
  | VaultWithdrawNodeData
  | RepayNodeData
  | BridgeNodeData
  | PositionNodeData;

export type CanvasNode = Node<CanvasNodeData>;

/** Every React Flow node `type` the canvas can render. */
export const KNOWN_NODE_TYPES = new Set([
  "walletNode",
  "borrowNode",
  "lendNode",
  "lendWithdrawNode",
  "swapNode",
  "vaultDepositNode",
  "vaultWithdrawNode",
  "repayNode",
  "bridgeNode",
  "positionNode",
]);

// --- Valid connections ---

export const VALID_CONNECTIONS: Record<string, string[]> = {
  // Wallet can fund any leg that consumes an asset: a vault deposit or a bare
  // lend (pure earn), a borrow (it posts the collateral itself), a swap, a repay.
  wallet: ["vaultDeposit", "borrow", "lend", "swap", "repay", "bridge"],
  // A borrow's output is a loan asset. It can be redeployed (vault, lend, another
  // market's collateral), swapped, or bridged.
  borrow: ["swap", "vaultDeposit", "lend", "bridge", "borrow"],
  // A lend is a terminal position — what it holds is a claim on the market, not a
  // transferable asset, so nothing flows out of it.
  lend: [],
  lendWithdraw: ["swap", "vaultDeposit", "borrow", "lend", "repay", "bridge"],
  swap: ["vaultDeposit", "borrow", "lend", "wallet", "repay", "bridge"],
  vaultDeposit: [],
  vaultWithdraw: ["swap", "vaultDeposit", "borrow", "lend", "repay", "bridge"],
  // Bridge output lands on the destination chain and can feed the earn/borrow
  // legs there. It is the ONLY edge allowed to cross chains.
  bridge: ["borrow", "vaultDeposit", "lend", "swap", "repay"],
  // Repay is a valid SOURCE when withdrawCollateralAfterRepay is true:
  // the freed collateral can be re-posted, swapped, lent or deposited.
  // The downstream node auto-detects the freed collateral asset + amount
  // from the upstream repay (see SwapNode/BorrowNode/LendNode/VaultDepositNode).
  repay: ["swap", "borrow", "vaultDeposit", "lend"],
  position: ["vaultWithdraw", "lendWithdraw", "borrow", "swap", "bridge"],
};

// --- Node accent colors ---

export const NODE_COLORS: Record<string, string> = {
  wallet: "#2973ff",
  borrow: "#39a699",
  lend: "#22c55e",
  lendWithdraw: "#eab308",
  swap: "#f59e0b",
  vaultDeposit: "#a855f7",
  vaultWithdraw: "#f97316",
  repay: "#ef4444",
  bridge: "#0ea5e9",
  position: "#6b7079",
};

// --- Sidebar draggable node types ---

export const DRAGGABLE_NODE_TYPES = [
  { type: "borrow", label: "Borrow", icon: "B", shortcut: "B" },
  { type: "lend", label: "Lend (isolated market)", icon: "L", shortcut: "L" },
  { type: "lendWithdraw", label: "Lend Withdraw", icon: "U", shortcut: "U" },
  { type: "swap", label: "Swap (CowSwap)", icon: "S", shortcut: "X" },
  { type: "vaultDeposit", label: "Vault Deposit", icon: "V", shortcut: "D" },
  { type: "vaultWithdraw", label: "Vault Withdraw", icon: "W", shortcut: "W" },
  { type: "repay", label: "Repay", icon: "R", shortcut: "R" },
  { type: "bridge", label: "Bridge (LI.FI)", icon: "⇄", shortcut: "G" },
] as const;

/** Keyboard shortcut → node type mapping (lowercase key) */
export const NODE_SHORTCUTS: Record<string, string> = Object.fromEntries(
  DRAGGABLE_NODE_TYPES.map((t) => [t.shortcut.toLowerCase(), t.type])
);