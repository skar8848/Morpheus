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
