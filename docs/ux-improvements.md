<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2025-2026 Alban Derouin. All rights reserved. -->

# Morpheus — UX & product backlog

Status: proposal · Last updated: 2026-07-25

Everything below is grounded in the actual code, not generic advice. Each item
says **why it matters**, and effort is S / M / L. Ordered by value per unit of
work inside each section.

---

## 0. The five that would change the product most

If only five things get done, these:

1. **Turn the execution simulation back on** (§2.1) — the single biggest trust
   gap: users sign without seeing what will happen.
2. **Position-aware editing** — open an existing position and modify it, rather
   than rebuilding it (§4.1).
3. **Per-node APY / HF delta** — "what does this change do to my numbers"
   (§1.1), the question the canvas exists to answer.
4. **Risk panel: liquidation price per market, in one place** (§3.2).
5. **Cross-chain execution (M3)** — the bridge node builds but cannot execute
   (§6.1). Right now it promises something the engine won't deliver.

---

## 1. Answer the question the canvas is for

### 1.1 Per-node impact deltas — **M**
Each node shows absolute values; none shows *marginal* effect. Add to every
node a one-line "impact" row: `Net APY +0.34% · HF −0.21 · Earn +$41/yr`.
**Why:** the whole point of a visual builder is comparing variants. Today you
change a slider and must re-read the top gauge to infer what happened.

### 1.2 Before/after column on the gauge — **S**
When a canvas is derived from live positions, show `now → after` for Net APY,
HF, collateral, debt. **Why:** users think in deltas from their current state,
not absolutes.

### 1.3 Strategy comparison (A/B) — **L**
Duplicate a canvas, tweak, and see both metric sets side by side.
**Why:** "should I loop once more or deposit into the vault instead" is the core
decision and there's no way to hold two answers at once.

### 1.4 Explain the numbers — **S**
Tooltips on Net APY / Earn / Borrow / HF stating the formula and base. We fixed
a real bug where Net APY was computed on a mismatched base; users had no way to
see that. **Why:** an unexplained negative number destroys trust faster than a
missing feature.

---

## 2. Trust before signing

### 2.1 Re-enable the simulation preview — **M**
`ENABLE_SIMULATION_PREVIEW = false` in `ExecuteButton.tsx:48`, disabled because
it sometimes showed a false "Will revert". Fix the false positives (the borrow
auth timing case is already special-cased in preflight) and turn it back on.
**Why:** it is the difference between "sign and hope" and "sign and know". The
preflight already runs and blocks on real errors — only the visual is hidden.

### 2.2 Human-readable bundle steps — **S**
`BundleInspector` shows encoded calls. Add a plain-language list: "1. Approve
1 200 EURCV → 2. Supply 0.92 wstETH as collateral → 3. Borrow 850 EURCV…".
**Why:** users verify intent, not calldata.

### 2.3 Show the cost of the transaction — **S**
Estimated gas in USD, plus swap slippage and bridge fees aggregated into one
"total cost to execute" figure. **Why:** an APY gain of $28/yr is meaningless
next to an unshown $40 of gas.

### 2.4 Post-execution receipt — **M**
After a bundle lands: what actually happened vs. what was projected, with the
tx link. **Why:** closes the loop; today the flow ends at a hash.

### 2.5 Slippage protection on vault deposits — **M**
Flagged `⚠️ PENDING` in `executor.ts:18` — deposits go out without a
`previewDeposit`-derived minimum. **Why:** a correctness gap, not just UX.

---

## 3. Risk, stated plainly

### 3.1 Per-market HF alongside the blended one — **S**
The gauge shows a debt-weighted portfolio HF (correct for "my overall health"),
but Morpho liquidates **per isolated market**. A blended 2.05 can hide a market
at 1.05. Show the worst market next to the average, in red when it diverges.
**Why:** the aggregate can be reassuring exactly when it shouldn't be.

### 3.2 Liquidation price panel — **S**
`BorrowNode` shows the liquidation price per node. Collect them into one panel:
per market, collateral price now, liquidation price, distance %.
**Why:** the number people actually monitor, currently scattered.

### 3.3 Price-shock simulator — **M**
A slider: "if wstETH drops X%" → recompute every HF and highlight what
liquidates first. **Why:** turns a static number into an understandable risk.

### 3.4 Oracle transparency — **S**
Show which oracle each market uses and the price it currently reports. We
learned Morpheus and the Morpho dashboard disagree on HF because one uses spot
USD and the other the market oracle (wstETH priced in EURCV).
**Why:** users see two different HFs and can't tell which to believe.

### 3.5 Real HF from the market oracle — **M**
Compute HF via the market's oracle rather than spot USD prices, matching what
liquidation actually uses. **Why:** removes the discrepancy above at the source.

### 3.6 Borrow-rate sensitivity — **M**
Morpho rates float with utilisation. Show "at 95% utilisation your borrow APY
becomes X%" and the resulting Net APY. **Why:** a carry trade that works at 4%
borrow can invert at 9%, and nothing warns you.

---

## 4. Working from existing positions

### 4.1 Edit a live position, don't rebuild it — **L**
Importing positions creates read-only `position` nodes. Let a user open one and
change it: add collateral, repay part, adjust LTV — generating the delta bundle.
**Why:** most real usage is adjusting what you already have.

### 4.2 One-click deleverage / close — **M**
"Reduce LTV to X" or "close this position" generating repay + withdraw in one
bundle. **Why:** the panic path must be one click, not a manual graph.

### 4.3 Interest accrual over time — **S**
We now show interest paid/earned since inception. Add a small sparkline of
position value. **Why:** context for whether the strategy is actually working.

