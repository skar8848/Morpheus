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
}

export interface SupplyCollateralNodeData {
  [key: string]: unknown;
  type: "supplyCollateral";
  asset: Asset | null;
  amount: string;
  amountUsd: number;
}

export interface BorrowNodeData {
  [key: string]: unknown;
  type: "borrow";
  market: Market | null;
  ltvPercent: number;
  borrowAmount: number;
  borrowAmountUsd: number;
  healthFactor: number | null;
  depositAmountUsd: number;
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
  quoteOut: string; // estimated received on the destination chain
  quoteLoading: boolean;
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
  | SupplyCollateralNodeData
  | BorrowNodeData
  | SwapNodeData
  | VaultDepositNodeData
  | VaultWithdrawNodeData
  | RepayNodeData
  | BridgeNodeData
  | PositionNodeData;

export type CanvasNode = Node<CanvasNodeData>;

// --- Valid connections ---

export const VALID_CONNECTIONS: Record<string, string[]> = {
  // Wallet can directly fund a vault deposit (pure earn flow), supply
  // collateral (borrow flow), swap, or repay an existing borrow.
  wallet: ["vaultDeposit", "supplyCollateral", "swap", "repay", "bridge"],
  supplyCollateral: ["borrow", "vaultDeposit"],
  borrow: ["swap", "vaultDeposit", "bridge"],
  swap: ["vaultDeposit", "supplyCollateral", "wallet", "repay", "bridge"],
  vaultDeposit: [],
  vaultWithdraw: ["swap", "vaultDeposit", "supplyCollateral", "repay", "bridge"],
  // Bridge output lands on the destination chain and can feed the earn/borrow
  // legs there. It is the ONLY edge allowed to cross chains.
  bridge: ["supplyCollateral", "vaultDeposit", "swap", "repay"],
  // Repay is a valid SOURCE when withdrawCollateralAfterRepay is true:
  // the freed collateral can be re-supplied, swapped, or deposited.
  // The downstream node auto-detects the freed collateral asset + amount
  // from the upstream repay (see SwapNode/SupplyCollateralNode/VaultDepositNode).
  repay: ["swap", "supplyCollateral", "vaultDeposit"],
  position: ["vaultWithdraw", "supplyCollateral", "swap", "bridge"],
};

// --- Node accent colors ---

export const NODE_COLORS: Record<string, string> = {
  wallet: "#2973ff",
  supplyCollateral: "#2973ff",
  borrow: "#39a699",
  swap: "#f59e0b",
  vaultDeposit: "#a855f7",
  vaultWithdraw: "#f97316",
  repay: "#ef4444",
  bridge: "#0ea5e9",
  position: "#6b7079",
};

// --- Sidebar draggable node types ---

export const DRAGGABLE_NODE_TYPES = [
  { type: "supplyCollateral", label: "Supply Collateral", icon: "+", shortcut: "S" },
  { type: "borrow", label: "Borrow", icon: "B", shortcut: "B" },
  { type: "swap", label: "Swap (CowSwap)", icon: "S", shortcut: "X" },
  { type: "vaultDeposit", label: "Vault Deposit", icon: "V", shortcut: "D" },
  { type: "vaultWithdraw", label: "Vault Withdraw", icon: "W", shortcut: "W" },
  { type: "repay", label: "Repay", icon: "R", shortcut: "R" },
  { type: "bridge", label: "Bridge (cross-chains)", icon: "⇄", shortcut: "G" },
] as const;

/** Keyboard shortcut → node type mapping (lowercase key) */
export const NODE_SHORTCUTS: Record<string, string> = Object.fromEntries(
  DRAGGABLE_NODE_TYPES.map((t) => [t.shortcut.toLowerCase(), t.type])
);