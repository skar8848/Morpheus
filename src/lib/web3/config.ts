// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { http, createConfig, fallback } from "wagmi";
import { mainnet, base, arbitrum } from "wagmi/chains";
import { injected, safe } from "wagmi/connectors";
import { hyperevm, monad, RPC_URLS, type SupportedChainId } from "./chains";

/** One chain's endpoints, in order, falling back down the list on failure. */
function transport(chainId: SupportedChainId) {
  const urls = RPC_URLS[chainId];
  return urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(urls[0]);
}

/**
 * RPC endpoints, ordered by measured latency (listed in RPC_URLS, chains.ts).
 *
 * NOTE: do NOT put 1rpc.io or rpc.ankr.com first (or at all) — as of 2026-07
 * 1rpc.io returns "You've reached the usage limit for your current plan" and
 * ankr requires an API key, while viem's default (cloudflare-eth.com) returns
 * an internal error. With all three failing, multicalls (e.g. Vault V2
 * discovery, which balanceOf's ~100 vaults) hung and silently dropped
 * positions. Keep at least two working endpoints per chain.
 */
export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, hyperevm, monad],
  connectors: [
    injected(),
    // Safe: auto-connects when Morpheus is opened as a Safe App (inside the
    // Safe iframe). Harmless elsewhere — it simply never becomes ready.
    // Note a Safe signs through its own queue, so a "sent" transaction may sit
    // pending signatures rather than landing on-chain; the execute flow treats
    // that as queued, not failed.
    safe({ allowedDomains: [/^app\.safe\.global$/, /^safe\.global$/] }),
  ],
  transports: {
    [mainnet.id]: transport(mainnet.id),
    [base.id]: transport(base.id),
    [arbitrum.id]: transport(arbitrum.id),
    [hyperevm.id]: transport(hyperevm.id),
    [monad.id]: transport(monad.id),
  },
});
