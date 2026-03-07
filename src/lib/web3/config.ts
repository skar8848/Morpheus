import { http, createConfig, fallback } from "wagmi";
import { mainnet, base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [mainnet, base],
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
  },
});
