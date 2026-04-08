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
    };
  };
  state: {
    collateral: string;
    collateralUsd: number | null;
    supplyAssets: string | null;
    supplyAssetsUsd: number | null;
    borrowAssets: string | null;
    borrowAssetsUsd: number | null;
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

export type TransactionType =
  | "MetaMorphoDeposit"
  | "MetaMorphoWithdraw"
  | "MetaMorphoTransfer"
  | "MetaMorphoFee"
  | "MarketBorrow"
  | "MarketLiquidation"
  | "MarketRepay"
  | "MarketSupply"
  | "MarketSupplyCollateral"
  | "MarketWithdraw"
  | "MarketWithdrawCollateral";

export interface VaultTransactionData {
  __typename: "VaultTransactionData";
  assets: string;
  assetsUsd: number | null;
  vault: {
    name: string;
    address: string;
    asset: {
      symbol: string;
      decimals: number;
      logoURI: string;
    };
  };
}

export interface MarketTransferTransactionData {
  __typename: "MarketTransferTransactionData";
  assets: string;
  assetsUsd: number | null;
  shares: string;
  market: {
    uniqueKey: string;
    collateralAsset: { symbol: string; decimals: number; logoURI: string } | null;
    loanAsset: { symbol: string; decimals: number; logoURI: string };
  };
}

export interface MarketCollateralTransferTransactionData {
  __typename: "MarketCollateralTransferTransactionData";
  assets: string;
  assetsUsd: number | null;
  market: {
    uniqueKey: string;
    collateralAsset: { symbol: string; decimals: number; logoURI: string } | null;
    loanAsset: { symbol: string; decimals: number; logoURI: string };
  };
}

export interface MarketLiquidationTransactionData {
  __typename: "MarketLiquidationTransactionData";
  repaidAssets: string;
  repaidAssetsUsd: number | null;
  seizedAssets: string;
  seizedAssetsUsd: number | null;
  badDebtAssets: string;
  badDebtAssetsUsd: number | null;
  liquidator: string;
  market: {
    uniqueKey: string;
    collateralAsset: { symbol: string; decimals: number; logoURI: string } | null;
    loanAsset: { symbol: string; decimals: number; logoURI: string };
  };
}

export type TransactionData =
  | VaultTransactionData
  | MarketTransferTransactionData
  | MarketCollateralTransferTransactionData
  | MarketLiquidationTransactionData;

export interface MorphoTransaction {
  id: string;
  hash: string;
  timestamp: string;
  blockNumber: string;
  type: TransactionType;
  data: TransactionData;
}

export interface TransactionsResponse {
  transactions: {
    items: MorphoTransaction[];
  };
}