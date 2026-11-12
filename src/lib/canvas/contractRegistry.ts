// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Don't trust, verify.
 *
 * Every address Morpheus can send a transaction to is declared here with its
 * owner, its role, and **where the address came from** — so a user can check the
 * claim instead of taking our word for it. Anything a bundle targets that isn't
 * in this registry is surfaced as UNKNOWN rather than quietly signed.
 *
 * Provenance matters as much as the value: an address is only trustworthy if you
 * can retrace how it got here. Every entry below is either published in Morpho's
 * own `@morpho-org/morpho-ts` registry, taken from the protocol's official docs,
 * or read back from a live API response — noted per entry.
 */

import type { SupportedChainId } from "@/lib/web3/chains";

export type ContractOwner = "morpho" | "cowswap" | "lifi" | "circle" | "safe" | "token" | "vault";

export interface KnownContract {
  address: string;
  /** Who deployed and controls it. */
  owner: ContractOwner;
  /** What it does in a Morpheus strategy. */
  role: string;
  /** How this address was obtained — the audit trail. */
  provenance: string;
}

const M = (address: string, role: string, provenance = "@morpho-org/morpho-ts registry"): KnownContract => ({
  address,
  owner: "morpho",
  role,
  provenance,
});

/**
 * Keyed by lowercase address. Deliberately chain-agnostic for lookup: an address
 * being right on the wrong chain is caught by the per-chain maps in
 * constants/contracts.ts, while this registry answers "whose contract is this?".
 */
export const KNOWN_CONTRACTS: Record<string, KnownContract> = Object.fromEntries(
  (
    [
      // ── Morpho Blue cores ────────────────────────────────────────────────
      M("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", "Morpho Blue core (Ethereum, Base)"),
      M("0x6c247b1F6182318877311737BaC0844bAa518F5e", "Morpho Blue core (Arbitrum)"),
      M("0x68e37dE8d93d3496ae143F2E900490f6280C57cD", "Morpho Blue core (HyperEVM)"),
      M("0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee", "Morpho Blue core (Monad)"),

      // ── Bundler3 — batches a strategy into one transaction ───────────────
      M("0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245", "Bundler3 (Ethereum)"),
      M("0x6BFd8137e702540E7A42B74178A4a49Ba43920C4", "Bundler3 (Base)"),
      M("0x1FA4431bC113D308beE1d46B0e98Cb805FB48C13", "Bundler3 (Arbitrum)"),
      M("0xa3F50477AfA601C771874260A3B34B40e244Fa0e", "Bundler3 (HyperEVM)"),
      M("0x82b684483e844422FD339df0b67b3B111F02c66E", "Bundler3 (Monad)"),

      // ── GeneralAdapter1 — the contract approvals are granted to ──────────
      M("0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0", "GeneralAdapter1 (Ethereum)"),
      M("0x12fa4A73d40E2F7a8cFfE97FB2e690213d9A5bCe", "GeneralAdapter1 (Base)"),
      M("0x9954aFB60BB5A222714c478ac86990F221788B88", "GeneralAdapter1 (Arbitrum)"),
      M("0xD7F48aDE56613E8605863832B7B8A1985B934aE4", "GeneralAdapter1 (HyperEVM)"),
      M("0x725AB8CAd931BCb80Fdbf10955a806765cCe00e5", "GeneralAdapter1 (Monad)"),

      // ── Midnight — fixed-rate markets ───────────────────────────────────
      M("0xAdedD8ab6dE832766Fedf0FaC4992E5C4D3EA18A", "Midnight core — fixed-rate order book (Base)"),
      M("0x091183d729BE9f808c212b475E387A12E67850A7", "MidnightBundles — batched takes (Base)"),
      M("0xdD6DCE32e21f7b020898a8258dA37355b4017993", "Midnight mempool — offer publication (Base)"),

      // ── CoW Protocol ────────────────────────────────────────────────────
      {
        address: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
        owner: "cowswap" as const,
        role: "GPv2Settlement — settles CoW orders",
        provenance: "CoW Protocol docs; same address on every chain",
      },
      {
        address: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
        owner: "cowswap" as const,
        role: "CoW VaultRelayer — holds the swap approval",
        provenance: "CoW Protocol docs; bytecode verified present on Base and Arbitrum",
      },

      // ── LI.FI ───────────────────────────────────────────────────────────
      {
        address: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        owner: "lifi" as const,
        role: "LI.FI diamond — executes the bridge route",
        provenance: "returned as approvalAddress/to by LI.FI's own stepTransaction API",
      },

      // ── Circle CCTP v2 ──────────────────────────────────────────────────
      {
        address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
        owner: "circle" as const,
        role: "TokenMessengerV2 — burns USDC to bridge it",
        provenance: "Circle docs + circlefin/evm-cctp-contracts; same address on all EVM chains",
      },
      {
        address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
        owner: "circle" as const,
        role: "MessageTransmitterV2 — mints on the destination chain",
        provenance: "Circle docs + circlefin/evm-cctp-contracts; same address on all EVM chains",
      },
    ] as KnownContract[]
  ).map((c) => [c.address.toLowerCase(), c])
);

export interface Verdict {
  known: boolean;
  contract?: KnownContract;
  /** Set when the destination is an ERC-20 the strategy legitimately touches. */
  tokenSymbol?: string;
}

/**
 * Classify a transaction destination.
 *
 * ERC-20 approvals necessarily target the *token* contract, which can't be
 * allow-listed up front — so tokens actually used by the strategy are passed in
 * and recognised by symbol rather than reported as unknown.
 */
export function classifyDestination(
  to: string,
  strategyTokens: { address: string; symbol: string }[] = [],
  strategyVaults: { address: string; name: string; listed: boolean }[] = []
): Verdict {
  const key = to.toLowerCase();
  const known = KNOWN_CONTRACTS[key];
  if (known) return { known: true, contract: known };

  // Vaults are curated contracts, thousands of them, so they can't be allow-listed
  // here either. The ones passed in were just looked up on the Morpho API by
  // address, which is what makes them "known": a vault the API has never heard
  // of is never passed in, and falls through to UNRECOGNISED below.
  const vault = strategyVaults.find((v) => v.address.toLowerCase() === key);
  if (vault) {
    return {
      known: true,
      contract: {
        address: to,
        owner: "vault",
        role: `${vault.name}, the vault the bundle deposits into or redeems from${
          vault.listed ? "" : " (not listed by Morpho)"
        }`,
        provenance: "looked up by address on the Morpho API",
      },
    };
  }

  const token = strategyTokens.find((t) => t.address.toLowerCase() === key);
  if (token) {
    return {
      known: true,
      tokenSymbol: token.symbol,
      contract: {
        address: to,
        owner: "token",
        role: `${token.symbol} token contract — approval target`,
        provenance: "the asset you selected in this strategy",
      },
    };
  }

  return { known: false };
}

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  999: "https://hyperevmscan.io",
  143: "https://monadscan.com",
};

/** Link to the contract's verified source, so the claim is checkable in one click. */
export function explorerContractUrl(address: string, chainId: SupportedChainId | number): string {
  const base = EXPLORERS[chainId] ?? EXPLORERS[1];
  return `${base}/address/${address}#code`;
}

export const OWNER_LABELS: Record<ContractOwner, string> = {
  morpho: "Morpho",
  cowswap: "CoW Protocol",
  lifi: "LI.FI",
  circle: "Circle",
  safe: "Safe",
  token: "Token",
  vault: "Morpho Vault",
};
