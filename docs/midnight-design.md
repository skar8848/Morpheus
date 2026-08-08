<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2025-2026 Alban Derouin. All rights reserved. -->

# Midnight — fixed-rate markets in Morpheus

Status: research complete, read path verified live, implementation not started · 2026-07-25

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

## 3. The read path — it exists (correcting an earlier note)

An earlier version of this doc said Midnight had no data source. That was wrong:
I had only introspected the **GraphQL** API. Midnight is served by a separate
**REST** API, documented under *Mempool & Router*, and it works today.

Offers themselves live offchain — the mempool contract "simply logs each offer
as an event (no storage or mapping is performed)", and "different participants
might see different subsets of offers". Morpho runs a **router** that aggregates
and validates them, and exposes them publicly.

Base URL: `https://api.morpho.org` (verified; `blue-api.morpho.org` also answers)

| Endpoint | Purpose |
|---|---|
| `GET /v0/midnight/books?chain_ids={id}&limit={n}` | markets + aggregated bids/asks per tick (`limit` max **20**) |
| `GET /v0/midnight/books/{market-id}?depth=50` | depth for one market |
| `GET /v0/midnight/books/{market-id}/asks/quote?assets={amt}&slippage={%}` | takeable offers: full `Offer` structs + `ratifierData`, ready to submit onchain |
| `POST /v0/midnight/mempool/validate` | pre-flight that the router will index your offer |

The quote endpoint deliberately returns *more* than requested, so a take still
fills if another taker consumes part of the book first — concurrency handled
for us.

**Live sample (Base, 2026-07-25):** 5 markets, USDC against cbBTC.

| Maturity | Days | Best price | Implied |
|---|---|---|---|
| 2026-08-28 | 20 | 0.998023 | **3.62 % ann.** |
| 2026-09-25 | 48 | 0.994761 | **4.01 % ann.** |

Market payload carries everything a node needs: `market_id`, `loan_token`,
`collaterals[] {token, lltv, oracle, liquidation_cursor}`, `maturity`,
`enter_gate` / `liquidator_gate`, and `bids`/`asks` as `{tick, price, units,
assets, count}`.

So the read path is **not** a blocker. What's still unpublished is the write
side: contract ABIs and the exact take/sign signatures. But `.../asks/quote`
returning "complete `Offer` structs and `ratifierData` ready for onchain
submission" implies the take payload is handed to us — the remaining unknown is
the function to submit it to.

### Prior art: Tenor

[Tenor](https://www.tenor.finance/) is built directly on Midnight, live on Base
since 2026-07-21, and extends it with whitelisted markets, org accounts with
roles, OTC matching and grace periods. Worth studying as a reference
implementation of the take flow — and a reminder that Morpheus's angle should be
*composition* (a fixed-rate leg inside a larger strategy), not competing with a
dedicated fixed-rate front end.

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

1. ~~Public read API~~ — **answered**, see §3.
2. Contract ABIs and the exact `take` / offer-signing signatures — still
   unpublished; read the Base contracts directly, or observe how Tenor submits.
3. Where are offers actually distributed in practice — the on-chain mempool, or
   a Morpho-run relay?
4. Do gates restrict who can enter the markets we'd surface?
5. Liquidation mechanics for fixed-maturity debt (there's a dedicated docs page:
   `/learn/concepts/midnight/liquidations`).
