// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { http, createConfig, fallback } from "wagmi";
import { mainnet, base, arbitrum } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { hyperevm, monad } from "./chains";

export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, hyperevm, monad],
  connectors: [injected()],
  transports: {
    [mainnet.id]: fallback([
      http("https://1rpc.io/eth"),
      http("https://rpc.ankr.com/eth"),
      http(),
    ]),
    [base.id]: fallback([
      http("https://1rpc.io/base"),
      http("https://rpc.ankr.com/base"),
      http(),
    ]),
    [arbitrum.id]: fallback([
      http("https://arb1.arbitrum.io/rpc"),
      http("https://1rpc.io/arb"),
      http(),
    ]),
    [hyperevm.id]: http("https://rpc.hyperliquid.xyz/evm"),
    [monad.id]: http("https://rpc.monad.xyz"),
  },
});
