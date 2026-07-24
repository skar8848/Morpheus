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
}

export const CHAIN_CONFIGS: ChainConfig[] = [
  { slug: "ethereum", chainId: 1, chain: mainnet, label: "Ethereum" },
  { slug: "base", chainId: 8453, chain: base, label: "Base" },
  { slug: "arbitrum", chainId: 42161, chain: arbitrum, label: "Arbitrum" },
  { slug: "hyperevm", chainId: 999, chain: hyperevm, label: "HyperEVM" },
  { slug: "monad", chainId: 143, chain: monad, label: "Monad" },
];

export type SupportedChainId = 1 | 8453 | 42161 | 999 | 143;

export function getChainBySlug(slug: string): ChainConfig {
  return CHAIN_CONFIGS.find((c) => c.slug === slug) ?? CHAIN_CONFIGS[0];
}
