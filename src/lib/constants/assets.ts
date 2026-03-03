import type { Asset } from "../graphql/types";
import type { SupportedChainId } from "../web3/chains";

export const COLLATERAL_ASSETS: Record<SupportedChainId, Asset[]> = {
  // Ethereum mainnet
  1: [
    {
      symbol: "wstETH",
      name: "Wrapped Lido Staked ETH",
      address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/wsteth.svg",
    },
    {
      symbol: "WBTC",
      name: "Wrapped Bitcoin",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
      logoURI: "https://cdn.morpho.org/assets/logos/wbtc.svg",
    },
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/weth.svg",
    },
    {
      symbol: "weETH",
      name: "Wrapped eETH",
      address: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/weeth.svg",
    },
    {
      symbol: "cbBTC",
      name: "Coinbase Wrapped BTC",
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      decimals: 8,
      logoURI: "https://cdn.morpho.org/assets/logos/cbbtc.svg",
    },
    {
      symbol: "sUSDe",
      name: "Staked USDe",
      address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/susde.svg",
    },
    {
      symbol: "USDe",
      name: "USDe",
      address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/usde.svg",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
      logoURI: "https://cdn.morpho.org/assets/logos/usdc.svg",
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
      logoURI: "https://cdn.morpho.org/assets/logos/usdt.svg",
    },
    {
      symbol: "USDS",
      name: "USDS",
      address: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/usds.svg",
    },
    {
      symbol: "aUSD",
      name: "Agora USD",
      address: "0x2b6D5f29b8C3e6950d8A0641bF441bfAf9E65fBa",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/ausd.svg",
    },
    {
      symbol: "DAI",
      name: "Dai Stablecoin",
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/dai.svg",
    },
  ],
  // Base
  8453: [
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/weth.svg",
    },
    {
      symbol: "cbETH",
      name: "Coinbase Wrapped Staked ETH",
      address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/cbeth.svg",
    },
    {
      symbol: "cbBTC",
      name: "Coinbase Wrapped BTC",
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      decimals: 8,
      logoURI: "https://cdn.morpho.org/assets/logos/cbbtc.svg",
    },
    {
      symbol: "USDbC",
      name: "USD Base Coin",
      address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      decimals: 6,
      logoURI: "https://cdn.morpho.org/assets/logos/usdbc.svg",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      logoURI: "https://cdn.morpho.org/assets/logos/usdc.svg",
    },
    {
      symbol: "DAI",
      name: "Dai Stablecoin",
      address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      decimals: 18,
      logoURI: "https://cdn.morpho.org/assets/logos/dai.svg",
    },
  ],
};
