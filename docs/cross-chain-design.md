<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2025-2026 Alban Derouin. All rights reserved. -->

# Cross-chain strategies — design doc

Status: **DECISIONS LOCKED — implementing M1** · Owner: Alban · Last updated: 2026-07-24

### Decisions (locked 2026-07-24)

- **Execution: Option A** — two signatures, no new contracts (§4).
- **Bridge node = cross-chain swap, CowSwap-style.** The block resolves its route
  from its **input asset (chain A)** and **output asset (chain B)**, exactly like
  the `swap` node resolves tokenIn/tokenOut. Any EURC↔USDC conversion needed for
  the CCTP rail is **internal to the bridge block** (in/out driven), not separate
  auto-inserted swap nodes. So §2.3's "swap-to-USDC-first" becomes the bridge's
  own internal route, surfaced as the quote.
- **No Unichain chain.** The original "unichain mode" ask was a naming mix-up for
  *multichain* = the existing single-network abstraction (you pick the network).
  M0 (add the Unichain L2) is **cancelled**.
- **Start on mainnet.** First implementation is anchored on Ethereum as the home
  chain; first bridge pair is Ethereum ↔ Base (both CCTP-native, both already
  wired with bundler addresses).

Goal: let a single Morpheus canvas span more than one chain — e.g. *withdraw
USDC on Base → bridge to Arbitrum → supply as collateral → borrow → deposit into
a vault on Arbitrum* — with a bridge node that defaults to **CCTP v2** for USDC
and falls back to **Stargate** for everything else. Unichain becomes a
first-class chain in the same move.

This doc is the plan **before** writing code. It exists because cross-chain
breaks two core assumptions of the current engine, and those breaks need a
decision, not an improvisation.

---

## 1. Two assumptions cross-chain breaks

The current engine (`buildExecutionBundle` in `src/lib/canvas/executor.ts`) is
built on:

1. **One chain per canvas.** `ChainContext` provides a single `ChainConfig`;
   every node reads `chainId` from it. `buildExecutionBundle(nodes, edges, user,
   chainId)` resolves *one* `BUNDLER3[chainId]` / `GENERAL_ADAPTER1[chainId]`
   and topo-sorts all nodes into **one Bundler3 multicall = one signature**.
2. **Execution is atomic and synchronous.** The whole strategy lands in a single
   transaction. Preflight simulates it; `ExecuteButton` sends it (plus a one-time
   `setAuthorization`).

Cross-chain violates both:

- Nodes now live on **different chains** → the graph must split into **one
  sub-bundle per chain**, joined by bridge legs.
- A bridge is **asynchronous** (seconds to minutes) and **not atomic** — you
  cannot sign one tx that supplies on Arbitrum funds that haven't been bridged
  from Base yet. Execution becomes a **multi-phase, resumable flow**.

Everything below follows from those two facts.

---

## 2. Bridge mechanics (researched, not assumed)

### 2.1 CCTP v2 (Circle) — the default route for USDC

- **Native burn-and-mint**, USDC only. Source: `TokenMessengerV2.depositForBurn(
  amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee,
  minFinalityThreshold)`; destination: `MessageTransmitterV2.receiveMessage(
  message, attestation)` — **permissionless**, so a relayer can submit it.
- **Fast Transfer**: `minFinalityThreshold ≤ 1000` → ~8–20 s, small fee
  (~0–13 bps, quoted by Iris). **Standard**: threshold `2000` → chain finality
  (minutes), fee 0.
- **Hooks**: `depositForBurnWithHook(..., hookData)` attaches opaque bytes.
  Circle provides **no canonical hook executor** — the integrator's destination
  contract (set as `mintRecipient`/`destinationCaller`) must decode `hookData`
  and act. This matters for §4.
- **Attestation**: poll Iris `GET https://iris-api.circle.com/v2/messages/
  {srcDomain}?transactionHash={hash}` until `status=complete`, then submit
  `message`+`attestation` on destination.
- **Domains** (≠ chainId): Ethereum 0, Base 6, Arbitrum 3, Unichain 10,
  HyperEVM 19, Monad 15. All six of our chains are supported.
- ⚠️ **EURC / EURCV are NOT bridgeable by CCTP.** USDC only. See §3.3.

### 2.2 Stargate V2 (LayerZero) — the fallback / general route

- Pooled-liquidity OFT bridge. Bridges **USDC, USDT, ETH/WETH, BTC, arbitrary
  OFTs**. Entry: `IStargate.sendToken(SendParam, MessagingFee, refund)`.
  `SendParam { dstEid, to(bytes32), amountLD, minAmountLD, extraOptions,
  composeMsg, oftCmd }`. `oftCmd`: `""`=Taxi (fast, dedicated msg), `0x00`=Bus
  (batched, cheap, slower).
- **Composability** = `composeMsg` → destination `endpoint.lzCompose` → a
  contract implementing `ILayerZeroComposer.lzCompose(from, guid, message,
  executor, extraData)`. Same story as CCTP hooks: **we must supply the
  destination composer contract**.