### 4.4 Vault V2 cost basis — **M**
V2 positions report `pnl: null` because they're discovered on-chain with no cost
basis. Derive it from deposit/withdraw events. **Why:** V2 is where the
interesting vaults are, and they're the ones missing earnings data.

---

## 5. Discovery — being genuinely Morpho-native

### 5.1 Market/vault picker with real data — **M**
Pickers list symbols. Show APY, TVL, utilisation, LLTV and curator inline,
sortable. **Why:** choosing a vault is the highest-leverage decision in the
whole flow and it's currently the least informed one.

### 5.2 Curator and risk metadata — **S**
Surface vault curator, allocation across markets, and whether it holds anything
exotic. **Why:** Morpho users pick vaults by curator; that's the mental model.

### 5.3 Collateral list from the API, not hardcoded — **S**
`COLLATERAL_ASSETS` is a hand-maintained map; HyperEVM and Monad are empty, so
the picker is blank there. Derive from the markets API.
**Why:** new chains and new collaterals work with no code change.

### 5.4 Rewards / incentives — **M**
Morpho markets and vaults often carry reward campaigns. Ignoring them
understates real APY. **Why:** the headline number is wrong without them.

### 5.5 "Find me the best" — **M**
Given a collateral and a target LTV, rank the markets and vaults that maximise
Net APY at acceptable risk. **Why:** turns the tool from a canvas into an
assistant.

---

## 6. Cross-chain, finished properly

### 6.1 Execute cross-chain (M3) — **L**
The bridge node quotes and validates, but `buildExecutionBundle` explicitly
refuses graphs containing one. Ship the two-phase flow (source bundle +
`depositForBurn`, attestation poll, destination bundle), resumable across a
refresh. **Why:** the node currently promises something the engine can't do.

### 6.2 Chain-aware wallet balances — **S**
Balances are fetched on the canvas chain; after a bridge the relevant balances
are on the destination chain. **Why:** "insufficient balance" on the wrong chain
is a confusing error.

### 6.3 Bridge route detail — **S**
Show the route's steps (swap → bridge → swap) and where slippage comes from.
**Why:** users accept a fee they can see, not one they discover.

### 6.4 CowSwap cross-chain — see the note in §9.

---

## 7. Canvas ergonomics

### 7.1 Undo/redo affordance — **S**
History exists (`MAX_HISTORY = 50`) but isn't visible. Add buttons + a toast.

### 7.2 Node duplication — **S**
Cmd+D on a configured node. Building a second loop means redoing everything.

### 7.3 Templates that use *your* positions — **M**
Templates are static. Prefill from the connected wallet's actual holdings.

### 7.4 Validation as a checklist — **S**
Errors are strings in a list. Show them as a checklist that highlights the
offending node when clicked.

### 7.5 Keyboard-first building — **S**
Shortcuts exist for adding nodes; add connect/navigate so a strategy can be
built without the mouse.

### 7.6 Mobile / small-screen read-only view — **M**
The canvas is unusable below ~1000px. A read-only summary would at least let
people open shared links.

---

## 8. Sharing and collaboration

### 8.1 Rich link previews — **S**
Deep links exist (`?strategy=`). Add OG images rendering the strategy summary.
**Why:** strategies get shared in Telegram/X; a blank preview wastes it.

### 8.2 Public read-only strategy pages — **M**
A URL anyone can open without a wallet, showing the graph and metrics.

### 8.3 Export — **S**
Screenshot exists. Add JSON export/import and "copy as Morpho URLs".

---

## 9. Notes on specific asks

### CowSwap cross-chain swaps
Live in production since July 2025 (Bungee, Across, NEAR Intents), but:
- **No public REST API** — quoting is **SDK-only**, `@cowprotocol/sdk-bridging`
  (v4.3.1). The umbrella `@cowprotocol/cow-sdk` does *not* include it.
- **Same-token bridging is not supported.** Source token must differ from
  destination token. So "USDC on Base → USDC on Arbitrum" — the most common
  bridge in Morpheus — is impossible via CoW.
- Sell orders only; not available for smart-contract wallets.
- Mechanism: a normal CoW order on the source chain into an intermediate token,
  `receiver` overridden to the user's CoW Shed proxy, plus a **second signature**
  for a post-hook that deposits into the bridge.

**Recommendation:** not a replacement for the LI.FI bridge node. It's worth
adding later as a distinct "Swap + Bridge" node for the *asset-changing*
cross-chain case (e.g. EURCV on mainnet → USDC on Base) where the MEV-protected
swap leg is a genuine advantage. Two signatures and a new SDK dependency are the
cost.

---

## 10. Codebase health (invisible to users, blocks everything else)

- **21 lint errors, 39 warnings** across `src`. Several are `set-state-in-effect`
  and `refs during render` — real React correctness smells, not style.
- **No timeout on multicalls.** The Vault V2 outage was invisible because the
  RPC was slow, not failing: the call eventually succeeded, so no `catch` fired
  and positions silently vanished. Add timeouts that turn slowness into a
  visible error.
- **RPC health is a single point of failure.** All three mainnet endpoints were
  dead simultaneously. Add a startup health check and a visible degraded-mode
  banner.
- **Chat panel disabled** (`ENABLE_CHAT_PANEL = false`) — decide: finish the
  tool-calling flow or remove the code.
- **Bundler3 migration pending** (`executor.ts:13`) to
  `@morpho-org/bundler-sdk-viem`; hand-rolled encoding is a maintenance risk.
- **`setAuthorizationWithSig`** in-bundle would remove one signature from every
  first-time borrow (`ExecuteButton.tsx:485`).
- **No tests.** The bugs found this session — Net APY base mismatch, `quoteOut`
  in USD vs tokens, `parseUnits` exponential notation, all-edges-flagged — are
  all unit-testable in minutes.
