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
