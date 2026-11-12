// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { mainnet, base, arbitrum } from "wagmi/chains";
import { defineChain } from "viem";
import type { Chain } from "wagmi/chains";

// Chains not shipped in wagmi/chains — defined from Morpho's supported-chains list.
export const hyperevm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } },
  blockExplorers: { default: { name: "HyperEVM Scan", url: "https://hyperevmscan.io" } },
  // Canonical Multicall3, deployed on HyperEVM. Without it viem can't batch reads
  // here, and Vault V2 discovery (one balanceOf per vault) has no way to run.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://monadscan.com" } },
  // Canonical Multicall3, deployed on Monad (same reason as HyperEVM above).
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export interface ChainConfig {
  slug: string;
  chainId: number;
  chain: Chain;
  label: string;
  /** Chain logo under /public (drop the asset files there). */
  logo: string;
}

export const CHAIN_CONFIGS: ChainConfig[] = [
  { slug: "ethereum", chainId: 1, chain: mainnet, label: "Ethereum", logo: "/chains/mainnet.svg" },
  { slug: "base", chainId: 8453, chain: base, label: "Base", logo: "/chains/base.svg" },
  { slug: "arbitrum", chainId: 42161, chain: arbitrum, label: "Arbitrum", logo: "/chains/arbitrum.svg" },
  { slug: "hyperevm", chainId: 999, chain: hyperevm, label: "HyperEVM", logo: "/chains/hype.webp" },
  // Note: the source file was named monad.ico but is actually a 256x256 PNG —
  // stored as .png so it's served with the right content type.
  { slug: "monad", chainId: 143, chain: monad, label: "Monad", logo: "/chains/monad.png" },
];

/**
 * Block explorer base URL by chainId, from the chain definitions themselves,
 * so a chain added to CHAIN_CONFIGS links to its own explorer with no extra map.
 */
export function explorerBase(chainId: number): string {
  const chain = CHAIN_CONFIGS.find((c) => c.chainId === chainId)?.chain;
  return chain?.blockExplorers?.default.url ?? "https://etherscan.io";
}

/** Chain logo path by chainId (falls back to empty string). */
export function chainLogo(chainId: number): string {
  return CHAIN_CONFIGS.find((c) => c.chainId === chainId)?.logo ?? "";
}

export type SupportedChainId = 1 | 8453 | 42161 | 999 | 143;

/**
 * Public RPC endpoints per chain, ordered by measured latency. The wagmi config
 * (browser) and the server-side Vault V2 discovery (/api/positions) both read
 * this list, so a dead endpoint is fixed in one place. Read the note in
 * config.ts before adding one.
 */
export const RPC_URLS: Record<SupportedChainId, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  999: ["https://rpc.hyperliquid.xyz/evm"],
  143: ["https://rpc.monad.xyz"],
};

export function getChainBySlug(slug: string): ChainConfig {
  return CHAIN_CONFIGS.find((c) => c.slug === slug) ?? CHAIN_CONFIGS[0];
}
