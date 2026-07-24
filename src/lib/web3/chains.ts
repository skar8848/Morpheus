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
});

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://monadscan.com" } },
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
  { slug: "monad", chainId: 143, chain: monad, label: "Monad", logo: "/chains/monad.ico" },
];

/** Chain logo path by chainId (falls back to empty string). */
export function chainLogo(chainId: number): string {
  return CHAIN_CONFIGS.find((c) => c.chainId === chainId)?.logo ?? "";
}

export type SupportedChainId = 1 | 8453 | 42161 | 999 | 143;

export function getChainBySlug(slug: string): ChainConfig {
  return CHAIN_CONFIGS.find((c) => c.slug === slug) ?? CHAIN_CONFIGS[0];
}
