import { mainnet, base } from "wagmi/chains";
import type { Chain } from "wagmi/chains";

export interface ChainConfig {
  slug: string;
  chainId: number;
  chain: Chain;
  label: string;
}

export const CHAIN_CONFIGS: ChainConfig[] = [
  { slug: "ethereum", chainId: 1, chain: mainnet, label: "Ethereum" },
  { slug: "base", chainId: 8453, chain: base, label: "Base" },
];

export type SupportedChainId = 1 | 8453;

export function getChainBySlug(slug: string): ChainConfig {
  return CHAIN_CONFIGS.find((c) => c.slug === slug) ?? CHAIN_CONFIGS[0];
}
