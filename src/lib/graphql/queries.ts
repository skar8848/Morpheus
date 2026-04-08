// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

export const MARKETS_QUERY = `
  query GetMarkets($collateralAssets: [String!]!, $loanAssets: [String!]!, $chainId: [Int!]!) {
    markets(
      where: {
        collateralAssetAddress_in: $collateralAssets
        loanAssetAddress_in: $loanAssets
        chainId_in: $chainId
      }
    ) {
      items {
        uniqueKey
        lltv
        irmAddress
        oracle { address }
        collateralAsset {
          symbol
          address
          logoURI
          priceUsd
          decimals
        }
        loanAsset {
          symbol
          address
          logoURI
          priceUsd
          decimals
        }
        state {
          borrowApy
          netBorrowApy
          borrowAssets
          supplyAssets
          liquidityAssets
          price
          rewards {
            asset {
              symbol
              address
            }
            supplyApr
            borrowApr
          }
        }
      }
    }
  }
`;

export const VAULTS_QUERY = `
  query GetVaults($assetAddresses: [String!]!, $chainId: [Int!]!) {
    vaults(
      where: {
        assetAddress_in: $assetAddresses
        chainId_in: $chainId
      }
    ) {
      items {
        address
        name
        symbol
        asset {
          symbol
          address
          logoURI
          decimals
        }
        state {
          totalAssets
          totalAssetsUsd
          curator
          netApy
          fee
          allocation {
            market {
              uniqueKey
              collateralAsset {
                symbol
              }
              loanAsset {
                symbol
              }
              lltv
            }
            supplyAssets
          }
        }
      }
    }
  }
`;

export const USER_MARKET_POSITIONS_QUERY = `
  query GetUserMarketPositions($userAddress: [String!]!, $chainId: [Int!]!) {
    marketPositions(
      where: {
        userAddress_in: $userAddress
        chainId_in: $chainId
      }
    ) {
      items {
        healthFactor
        market {
          uniqueKey
          lltv
          irmAddress
          oracle { address }
          collateralAsset {
            symbol
            address
            logoURI
            priceUsd
            decimals
          }
          loanAsset {
            symbol
            address
            logoURI
            priceUsd
            decimals
          }
          state {
            borrowApy
            netBorrowApy
          }
        }
        state {
          collateral
          collateralUsd
          supplyAssets
          supplyAssetsUsd
          borrowAssets
          borrowAssetsUsd
        }
      }
    }
  }
`;

export const USER_VAULT_POSITIONS_QUERY = `
  query GetUserVaultPositions($userAddress: [String!]!, $chainId: [Int!]!) {
    vaultPositions(
      where: {
        userAddress_in: $userAddress
        chainId_in: $chainId
      }
    ) {
      items {
        vault {
          address
          name
          symbol
          asset {
            symbol
            address
            logoURI
            decimals
          }
          state {
            netApy
            totalAssetsUsd
          }
        }
        state {
          assets
          assetsUsd
          shares
        }
      }
    }
  }
`;

/**
 * List all Vault V2s on a given chain. The API does not yet expose a
 * userAddress filter on V2 positions, so the client must call balanceOf
 * on each vault address via multicall to discover user positions.
 *
 * Vault V2 is the newer Morpho vault contract; positions in V2 vaults
 * are NOT returned by the legacy `vaultPositions` query above.
 */
export const VAULT_V2_LIST_QUERY = `
  query ListVaultV2s($chainId: [Int!]!, $first: Int!, $skip: Int!) {
    vaultV2s(
      where: { chainId_in: $chainId, listed: true }
      first: $first
      skip: $skip
    ) {
      items {
        address
        name
        symbol
        sharePrice
        netApy
        totalAssetsUsd
        asset {
          symbol
          address
          logoURI
          decimals
          priceUsd
        }
      }
      pageInfo {
        count
        countTotal
      }
    }
  }
`;

export const LOAN_ASSETS_QUERY = `
  query GetLoanAssets($collateralAssets: [String!]!, $chainId: [Int!]!) {
    markets(
      where: {
        collateralAssetAddress_in: $collateralAssets
        chainId_in: $chainId
      }
    ) {
      items {
        loanAsset {
          symbol
          name
          address
          decimals
          logoURI
          priceUsd
        }
      }
    }
  }
`;

export const USER_TRANSACTIONS_QUERY = `
  query GetUserTransactions($userAddress: [String!]!, $chainId: [Int!]!, $first: Int, $skip: Int) {
    transactions(
      first: $first
      skip: $skip
      orderBy: Timestamp
      orderDirection: Desc
      where: {
        userAddress_in: $userAddress
        chainId_in: $chainId
      }
    ) {
      items {
        id
        hash
        timestamp
        blockNumber
        type
        data {
          __typename
          ... on VaultTransactionData {
            assets
            assetsUsd
            vault {
              name
              address
              asset {
                symbol
                decimals
                logoURI
              }
            }
          }
          ... on MarketTransferTransactionData {
            assets
            assetsUsd
            shares
            market {
              uniqueKey
              collateralAsset {
                symbol
                decimals
                logoURI
              }
              loanAsset {
                symbol
                decimals
                logoURI
              }
            }
          }
          ... on MarketCollateralTransferTransactionData {
            assets
            assetsUsd
            market {
              uniqueKey
              collateralAsset {
                symbol
                decimals
                logoURI
              }
              loanAsset {
                symbol
                decimals
                logoURI
              }
            }
          }
          ... on MarketLiquidationTransactionData {
            repaidAssets
            repaidAssetsUsd
            seizedAssets
            seizedAssetsUsd
            badDebtAssets
            badDebtAssetsUsd
            liquidator
            market {
              uniqueKey
              collateralAsset {
                symbol
                decimals
                logoURI
              }
              loanAsset {
                symbol
                decimals
                logoURI
              }
            }
          }
        }
      }
    }
  }
`;