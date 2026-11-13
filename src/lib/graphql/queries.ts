// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Markets a user can LEND into, for a given loan asset — any collateral.
 *
 * `listed: true` is load-bearing, not cosmetic. Anyone can create a Morpho Blue
 * market permissionlessly, and unlisted ones include fake-oracle markets that
 * report billions in "supply" at 100% utilisation and 0 liquidity: lend into one
 * and the funds are unwithdrawable. The default query returns them first when
 * sorted by size, so without this filter the top of the list is a trap.
 */
export const LEND_MARKETS_QUERY = `
  query GetLendMarkets($loanAssets: [String!]!, $chainId: [Int!]!, $first: Int, $skip: Int) {
    markets(
      first: $first
      skip: $skip
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
      where: {
        loanAssetAddress_in: $loanAssets
        chainId_in: $chainId
        listed: true
      }
    ) {
      items {
        uniqueKey: marketId
        lltv
        irmAddress
        oracle { address }
        collateralAsset {
          symbol
          address
          logoURI
          price { usd }
          decimals
        }
        loanAsset {
          symbol
          address
          logoURI
          price { usd }
          decimals
        }
        state {
          borrowApy
          netBorrowApy
          supplyApy
          netSupplyApy
          utilization
          borrowAssets
          supplyAssets
          supplyAssetsUsd
          liquidityAssets
          liquidityAssetsUsd
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
  pageInfo { countTotal }
    }
  }
`;

/** Live state of specific markets (liquidity for a withdraw, current supply APY). */
export const MARKETS_BY_KEY_QUERY = `
  query GetMarketsByKey($keys: [String!]!, $chainId: [Int!]!) {
    markets(
      where: {
        uniqueKey_in: $keys
        chainId_in: $chainId
      }
    ) {
      items {
        uniqueKey: marketId
        state {
          supplyApy
          netSupplyApy
          utilization
          supplyAssets
          liquidityAssets
          liquidityAssetsUsd
        }
      }
    }
  }
`;

export const VAULTS_QUERY = `
  query GetVaults($assetAddresses: [String!]!, $chainId: [Int!]!, $first: Int, $skip: Int) {
    vaults(
      first: $first
      skip: $skip
      orderBy: TotalAssetsUsd
      orderDirection: Desc
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
              uniqueKey: marketId
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
  pageInfo { countTotal }
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
          uniqueKey: marketId
          lltv
          irmAddress
          oracle { address }
          collateralAsset {
            symbol
            address
            logoURI
            price { usd }
            decimals
          }
          loanAsset {
            symbol
            address
            logoURI
            price { usd }
            decimals
          }
          state {
            borrowApy
            netBorrowApy
            supplyApy
            netSupplyApy
          }
        }
        state {
          collateral
          collateralUsd
          supplyAssets
          supplyAssetsUsd
          borrowAssets
          borrowAssetsUsd
          borrowPnl
          borrowPnlUsd
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
          pnl
          pnlUsd
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
/**
 * Slim V2 vault list — only what's needed to multicall balanceOf. Kept lean so
 * the query stays far below the API complexity ceiling (the rich list of all
 * vaults with prices/apy sits near the limit and can fail outright). Rich
 * display fields are fetched afterwards for the user's matched vaults only.
 */
export const VAULT_V2_ADDRESSES_QUERY = `
  query ListVaultV2Addresses($chainId: [Int!]!, $first: Int!, $skip: Int!) {
    vaultV2s(
      where: { chainId_in: $chainId, listed: true }
      first: $first
      skip: $skip
    ) {
      items {
        address
        asset { decimals }
      }
      pageInfo { count countTotal }
    }
  }
`;

/** Rich details for a specific set of V2 vaults (the user's matched hits only). */
export const VAULT_V2_DETAILS_QUERY = `
  query VaultV2Details($chainId: [Int!]!, $addresses: [String!]!) {
    vaultV2s(where: { chainId_in: $chainId, address_in: $addresses }) {
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
          price { usd }
        }
      }
    }
  }
`;

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
          price { usd }
        }
      }
      pageInfo {
        count
        countTotal
      }
    }
  }
`;

/**
 * User activity. The API's single `transactions` root field was removed and
 * split per surface, so market and vault activity are fetched separately and
 * merged client-side (see useAddressPositions). Querying the old field now
 * fails outright with `Cannot query field "transactions"`.
 */
export const USER_MARKET_TRANSACTIONS_QUERY = `
  query GetUserMarketTransactions($userAddress: [String!]!, $chainId: [Int!]!, $first: Int, $skip: Int) {
    marketTransactions(
      first: $first
      skip: $skip
      orderBy: Timestamp
      orderDirection: Desc
      where: { userAddress_in: $userAddress, chainId_in: $chainId }
    ) {
      items {
        txHash
        timestamp
        blockNumber
        logIndex
        type
        market {
          uniqueKey: marketId
          collateralAsset { symbol decimals logoURI }
          loanAsset { symbol decimals logoURI }
        }
        data {
          __typename
          ... on MarketTransactionTransferData { assets shares }
          ... on MarketTransactionCollateralTransferData { assets }
          ... on MarketTransactionLiquidationData {
            repaidAssets
            seizedAssets
            badDebtAssets
          }
        }
      }
    }
  }
`;

export const USER_VAULT_TRANSACTIONS_QUERY = `
  query GetUserVaultTransactions($userAddress: [String!]!, $chainId: [Int!]!, $first: Int) {
    vaultV1Transactions(
      first: $first
      orderBy: Time
      orderDirection: Desc
      where: { userAddress_in: $userAddress, chainId_in: $chainId }
    ) {
      items {
        txHash
        timestamp
        blockNumber
        logIndex
        type
        assets
        vault {
          name
          address
          asset { symbol decimals logoURI }
        }
        data {
          __typename
          ... on VaultV1DepositData { assets }
          ... on VaultV1WithdrawData { assets }
        }
      }
    }
  }
`;

