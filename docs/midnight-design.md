<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2025-2026 Alban Derouin. All rights reserved. -->

# Midnight — fixed-rate markets in Morpheus

Status: research complete, implementation not started · 2026-07-25

Midnight is Morpho's **fixed-rate, fixed-maturity** lending protocol. It is not
a variant of Blue: it trades zero-coupon *units* through a **maker/taker order
book**. That makes "place market and limit orders" not a feature we'd bolt on —
it is literally how the protocol works.

---

## 1. How it works

### Units and price → rate

A market is immutable at creation: **loan token + maturity date + accepted
collaterals (each with oracle and LLTV) + chain**, optionally gated.

Positions trade in **units**, a zero-coupon instrument:

- 1 **credit** unit = claim on 1 loan token at maturity (the lender holds it)
- 1 **debt** unit = obligation to repay 1 loan token at maturity (the borrower)

> "Each unit is always worth exactly 1 USDC at maturity."

Units trade below par, and the discount *is* the yield:

```
Rate = (1 / P) − 1
```

Docs' own example: buying at `P = 0.95` with 6 months left → 5.26 % over the
term, ≈10.5 % annualised simple.

The consequence that matters for Morpheus: **the rate is fixed at trade time**,
not floating with utilisation. That directly answers a risk we already surface —
a carry trade that works at 4 % borrow can invert at 9 % when utilisation
spikes. On Midnight it cannot move.

### Offers are limit orders

> "Makers create and sign offers offchain to specify the price and maximum size
> they are willing to buy or sell in a market."
> "A taker executes an offer by submitting it to the Midnight contract. Takes
> may be partial."

So the mapping to trading language is exact:

| Trading term | Midnight |
|---|---|
| **Limit order** | sign an offer at your price, publish it |
| **Market order** | take the best existing offer(s) |
| **Partial fill** | supported — any size up to remaining capacity |
| **Cancel/expiry** | offers carry activation and expiry |

Either side can be maker: a lender can post a bid, a borrower can post an ask —
"makers and takers alike can end up on either side."

Offer parameters: market, direction, price, size, expiry, **ratifier**
(validating contract), **callback** (just-in-time asset sourcing), **group
budget** (shared fill limits across offers).

Notably: "Offers are not broadcast by Midnight — they can be distributed through
any external channel." There is no mandated mempool; `midnightMempool` is *a*
publication venue, not the only one.

### Exiting before maturity

Positions in a market are fully fungible (same maturity), so the same book
serves entry and exit: `exit_lend_secondary` sells units early,
`exit_lend_primary` redeems 1:1 at maturity.

---

## 2. Deployment

Base only, per the official `@morpho-org/morpho-ts` registry:

| Contract | Address | Role |
|---|---|---|
| `midnight` | `0xAdedD8ab6dE832766Fedf0FaC4992E5C4D3EA18A` | core: markets, offers, collateral, liquidations |
| `midnightBundles` | `0x091183d729BE9f808c212b475E387A12E67850A7` | batched take / repay / collateral / permit |
| `midnightMempool` | `0xdD6DCE32e21f7b020898a8258dA37355b4017993` | offer payload publication |

Plus `EcrecoverRatifier` (validates EIP-712 signed Merkle roots of offers),
`EcrecoverAuthorizer`, `SetterRatifier`.

---

## 3. The blocker to solve first

**The public Morpho GraphQL API does not expose Midnight.** Verified by
introspection: zero root fields matching midnight / offer / tick, out of 29.

Everything Morpheus does today reads from that API. So the order book —
markets, bids, asks, takeable offers — has no data source yet. Before any UI
work, one of these must be settled:

1. a dedicated Midnight API / subgraph (does one exist publicly?),
2. direct contract reads for market state + an off-chain offer feed,
3. an SDK — `midnightBundles` implies one exists, but the developer docs stop
   at "integration architecture" and never name contract functions, ABIs, npm
   packages or signing formats.

**Nothing should be built until the read path is real.** A fixed-rate node that
can't show live bids and asks is worse than none.

---

## 4. Proposed design (once reads exist)

### `fixedBorrow` / `fixedLend` nodes

One node type, direction chosen inside it — mirroring how a maker can sit on
either side.

**Market order (take):**
- pick market (loan token + maturity)
- enter size
- show best available price, implied fixed rate, and the fill across price
  levels (a take can sweep several offers)
- show slippage in *rate* terms, which is what a user actually cares about:
  "you wanted 6.5 %, this fills at 6.8 %"

**Limit order (make):**
- enter your rate → price is derived via `P = 1 / (1 + rate)`
- size, expiry
- sign the offer; publish
- the node then shows a live state: open / partially filled / filled / expired

### What Morpheus adds that a bare order book doesn't

- **Maturity on the canvas.** A strategy mixing a Blue vault and a Midnight
  borrow has two clocks. The node should show the maturity date and the days
  remaining, and the gauge should flag when a leg matures before another.
- **Fixed vs floating comparison.** Right beside the Blue borrow node: "floating
  1.52 % now, fixed 6.1 % to Dec 2026". That comparison is the reason to choose
  one, and no other tool puts them side by side.
- **Rate risk removed from the projection.** Today's projected P&L silently
  assumes the borrow rate holds. With a fixed leg, that projection is a
  contract, not an assumption — and the UI should say which is which.

### Execution

`midnightBundles` batches take + collateral + permit, which fits the existing
bundle model and the Safe batching already implemented. The cross-chain planner
already splits per chain, and Midnight is Base-only, so a Midnight leg naturally
becomes its own segment.

---

## 5. Open questions

1. Is there a public read API/subgraph for Midnight offers? (blocker)
2. Contract ABIs and the exact `take` / offer-signing signatures — the docs
   don't publish them; the Base contracts would need to be read directly.
3. Where are offers actually distributed in practice — the on-chain mempool, or
   a Morpho-run relay?
4. Do gates restrict who can enter the markets we'd surface?
5. Liquidation mechanics for fixed-maturity debt (there's a dedicated docs page:
   `/learn/concepts/midnight/liquidations`).
