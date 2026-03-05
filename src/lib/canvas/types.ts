import type { Node } from "@xyflow/react";
import type {
  Asset,
  AssetWithBalance,
  Market,
  Vault,
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";

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
  /** Per-source allocation percentages keyed by source node id */
  allocPcts?: Record<string, number>;
}

export interface VaultWithdrawNodeData {
  [key: string]: unknown;
  type: "vaultWithdraw";
  position: UserVaultPosition | null;
  amount: string;
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
  | PositionNodeData;

export type CanvasNode = Node<CanvasNodeData>;

// --- Valid connections ---

export const VALID_CONNECTIONS: Record<string, string[]> = {
  wallet: ["supplyCollateral", "swap"],
  supplyCollateral: ["borrow", "vaultDeposit"],
  borrow: ["swap", "vaultDeposit"],
  swap: ["vaultDeposit", "supplyCollateral", "wallet"],
  vaultDeposit: [],
  vaultWithdraw: ["swap", "vaultDeposit", "supplyCollateral"],
  position: ["vaultWithdraw", "supplyCollateral", "swap"],
};

// --- Node accent colors ---

export const NODE_COLORS: Record<string, string> = {
  wallet: "#2973ff",
  supplyCollateral: "#2973ff",
  borrow: "#39a699",
  swap: "#f59e0b",
  vaultDeposit: "#a855f7",
  vaultWithdraw: "#f97316",
  position: "#6b7079",
};

// --- Sidebar draggable node types ---

export const DRAGGABLE_NODE_TYPES = [
  { type: "supplyCollateral", label: "Supply Collateral", icon: "+" },
  { type: "borrow", label: "Borrow", icon: "B" },
  { type: "swap", label: "Swap (CowSwap)", icon: "S" },
  { type: "vaultDeposit", label: "Vault Deposit", icon: "V" },
  { type: "vaultWithdraw", label: "Vault Withdraw", icon: "W" },
] as const;