- Stargate **routes USDC through Circle CCTP** where both endpoints support it
  (capital-efficient native USDC); elsewhere it uses **Hydra** (mints `USDC.e`
  OFT — *bridged*, not native USDC). So "Stargate with CCTP-v2 default" is
  literally how Stargate already behaves for USDC on covered routes.
- Quote: `quoteOFT(SendParam)` → `amountReceivedLD` (use as `minAmountLD`);
  `quoteSend(SendParam, payInLz)` → `MessagingFee{ nativeFee }` paid as
  `msg.value`.
- LZ EIDs: Unichain 30320, HyperEVM 30367, Monad 30390 (verified); Ethereum
  30101 / Base 30184 / Arbitrum 30110 (well-known, re-verify).
- ⚠️ **Verify before shipping**: EURC support (unconfirmed) and whether Stargate
  has live pools/OFTs on Unichain / HyperEVM / Monad (LZ endpoint existing ≠
  Stargate liquidity existing).

### 2.3 Why the route choice is really "USDC vs everything else"

CCTP is the clean path but **USDC-only**. The moment a strategy wants to move
value in EURC/EURCV (which most of *our* live strategies do), CCTP is out. Two
options, both with costs:

- **Swap-to-USDC-first**: `… → swap(EURC→USDC) → bridge(USDC via CCTP) →
  swap(USDC→EURC) → …`. Adds two swap legs and slippage, but keeps the fast/
  cheap CCTP rail. Composes naturally with the existing `swap` node.
- **Stargate native token route** (if a EURC pool/OFT exists): one leg, but
  pooled-liquidity fees + route may not exist.

Recommendation: default to CCTP for USDC; for non-USDC, **auto-insert swap legs
to/from USDC** and route the USDC hop via CCTP — surfaced explicitly in the UI so
the user sees the slippage they're accepting.

---

## 3. Data model changes

### 3.1 Per-node chain

