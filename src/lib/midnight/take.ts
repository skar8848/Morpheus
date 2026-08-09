// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Encoding a Midnight market order.
 *
 * The write path turned out to be fully available, contrary to what the
 * developer docs suggest (they stop at architecture and never name a function):
 *
 *   - the Midnight core contract is VERIFIED on Base, exposing
 *     `take(offer, ratifierData, units, taker, receiverIfTakerIsSeller,
 *      takerCallback, takerCallbackData) -> (uint256, uint256)`
 *   - the router's `/books/{id}/{side}/quote` endpoint returns
 *     `takeable_offers[]`, each carrying the COMPLETE offer struct plus its
 *     `ratifier_data` and the `units` to take
 *
 * So nothing has to be reconstructed: the quote hands over exactly the tuple the
 * contract expects, only in snake_case. This module maps it and encodes.
 *
 * A take may sweep several offers — one `take` call each — which is what
 * `midnightBundles` exists to batch.
 */

import { encodeFunctionData } from "viem";

export const MIDNIGHT_CORE = "0xAdedD8ab6dE832766Fedf0FaC4992E5C4D3EA18A" as const;
export const MIDNIGHT_BUNDLES = "0x091183d729BE9f808c212b475E387A12E67850A7" as const;

/** Minimal ABI: just `take`, matching the verified contract on Base. */
export const midnightTakeAbi = [
  {
    name: "take",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "offer",
        type: "tuple",
        components: [
          {
            name: "market",
            type: "tuple",
            components: [
              { name: "chainId", type: "uint256" },
              { name: "midnight", type: "address" },
              { name: "loanToken", type: "address" },
              {
                name: "collateralParams",
                type: "tuple[]",
                components: [
                  { name: "token", type: "address" },
                  { name: "lltv", type: "uint256" },
                  { name: "liquidationCursor", type: "uint256" },
                  { name: "oracle", type: "address" },
                ],
              },
              { name: "maturity", type: "uint256" },
              { name: "rcfThreshold", type: "uint256" },
              { name: "enterGate", type: "address" },
              { name: "liquidatorGate", type: "address" },
            ],
          },
          { name: "buy", type: "bool" },
          { name: "maker", type: "address" },
          { name: "start", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "tick", type: "uint256" },
          { name: "group", type: "bytes32" },
          { name: "callback", type: "address" },
          { name: "callbackData", type: "bytes" },
          { name: "receiverIfMakerIsSeller", type: "address" },
          { name: "ratifier", type: "address" },
          { name: "reduceOnly", type: "bool" },
          { name: "maxUnits", type: "uint128" },
          { name: "maxAssets", type: "uint128" },
          { name: "continuousFeeCap", type: "uint256" },
        ],
      },
      { name: "ratifierData", type: "bytes" },
      { name: "units", type: "uint256" },
      { name: "taker", type: "address" },
      { name: "receiverIfTakerIsSeller", type: "address" },
      { name: "takerCallback", type: "address" },
      { name: "takerCallbackData", type: "bytes" },
    ],
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
] as const;

/** The offer exactly as the router returns it (snake_case). */
export interface ApiOffer {
  market: {
    chain_id: number;
    midnight: string;
    loan_token: string;
    collaterals: { token: string; lltv: string; liquidation_cursor: string; oracle: string }[];
    maturity: number;
    rcf_threshold: string;
    enter_gate: string;
    liquidator_gate: string;
  };
  buy: boolean;
  maker: string;
  start: number;
  expiry: number;
  tick: number;
  group: string;
  callback: string;
  callback_data: string;
  receiver_if_maker_is_seller: string;
  ratifier: string;
  reduce_only: boolean;
  max_units: string;
  max_assets: string;
  continuous_fee_cap: string;
}

export interface TakeableOffer {
  units: string;
  offer: ApiOffer;
  ratifier_data: string;
  market_id: string;
}

export interface MidnightQuote {
  average_best_price: string;
  average_worst_price: string;
  available_assets: string;
  available_units: string;
  takeable_offers: TakeableOffer[];
}

const addr = (v: string) => v as `0x${string}`;
const hex = (v: string) => (v && v !== "0x" ? (v as `0x${string}`) : ("0x" as `0x${string}`));

/** Router JSON → the tuple the contract expects. */
function toContractOffer(o: ApiOffer) {
  return {
    market: {
      chainId: BigInt(o.market.chain_id),
      midnight: addr(o.market.midnight),
      loanToken: addr(o.market.loan_token),
      collateralParams: o.market.collaterals.map((c) => ({
        token: addr(c.token),
        lltv: BigInt(c.lltv),
        liquidationCursor: BigInt(c.liquidation_cursor),
        oracle: addr(c.oracle),
      })),
      maturity: BigInt(o.market.maturity),
      rcfThreshold: BigInt(o.market.rcf_threshold),
      enterGate: addr(o.market.enter_gate),
      liquidatorGate: addr(o.market.liquidator_gate),
    },
    buy: o.buy,
    maker: addr(o.maker),
    start: BigInt(o.start),
    expiry: BigInt(o.expiry),
    tick: BigInt(o.tick),
    group: o.group as `0x${string}`,
    callback: addr(o.callback),
    callbackData: hex(o.callback_data),
    receiverIfMakerIsSeller: addr(o.receiver_if_maker_is_seller),
    ratifier: addr(o.ratifier),
    reduceOnly: o.reduce_only,
    maxUnits: BigInt(o.max_units),
    maxAssets: BigInt(o.max_assets),
    continuousFeeCap: BigInt(o.continuous_fee_cap),
  };
}

export interface EncodedTake {
  to: `0x${string}`;
  data: `0x${string}`;
}

/**
 * Encode one `take` per offer in the quote. Sweeping several price levels means
 * several calls — batch them (midnightBundles, or the Safe batch we already
 * build) so they settle together rather than partially.
 */
export function encodeTakes(
  quote: MidnightQuote,
  taker: `0x${string}`,
  opts?: { receiverIfTakerIsSeller?: `0x${string}` }
): EncodedTake[] {
  const receiver = opts?.receiverIfTakerIsSeller ?? taker;

  return quote.takeable_offers.map((t) => ({
    to: MIDNIGHT_CORE,
    data: encodeFunctionData({
      abi: midnightTakeAbi,
      functionName: "take",
      args: [
        toContractOffer(t.offer),
        hex(t.ratifier_data),
        BigInt(t.units),
        taker,
        receiver,
        // No taker callback: we're not sourcing assets just-in-time.
        "0x0000000000000000000000000000000000000000",
        "0x",
      ],
    }),
  }));
}

/** Fetch a takeable quote for a market. `side` is the book being lifted. */
export async function fetchMidnightQuote(
  marketId: string,
  side: "bids" | "asks",
  assets: bigint,
  slippagePct = 0.5
): Promise<MidnightQuote> {
  const url =
    `https://api.morpho.org/v0/midnight/books/${marketId}/${side}/quote` +
    `?assets=${assets.toString()}&slippage=${slippagePct}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Midnight quote ${res.status}`);
  const json = (await res.json()) as { data?: MidnightQuote };
  if (!json.data) throw new Error("Midnight quote returned no data");
  return json.data;
}
