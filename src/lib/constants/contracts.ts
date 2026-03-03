import type { SupportedChainId } from "../web3/chains";

export const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;

export const BUNDLER3: Record<SupportedChainId, `0x${string}`> = {
  1: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
  8453: "0x6BFd8137e702540E7A42B74178A4a49Ba43920C4",
};

export const GENERAL_ADAPTER1: Record<SupportedChainId, `0x${string}`> = {
  1: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
  8453: "0x12fa4A73d40E2F7a8cFfE97FB2e690213d9A5bCe",
};

// Minimal ABIs for encoding bundler calls
export const bundler3Abi = [
  {
    name: "multicall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "bundle",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "data", type: "bytes" },
          { name: "value", type: "uint256" },
          { name: "skipRevert", type: "bool" },
          { name: "callbackHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export const generalAdapterAbi = [
  {
    name: "erc20TransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "morphoSupplyCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "morphoBorrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "minSharePriceE27", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "erc4626Deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "maxSharePriceE27", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "erc4626Redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "minSharePriceE27", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [],
  },
] as const;
