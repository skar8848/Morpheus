// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * CCTP v2 transaction encoding for the cross-chain execution engine (M3).
 * See docs/cross-chain-design.md. Addresses verified against Circle's official
 * docs + the circlefin/evm-cctp-contracts source; both proxies are deployed at
 * the SAME address on every EVM mainnet chain (deterministic CREATE2).
 */

import { encodeFunctionData, pad } from "viem";
import type { SupportedChainId } from "@/lib/web3/chains";

/** TokenMessengerV2 — call depositForBurn here on the SOURCE chain. */
export const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;
/** MessageTransmitterV2 — call receiveMessage here on the DESTINATION chain. */
export const MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;

/** Fast Transfer soft-finality threshold; 2000 = Standard (free, slower). */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;

export const tokenMessengerV2Abi = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

export const messageTransmitterV2Abi = [
  {
    name: "receiveMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

/** Left-pad a 20-byte EVM address into the bytes32 CCTP expects. */
export function toBytes32(addr: `0x${string}`): `0x${string}` {
  return pad(addr, { size: 32 });
}

export interface DepositForBurnParams {
  /** USDC amount in raw units (6 decimals). */
  amount: bigint;
  /** CCTP domain id of the destination chain (≠ chainId). */
  destinationDomain: number;
  /** Who receives the minted USDC on the destination (Option A: the user's EOA). */
  mintRecipient: `0x${string}`;
  /** USDC token address on the source chain. */
  burnToken: `0x${string}`;
  /** Max fee (raw USDC) the caller will pay; must cover the Fast fee. */
  maxFee: bigint;
  /** true = Fast Transfer (~15s, small fee); false = Standard (free, slower). */
  fast: boolean;
}

/**
 * Encode a depositForBurn call. destinationCaller is left as bytes32(0) so the
 * mint/receiveMessage is permissionless (a relayer or the user can submit it).
 * The USDC must be approved to TOKEN_MESSENGER_V2 first (see needsUsdcApproval).
 */
export function encodeDepositForBurn(p: DepositForBurnParams): {
  to: `0x${string}`;
  data: `0x${string}`;
} {
  return {
    to: TOKEN_MESSENGER_V2,
    data: encodeFunctionData({
      abi: tokenMessengerV2Abi,
      functionName: "depositForBurn",
      args: [
        p.amount,
        p.destinationDomain,
        toBytes32(p.mintRecipient),
        p.burnToken,
        toBytes32("0x0000000000000000000000000000000000000000"),
        p.maxFee,
        p.fast ? FINALITY_FAST : FINALITY_STANDARD,
      ],
    }),
  };
}

/** Encode receiveMessage for the destination mint (permissionless). */
export function encodeReceiveMessage(
  message: `0x${string}`,
  attestation: `0x${string}`
): { to: `0x${string}`; data: `0x${string}` } {
  return {
    to: MESSAGE_TRANSMITTER_V2,
    data: encodeFunctionData({
      abi: messageTransmitterV2Abi,
      functionName: "receiveMessage",
      args: [message, attestation],
    }),
  };
}

/** Convenience: TokenMessengerV2 is the same on every supported chain. */
export function tokenMessengerFor(_chainId: SupportedChainId): `0x${string}` {
  return TOKEN_MESSENGER_V2;
}
