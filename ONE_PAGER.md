# Morpheus — The Visual Layer for Morpho

**Live:** https://morpheus-visualizer.vercel.app · **Repo:** github.com/skar8848/Morpheus

---

## What it is

Morpheus is a **visual node-graph editor for Morpho lending strategies**. Users drag & drop nodes — wallet, supply collateral, borrow, swap (CowSwap), vault deposit, vault withdraw, repay — connect them, and execute the whole graph as **one bundled on-chain transaction**.

It runs on **Ethereum mainnet and Base**, supports both **Morpho Vault V1 (MetaMorpho) and V2**, and ships with templates for the most common flows (looped wstETH, multi-collateral diversified, WETH carry, borrow & yield).

## Why it exists

Composing Morpho strategies today means jumping between the app, an explorer, a swap UI, and a wallet — and approving each leg one signature at a time. Morpheus collapses that into a **single canvas + a single signature**, with a pre-execution simulation that surfaces health factor, projected APY, gas, and authorization requirements before the user signs.

Three things make it more than a UI wrapper:

- **V2 vault discovery that actually works.** Morpho's official MCP `morpho_get_positions` silently drops V2 vault positions. Morpheus exposes a `/api/positions` endpoint that fetches V1 from the Morpho GraphQL + V2 via on-chain multicall, returning a flat agent-friendly JSON. This is the only public endpoint today that gives a complete V1+V2 picture for an address.
- **Combined primitives that the SDK doesn't ship.** A single "repay" node can repay a loan **and** withdraw the freed collateral in the same bundle, then route that collateral downstream into a swap or another vault — closing positions in one click instead of three transactions.
- **CowSwap fallback detection.** When a Morpho market lacks liquidity for a leg, Morpheus suggests a CowSwap node automatically and wires it into the bundle.

## The Morpho Agents integration (new)

Morpho announced **Morpho Agents** — an MCP server at `mcp.morpho.org` that lets Claude Code (and any MCP-compatible agent) query vaults, markets, and positions. Morpheus is now the **visual verification layer** for that flow:

```
User asks Claude → Claude queries Morpho MCP → Claude composes a canvas
                → POSTs it to Morpheus /api/canvas → returns a deep link
                → User opens link → sees the full graph → simulates → signs
```

**Install in one command:**
```
/plugin marketplace add skar8848/Morpheus
/plugin install morpheus
```

This ships a Claude Code skill (`SKILL.md`) that teaches any agent how to translate natural-language intents ("close my wstETH loan and move the freed collateral into the best WETH vault") into a valid Morpheus canvas, then hand the user a deep link instead of a wall of tool-call output. The user always sees what they're about to sign.

**Public endpoints:**
- `POST /api/canvas` — validate a canvas JSON, return a deep-link URL
- `POST /api/canvas/validate` — schema check only
- `GET  /api/positions?address=0x…&chainId=1` — V1+V2 positions for an address
- `POST /api/morpho-simulate` — proxy to Morpho MCP simulation

All CORS-open, Edge-runtime, no API key required.

## Who it's for

- **End users** who want to see and verify a multi-step Morpho strategy before signing
- **Agent builders** who need a trustworthy way to hand control back to a human at the "you're about to sign" moment
- **Morpho devs** who want a reference implementation of bundled flows beyond what `bundler-sdk-viem` covers today (combined repay+withdraw, source-routing freed collateral, V2 discovery)

## Status

Live, in production on Vercel, integrated with Morpho Agents via the Claude Code plugin, and being dogfooded against real positions on mainnet. The bundler executor is hand-rolled on Bundler3/GeneralAdapter1 today; migration to `@morpho-org/bundler-sdk-viem` is the next infrastructure step.

---

**Built by** Alban Derouin · **Contact:** [@skar8848 on GitHub](https://github.com/skar8848) · [Morpheus on X](https://x.com/MorpheusVisual)