Today chain is global. Introduce an explicit `chainId` on every node's data
(default = the canvas's "home" chain for back-compat). The home chain stays in
`ChainContext`; nodes may override. Serialization (canvas JSON / deep links)
gains `data.chainId` per node — additive, old canvases still parse.

### 3.2 New node type: `bridge`

```ts
interface BridgeNodeData {
  type: "bridge";
  srcChainId: SupportedChainId;
  dstChainId: SupportedChainId;
  token: Asset;              // asset entering the bridge (source side)
  route: "cctp-v2" | "stargate-taxi" | "stargate-bus";  // default cctp-v2 for USDC
  amount: string;
  amountUsd: number;
  // quote (filled from Iris / Stargate quoteOFT+quoteSend)
  quote?: { received: string; feeUsd: number; etaSeconds: number; nativeFee: string };
}
```

`VALID_CONNECTIONS` gains bridge as both target and source. A bridge's **input**
must be on `srcChainId`, its **output** on `dstChainId`; downstream nodes inherit
`dstChainId`. Edge validation must enforce chain continuity (§5).

### 3.3 Route resolution

A small resolver `resolveRoute(token, src, dst)`:
- token is USDC and both chains CCTP-supported → `cctp-v2` (Fast if available).
- else if a Stargate route exists → `stargate-*`.
- else if token ≠ USDC → propose the swap-to-USDC-first rewrite (§2.3).
- else → unsupported, block with a clear message.

---

## 4. Execution model — the core decision

A cross-chain strategy compiles to an **ordered plan of per-chain segments and
bridge legs**:

```
segment(Base)   : withdraw USDC        → [source bundle, 1 sig]
bridge          : USDC Base→Arbitrum   → [bridge tx on Base, part of source sig]
   ⟳ wait for attestation / delivery
segment(Arb)    : supply → borrow → vaultDeposit → [dest bundle, 1 sig OR auto]
```

The open question is **how the destination segment executes**. Three options:

### Option A — Manual two-phase (MVP, no new contracts)

- Source: one signature = source Bundler3 bundle **+** the bridge call
  (`depositForBurn` / `sendToken`), with `mintRecipient = user's own EOA`.
- Morpheus polls Iris/LayerZero for delivery, then prompts the user to sign the
  **destination** Bundler3 bundle (the existing single-chain flow, unchanged).
- **Pros**: ships on top of everything we already have; zero new on-chain code;
  no new trust surface. **Cons**: two signatures + a wait; funds sit in the
  user's wallet between phases (safe, but not "one-click").

### Option B — Destination composer/hook contract (atomic auto-continue)

- Deploy a small `MorpheusComposer` per chain implementing `ILayerZeroComposer`
  (Stargate) and a CCTP hook receiver. Bridge with `mintRecipient/to = composer`
  + `composeMsg/hookData = encoded destination bundle`. On arrival the composer
  atomically runs the destination Bundler3 calls.
- **Pros**: true one-signature UX. **Cons**: a new audited contract per chain,
  a real trust/settlement surface, relayer to submit `receiveMessage`/pay dest
  gas, and failure-mode handling (funds stuck in composer). Weeks, not days.

### Option C — Aggregator relayer (LI.FI / Squid)

- Hand the bridge+compose to an aggregator that already runs relayers and
  destination execution. **Pros**: fast to integrate, no contracts. **Cons**:
  replaces our bundler stack for the cross-chain leg, external dependency, less
  control over the exact Morpho calls, fees.

**Recommendation: ship Option A first** (it's a strict superset of today's
engine + a bridge tx + a poller), and design the plan/segment types so Option B
can slot in later without reworking the data model. Decision needed — see end.

### 4.1 Attestation / delivery poller

Shared module `bridgeStatus.ts`: given a source tx hash + route, poll Iris (CCTP)
or LayerZero Scan (Stargate) until delivered; drive the Execute stepper. Must be
resumable (persist the pending plan in localStorage, keyed like the canvas draft)
so a refresh mid-bridge doesn't lose phase B.

---

## 5. Validation

New rules in `validation.ts` / `preflight.ts`:

- Every edge is **same-chain** unless its source is a `bridge` node (the only
  legal chain-crossing edge).
- A `bridge`'s upstream must resolve to `srcChainId`; downstream to `dstChainId`.
- Bridged `token` must be supported by the chosen `route` (USDC for CCTP).
- Preflight simulates **each segment on its own chain** and quotes the bridge;
  it cannot simulate destination calls on funds not yet bridged — so the dest
  segment is preflighted against *projected* balances, flagged as an estimate.
- Warn on: non-USDC via auto-swap (slippage), Standard-transfer latency, and
  Stargate routes with thin/none liquidity on Unichain/HyperEVM/Monad.

---

## 6. UX

- **Bridge node**: src/dst chain pickers, token, a route badge ("CCTP v2 · Fast ·
  ~15s · ~$0.02" vs "Stargate · Bus · ~2min · ~$0.6"), live quote, and the
  auto-swap hint when token ≠ USDC.
- **Chain-tinted nodes / lanes**: each node shows a chain chip; consider grouping
  by chain in columns so the bridge visibly straddles two lanes.
- **Execute stepper**: replaces the single button when the plan is multi-segment
  — "1/3 Source bundle → 2/3 Bridging (poll) → 3/3 Destination bundle", each a
  signature in Option A.

---

## 7. Delivery plan (milestones)

1. ~~**M0 — Unichain**~~ — **cancelled** (naming mix-up, see Decisions).
2. **M1 — Data model + bridge node**: per-node `chainId`, `bridge` node type
   (CowSwap-style in/out), route resolver, validation for chain continuity.
   Canvas renders + serializes multi-chain; no execution yet. *Medium.* ← **now**
3. **M2 — Bridge quoting**: Iris fee + CCTP domain map; Stargate `quoteOFT/
   quoteSend`. Bridge node shows real numbers. *Medium.*
4. **M3 — Option-A execution**: plan compiler (split graph into segments +
   bridge legs), source signature (bundle+`depositForBurn`/`sendToken`),
   `bridgeStatus` poller, destination signature, resumable stepper. *Large.*
   - **Landed (verified engine):** `crossChainPlan.ts` (segment/leg compiler +
     `sliceSegment`), `cctp.ts` (verified TokenMessengerV2/MessageTransmitterV2
     addresses + `depositForBurn`/`receiveMessage` encoding), `/api/bridge-
     attestation` (Iris message+attestation poller). All compile; pure/testable.
   - **Remaining (needs live validation before enabling):** the two-phase
     execute stepper. Phase A = source segment Bundler3 bundle (via
     `buildExecutionBundle` on `sliceSegment`) + USDC approve to TokenMessengerV2
     + `depositForBurn`. Phase B = destination segment bundle — this needs the
     bridged funds modelled as a **wallet input** (the dest segment's entry node
     has no in-graph funding source), a small executor change. Plus resumable
     localStorage state for the pending plan. **Do not enable without a
     small-amount mainnet test** — it moves real USDC across chains.
5. **M4 (optional) — Option B**: `MorpheusComposer` contract + relayer for
   one-signature UX. *Large, separate track, needs audit.*

---

## 8. Open decisions (need your call)

1. **Execution approach for v1**: Option A (2 sigs, no contract) vs B (contract,
   1 sig) vs C (aggregator). Recommendation: A.
2. **EURC/EURCV cross-chain**: accept auto-swap-to-USDC (slippage) as the
   supported path, or wait until we confirm a native Stargate EURC route?
3. **Chain scope for bridging v1**: all six, or start with the CCTP-Fast set
   (Eth/Base/Arb/Unichain) where the rail is fast+cheap and defer HyperEVM/Monad?
4. **Unichain now**: ship M0 immediately (it's independent and low-risk) while
   the rest is designed?

## 9. Risks

- Non-atomic settlement: bridge succeeds, destination step fails/reverts → funds
  land in the user's wallet (Option A: safe, manual retry) or a composer (Option
  B: needs a rescue path). Option A is the conservative default for exactly this.
- Route/liquidity gaps on the newer chains (HyperEVM/Monad/Unichain for
  Stargate) — verify against live APIs, don't trust endpoint existence.
- Fee/slippage surprises on the auto-swap path for EURC.
- Preflight can only estimate the destination segment — set expectations in UI.
