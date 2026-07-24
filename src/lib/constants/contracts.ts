// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { SupportedChainId } from "../web3/chains";

// Morpho Blue is NOT the same address on every chain — the 0xBBBB… vanity was
// only reproduced on Ethereum + Base. All values verified against the official
// @morpho-org/morpho-ts address registry.
export const MORPHO_BLUE: Record<SupportedChainId, `0x${string}`> = {
  1: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  8453: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  42161: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
  999: "0x68e37dE8d93d3496ae143F2E900490f6280C57cD",
  143: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
};

export const BUNDLER3: Record<SupportedChainId, `0x${string}`> = {
  1: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
  8453: "0x6BFd8137e702540E7A42B74178A4a49Ba43920C4",
  42161: "0x1FA4431bC113D308beE1d46B0e98Cb805FB48C13",
  999: "0xa3F50477AfA601C771874260A3B34B40e244Fa0e",
  143: "0x82b684483e844422FD339df0b67b3B111F02c66E",
};

export const GENERAL_ADAPTER1: Record<SupportedChainId, `0x${string}`> = {
  1: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
  // NOTE: the SDK registry lists 0xb98c948CFA24072e58935BC004a8A7b376AE746A for
  // Base — this older GeneralAdapter1 is kept as-is pending confirmation.
  8453: "0x12fa4A73d40E2F7a8cFfE97FB2e690213d9A5bCe",
  42161: "0x9954aFB60BB5A222714c478ac86990F221788B88",
  999: "0xD7F48aDE56613E8605863832B7B8A1985B934aE4",
  143: "0x725AB8CAd931BCb80Fdbf10955a806765cCe00e5",
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

export const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Minimal Morpho Blue ABI for authorization management.
 *
 * Borrow operations executed via the bundler/adapter need the user to
 * have authorized the adapter via `setAuthorization(adapter, true)`.
 * Otherwise, `morpho.borrow(..., onBehalf=user)` reverts with `Unauthorized()`.
 *
 * Use `isAuthorized(user, adapter)` to check before submitting any borrow flow.
 */
export const morphoBlueAbi = [
  {
    name: "setAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "authorized", type: "address" },
      { name: "newIsAuthorized", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "isAuthorized",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "authorized", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * USDT addresses per chain.
 *
 * USDT requires resetting allowance to 0 before setting a new non-zero value
 * (non-standard ERC20 quirk). Detect these addresses in the approval builder
 * and emit a zero-then-amount approval pair.
 */
export const USDT_ADDRESSES: Record<SupportedChainId, `0x${string}` | null> = {
  1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  8453: null, // Native USDT not deployed on Base
  42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  999: null,
  143: null,
};

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
    name: "morphoRepay",
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
      { name: "slippageAmount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "morphoWithdrawCollateral",
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
  {
    name: "erc4626Withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "minSharePriceE27", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [],
  },
] as const;