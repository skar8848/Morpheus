// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { http, createConfig, fallback } from "wagmi";
import { mainnet, base, arbitrum } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { hyperevm, monad } from "./chains";

/**
 * RPC endpoints, ordered by measured latency.
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
  connectors: [injected()],
  transports: {
    [mainnet.id]: fallback([
      http("https://ethereum-rpc.publicnode.com"),
      http("https://eth.drpc.org"),
    ]),
    [base.id]: fallback([
      http("https://base-rpc.publicnode.com"),
      http("https://mainnet.base.org"),
    ]),
    [arbitrum.id]: fallback([
      http("https://arbitrum-one-rpc.publicnode.com"),
      http("https://arb1.arbitrum.io/rpc"),
    ]),
    [hyperevm.id]: http("https://rpc.hyperliquid.xyz/evm"),
    [monad.id]: http("https://rpc.monad.xyz"),
  },
});
