// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

export interface Asset {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoURI: string;
  priceUsd?: number;
}

export interface AssetWithBalance extends Asset {
  balance: string;
  balanceRaw: bigint;
}

export interface MarketReward {
  asset: {
    symbol: string;
    address: string;
  };
  supplyApr: number;
  borrowApr: number;
}

export interface Market {
  uniqueKey: string;
  lltv: string;
  irmAddress: string;
  oracle: { address: string };
  collateralAsset: {
    symbol: string;
    address: string;
    logoURI: string;
    priceUsd: number | null;
    decimals: number;
  };
  loanAsset: {
    symbol: string;
    address: string;
    logoURI: string;
    priceUsd: number | null;
    decimals: number;
  };
  state: {
    borrowApy: number;
    netBorrowApy: number;
    borrowAssets: string;
    supplyAssets: string;
    liquidityAssets: string;
    price: string | null;
    rewards: MarketReward[];
    /** Supply-side fields — only fetched by the lend queries. */
    supplyApy?: number;
    netSupplyApy?: number;
    /** borrowed / supplied, 0..1 */
    utilization?: number;
    supplyAssetsUsd?: number | null;
    liquidityAssetsUsd?: number | null;
  };
}

export interface VaultAllocation {
  market: {
    uniqueKey: string;
    collateralAsset: {
      symbol: string;
    } | null;
    loanAsset: {
      symbol: string;
    };
    lltv: string;
  };
  supplyAssets: string;
}

export interface Vault {
  address: string;
  name: string;
  symbol: string;
  asset: {
    symbol: string;
    address: string;
    logoURI: string;
    decimals: number;
  };
  state: {
    totalAssets: string;
    totalAssetsUsd: number | null;
    curator: string | null;
    netApy: number;
    fee: number;
    allocation: VaultAllocation[];
  };
}

export interface MarketsResponse {
  markets: {
    items: Market[];
  };
}

export interface VaultsResponse {
  vaults: {
    items: Vault[];
  };
}

// --- User Positions ---

export interface UserMarketPosition {
  healthFactor: number | null;
  market: {
    uniqueKey: string;
    lltv: string;
    irmAddress: string;
    oracle: { address: string };
    collateralAsset: {
      symbol: string;
      address: string;
      logoURI: string;
      priceUsd: number | null;
      decimals: number;
    };
    loanAsset: {
      symbol: string;
      address: string;
      logoURI: string;
      priceUsd: number | null;
      decimals: number;
    };
    state: {
      borrowApy: number;
      netBorrowApy: number;
      /** What a supplier earns here. A lend imported without it earned 0% in the metrics. */
      supplyApy?: number;
      netSupplyApy?: number;
    };
  };
  state: {
    collateral: string;
    collateralUsd: number | null;
    supplyAssets: string | null;
    supplyAssetsUsd: number | null;
    borrowAssets: string | null;
    borrowAssetsUsd: number | null;
    /** Interest paid on the borrow side since inception (loan-asset units, negative). */
    borrowPnl: string | null;
    /** Interest paid on the borrow side since inception, in USD (negative = cost). */
    borrowPnlUsd: number | null;
  } | null;
}

export interface UserVaultPosition {
  vault: {
    address: string;
    name: string;
    symbol: string;
    asset: {
      symbol: string;
      address: string;
      logoURI: string;
      decimals: number;
    };
    state: {
      netApy: number;
      totalAssetsUsd: number | null;
    };
  };
  state: {
    assets: string | null;
    assetsUsd: number | null;
    shares: string;
    /** Interest earned since inception (asset units, positive). */
    pnl: string | null;
    /** Interest earned since inception, in USD (positive = gain). */
    pnlUsd: number | null;
  } | null;
}

export interface UserMarketPositionsResponse {
  marketPositions: {
    items: UserMarketPosition[];
  };
}

export interface UserVaultPositionsResponse {
  vaultPositions: {
    items: UserVaultPosition[];
  };
}

// --- Vault V2 ---

export interface VaultV2Listing {
  address: string;
  name: string;
  symbol: string;
  sharePrice: string;
  netApy: number | null;
  totalAssetsUsd: number | null;
  asset: {
    symbol: string;
    address: string;
    logoURI: string;
    decimals: number;
    priceUsd: number | null;
  };
}

export interface VaultV2ListResponse {
  vaultV2s: {
    items: VaultV2Listing[];
    pageInfo: {
      count: number;
      countTotal: number;
    };
  };
}

export interface LoanAssetsResponse {
  markets: {
    items: {
      loanAsset: {
        symbol: string;
        name: string;
        address: string;
        decimals: number;
        logoURI: string;
        priceUsd: number | null;
      };
    }[];
  };
}

// --- Transactions ---
//
// The API serves market and vault activity from two separate root fields
// (`marketTransactions`, `vaultV1Transactions`) with their own type enums, so
// each transaction carries the surface it came from. "Withdraw" exists on both
// sides and means different things, which is why the timeline keys on
// `surface:type` rather than on the type alone.

export type MarketTransactionType =
  | "Supply"
  | "Withdraw"
  | "Borrow"
  | "Repay"
  | "SupplyCollateral"
  | "WithdrawCollateral"
  | "Liquidation";

export type VaultTransactionType = "Deposit" | "Withdraw" | "Transfer";

interface TransactionAsset {
  symbol: string;
  decimals: number;
  logoURI: string;
}

/** BigInt scalars come back as a JSON number when small and a string when large. */
type RawAmount = string | number;

export type MarketTransactionData =
  | { __typename: "MarketTransactionTransferData"; assets: RawAmount; shares: RawAmount }
  | { __typename: "MarketTransactionCollateralTransferData"; assets: RawAmount }
  | {
      __typename: "MarketTransactionLiquidationData";
      repaidAssets: RawAmount;
      seizedAssets: RawAmount;
      badDebtAssets: RawAmount;
    };

interface TransactionBase {
  /** txHash + logIndex: one transaction can emit several Morpho events. */
  id: string;
  hash: string;
  timestamp: string;
  blockNumber: string;
}

export interface MarketTransaction extends TransactionBase {
  surface: "market";
  type: MarketTransactionType;
  market: {
    uniqueKey: string;
    collateralAsset: TransactionAsset | null;
    loanAsset: TransactionAsset;
  };
  data: MarketTransactionData;
}

export interface VaultTransaction extends TransactionBase {
  surface: "vault";
  type: VaultTransactionType;
  assets: RawAmount;
  vault: {
    name: string;
    address: string;
    asset: TransactionAsset;
  };
}

export type MorphoTransaction = MarketTransaction | VaultTransaction;
