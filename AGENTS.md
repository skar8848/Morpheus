---
name: morpheus
description: >
  Morpheus is a visual node-graph editor for composing Morpho lending strategies.
  Use this file when an AI agent needs to: read or describe a Morpheus canvas,
  generate a canvas from a natural-language goal, deep-link a user into a pre-built
  strategy, validate a strategy graph, or explain Morpheus's mental model. Morpheus
  is the visualization layer for the Morpho Agents ecosystem — agents build
  strategies, Morpheus shows the user what the strategy will do before they sign.
---

# Morpheus

> **Live app**: https://morpheus-app.vercel.app
> **Repo**: https://github.com/skar8848/Morpheus
> **License**: BUSL 1.1

Morpheus is a Next.js + React Flow application that lets a user (or an agent) compose **Morpho Blue** strategies as a visual node graph and execute them as a single bundled transaction. It is the **visual front-end** counterpart to the Morpho Agents CLI/MCP — agents prepare operations, Morpheus shows the user what those operations look like end-to-end before they sign.

## Mental Model

A **canvas** is a directed graph of **nodes** connected by **edges**. Each node represents one DeFi action (supply collateral, borrow, swap, deposit into vault, etc.). Edges express data flow: the output of one node becomes the input of the next (e.g., the asset borrowed flows into a swap node, whose output flows into a vault deposit node).

```
WalletNode  ──asset──▶  SupplyCollateralNode  ──collateral──▶  BorrowNode
                                                                    │
                                                                    ▼ borrowed asset
                                                              SwapNode (CowSwap)
                                                                    │
                                                                    ▼ swapped asset
                                                              VaultDepositNode
```

When the user clicks **Execute**, the executor walks the graph in topological order and emits the corresponding Morpho protocol calls as a single multicall.

## Node Types

| Type | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `wallet` | User's connected EOA, balances, chain | — | `supplyCollateral`, `swap`, `repay` |
| `supplyCollateral` | Supply an ERC-20 as collateral to a Morpho Blue market | `wallet`, `swap`, `vaultWithdraw`, `position` | `borrow`, `vaultDeposit` |
| `borrow` | Borrow loan asset from a Morpho Blue market with LTV target + health-factor preview | `supplyCollateral` | `swap`, `vaultDeposit` |
| `swap` | CowSwap intent-based swap (Ethereum mainnet only — Base not supported by CoW) | `wallet`, `borrow`, `vaultWithdraw` | `vaultDeposit`, `supplyCollateral`, `wallet`, `repay` |
| `vaultDeposit` | Deposit into a Morpho Vault (v1 MetaMorpho or v2). Supports multi-source allocation percentages | `supplyCollateral`, `borrow`, `swap`, `vaultWithdraw` | — |
| `vaultWithdraw` | Withdraw shares from an existing vault position (uses `redeem()`, not `withdraw()`, to avoid dust) | `position` | `swap`, `vaultDeposit`, `supplyCollateral`, `repay` |
| `repay` | Repay borrow on a Morpho Blue market | `wallet`, `swap`, `vaultWithdraw` | — |
| `position` | Read-only existing on-chain position imported from `useAddressPositions` | — | `vaultWithdraw`, `supplyCollateral`, `swap` |

The full validation map lives in `src/lib/canvas/types.ts` (`VALID_CONNECTIONS`). Always check it before constructing connections — invalid edges are rejected at runtime.

## Canonical Canvas JSON

The portable, agent-friendly representation of a canvas. This is what `morpheus_create_canvas` accepts and what `morpheus_get_canvas` returns. Agents should emit and consume this exact shape.

```jsonc
{
  "version": 1,
  "chain": "ethereum",                  // "ethereum" | "base"
  "nodes": [
    {
      "id": "wallet-1",
      "type": "wallet",
      "position": { "x": 50, "y": 300 } // optional — auto-laid out if missing
    },
    {
      "id": "supply-1",
      "type": "supplyCollateral",
      "data": {
        "assetSymbol": "wstETH",        // human-readable; resolved to address at runtime
        "amount": "10"                  // human units, NOT raw — Morpheus parses with the asset's decimals
      }
    },
    {
      "id": "borrow-1",
      "type": "borrow",
      "data": {
        "marketId": "0x...",            // Morpho Blue market unique key
        "ltvPercent": 60                // target LTV in percent (0..LLTV)
      }
    },
    {
      "id": "swap-1",
      "type": "swap",
      "data": {
        "tokenInSymbol": "USDC",
        "tokenOutSymbol": "WETH",
        "amountIn": "max"               // "max" or human-readable number
      }
    },
    {
      "id": "vault-1",
      "type": "vaultDeposit",
      "data": {
        "vaultAddress": "0x...",        // Morpho vault address
        "amount": "max",
        "allocPcts": { "swap-1": 100 }  // optional multi-source allocation
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "wallet-1",  "target": "supply-1" },
    { "id": "e2", "source": "supply-1",  "target": "borrow-1" },
    { "id": "e3", "source": "borrow-1",  "target": "swap-1"   },
    { "id": "e4", "source": "swap-1",    "target": "vault-1"  }
  ]
}
```

**Resolution rules** when an agent emits this JSON:

1. `assetSymbol` is resolved against the chain's asset registry. If ambiguous, use the address form.
2. `marketId` is the Morpho Blue `uniqueKey` (32-byte hex). Discover via the Morpho GraphQL API or `morpho_query_markets`.
3. `vaultAddress` is the on-chain vault contract address. Discover via `morpho_query_vaults`.
4. `amount` is **always human-readable** (e.g. `"10"` for 10 wstETH). The runtime parses it with the asset's decimals — never pass raw units.
5. `"max"` means "use the entire upstream amount". For wallet-sourced inputs, it means full balance.

## Deep Link API

Agents can deep-link a user directly into a pre-built canvas:

```
https://morpheus-app.vercel.app/{chain}/canvas?strategy=<base64url(json)>
```

- `{chain}`: `ethereum` or `base`
- `strategy`: a base64url-encoded UTF-8 JSON blob using the **Canonical Canvas JSON** format above

**Shorter alternative** for atomic operations (no full graph):

```
https://morpheus-app.vercel.app/{chain}/canvas?actions=<base64url(json)>
```

Where the JSON is an array of action descriptors:

```jsonc
[
  { "kind": "supplyCollateral", "marketId": "0x...", "amount": "10" },
  { "kind": "borrow",            "marketId": "0x...", "ltvPercent": 60 },
  { "kind": "vaultDeposit",      "vaultAddress": "0x...", "amount": "max" }
]
```

Morpheus parses this list, builds the corresponding nodes + edges, auto-lays them out, and waits for the user to click Execute. **Morpheus never auto-executes from a deep link** — the user must always confirm.

## Public HTTP API (for agents)

Morpheus exposes two stateless endpoints under `/api/canvas/*`. CORS is permissive — any origin can call them. No authentication, no storage. The canvas IS the URL.

### `POST /api/canvas`

Validates a canvas and returns a deep-link URL the user can open.

**Request body** (JSON):
```jsonc
{
  "chain": "ethereum",                  // optional, default "ethereum"
  "nodes": [ /* CanvasNode[] */ ],
  "edges": [ /* Edge[] */ ],
  "sourceAddress": "0x..."              // user's address (display only)
}
```

The `nodes` and `edges` shapes match the internal `ImportedStrategy` format documented in `src/lib/canvas/importStrategy.ts`. Node `type` must be one of: `walletNode`, `supplyCollateralNode`, `borrowNode`, `swapNode`, `vaultDepositNode`, `vaultWithdrawNode`, `repayNode`, `positionNode`. The inner `data.type` is the data discriminant: `wallet`, `supplyCollateral`, `borrow`, `swap`, `vaultDeposit`, `vaultWithdraw`, `repay`, `position`.

**Response** (200):
```jsonc
{
  "ok": true,
  "deepLinkUrl": "https://morpheus-app.vercel.app/ethereum/canvas?strategy=eyJub2RlcyI6...",
  "strategyHash": "eyJub2RlcyI6",
  "chain": "ethereum",
  "nodeCount": 4,
  "edgeCount": 3
}
```

**Response** (400):
```jsonc
{
  "ok": false,
  "errors": ["nodes[2].data.type: must be one of wallet, supplyCollateral, ..."]
}
```

**Limits**: payload max 100 KB, nodes max 200, edges max 500.

### `POST /api/canvas/validate`

Same body shape, but validates only — does not return a deep link. Useful for an agent that wants a sanity check before presenting the canvas to a user.

### Example: cURL

```bash
curl -X POST https://morpheus-app.vercel.app/api/canvas \
  -H "content-type: application/json" \
  -d '{
    "chain": "ethereum",
    "nodes": [...],
    "edges": [...],
    "sourceAddress": "0xabc..."
  }'
```

### Example: Agent in Claude/Cursor

```
1. Agent uses morpho_query_markets / morpho_query_vaults via the Morpho MCP
   to find the right market and vault.
2. Agent builds the nodes/edges JSON locally.
3. Agent POSTs to https://morpheus-app.vercel.app/api/canvas
4. Agent gives the returned deepLinkUrl to the user.
5. User opens the link, sees the strategy on the canvas, clicks Execute.
```

## Morpho Agents Integration

Morpheus is designed to compose with the Morpho Agents stack:

| Morpho Agents (CLI/MCP) | Morpheus |
|------------------------|----------|
| Reads vault/market data | Same — reuses Morpho GraphQL API |
| Prepares unsigned transactions | Same — encodes via the Morpho SDK |
| Simulates post-state | Morpheus calls `morpho_simulate_transactions` before executing and overlays the diff on the canvas |
| Returns JSON to a chat agent | Morpheus consumes that JSON via deep links and shows it visually |

**The recommended flow when an agent (Claude/Cursor/Codex) uses Morpheus:**

1. Agent discovers the user's intent (e.g. "deposit 10k USDC into the highest-yielding USDC vault on Base")
2. Agent uses the Morpho MCP (`morpho_query_vaults`, `morpho_prepare_deposit`) to find the vault and prepare the transaction
3. Agent emits a Canonical Canvas JSON describing the strategy
4. Agent generates a Morpheus deep link and hands it to the user
5. User opens the link, sees the strategy visually on the canvas, sees the simulated post-state, and clicks Execute when confident
6. Morpheus signs and submits the transaction via the connected wallet

This makes Morpheus the **visual confirmation layer** between an autonomous agent and an irrevocable on-chain action.

## Architecture

```
Morpheus/
├── src/
│   ├── app/
│   │   ├── [chain]/
│   │   │   ├── canvas/              # The node-graph editor (main page)
│   │   │   ├── address/             # View/import positions of any address
│   │   │   ├── strategy/            # Legacy step-by-step builder (kept for fallback)
│   │   │   └── layout.tsx           # Wraps with ChainProvider + Navbar
│   │   ├── layout.tsx               # Web3Provider (wagmi + react-query)
│   │   └── page.tsx                 # Redirects to /ethereum/canvas
│   │
│   ├── lib/
│   │   ├── canvas/
│   │   │   ├── types.ts             # CanvasNode, VALID_CONNECTIONS, NODE_COLORS
│   │   │   ├── validation.ts        # isValidConnection, validateGraph
│   │   │   ├── executor.ts          # Topological walk → Morpho calls
│   │   │   ├── importStrategy.ts    # Parse deep links + Canonical JSON
│   │   │   ├── layout.ts            # Auto-layout (column-based, then tree refinement)
│   │   │   └── useCanvasState.ts    # Central state hook (nodes, edges, undo/redo, save/load)
│   │   ├── graphql/                 # Morpho API client + types + queries
│   │   ├── hooks/                   # useMarkets, useVaults, useUserPositions, etc.
│   │   ├── cowswap/                 # CoW Protocol integration (quotes + order signing)
│   │   ├── web3/                    # wagmi config, chain definitions
│   │   ├── context/                 # ChainContext
│   │   └── constants/               # contracts.ts (Morpho, CoW), assets.ts (per-chain)
│   │
│   └── components/
│       ├── canvas/                  # ReactFlow canvas + Sidebar + ExecuteButton + nodes/
│       ├── address/                 # /address page components
│       ├── strategy/                # Legacy step-by-step builder
│       ├── layout/                  # Navbar
│       └── ui/                      # Card, Badge, Skeleton primitives
```

## Build & Dev

```bash
npm install
npm run dev          # Next.js dev server on http://localhost:3000
npm run build        # Production build (Turbopack)
npm run lint
```

The project uses **Tailwind v4** with CSS variables for theming (`src/app/globals.css`). Design tokens: `--bg-primary`, `--bg-card`, `--brand` (#2973ff), `--success` (#39a699), `--error` (#c73e59).

## Safety Rules (Apply Before Touching `executor.ts`)

These mirror the Morpho Builder skill — agents modifying Morpheus's executor MUST observe them.

1. **No Bundler3.** Bundler3 is deprecated. New code must use the Morpho SDK (`@morpho-org/blue-sdk-viem`, `@morpho-org/bundler-sdk-viem`) or call the singleton directly. The current `executor.ts` predates this guidance and is pending migration (see task: bundler safety improvements).
2. **Singleton address**: `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` — same on Ethereum and Base via CREATE2.
3. **Slippage protection on vault ops**: deposits use `previewDeposit()` + 1% tolerance; full withdrawals use `redeem()` (not `withdraw()`) to avoid dust.
4. **USDT approval quirk**: must reset allowance to 0 before setting a new value.
5. **DAI**: use `approve()`, not EIP-2612 permit (DAI's permit signature is non-standard).
6. **Decimals**: read from the asset registry, never assume 18. USDC/USDT = 6, WETH/DAI = 18.
7. **Health factor**: validate after the simulated borrow. Block execution at HF < 1.0; warn at HF < 1.1.
8. **Vault V2 quirk**: `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem` always return zero. Do not gate UI or executor on these.
9. **Pre-flight simulate**: every Execute click runs the bundle through a simulation (currently `eth_call`; migrating to `morpho_simulate_transactions` from the MCP) before signing.
10. **Chain parameterized**: never hardcode chain IDs. Always read from `useChain()` / URL `[chain]` segment.

## Things An Agent Should NOT Do

- **Do not auto-execute** from a deep link. The user must click Execute.
- **Do not fabricate addresses**. Always discover via the Morpho GraphQL API or `morpho_query_*` MCP tools, then put the address in the Canonical JSON.
- **Do not assume token decimals**. Resolve via the asset registry.
- **Do not bypass `validateGraph()`**. Even a programmatically-built canvas must pass validation before execution.
- **Do not connect a `vaultDeposit` or `repay` node to anything downstream** — they are terminal nodes.
- **Do not expect CowSwap to work on Base**. CoW Protocol only supports Ethereum mainnet currently. Use a different swap route or skip the swap on Base.
- **Do not strip the BUSL 1.1 license headers** from existing files.

## Post-Implementation Review

When generating or modifying Morpheus code, an agent MUST verify each item below before presenting the result. Mark CRITICAL (fund loss / broken execution), WARNING (broken UX), or N/A.

1. **Graph validity** — every new edge passes `isValidConnection`; no orphan nodes; no cycles.
2. **No Bundler3** — new code does not import from `BUNDLER3` constants; uses Morpho SDK or singleton calls instead.
3. **Slippage** — vault ops include preview + tolerance; full exits use `redeem()`.
4. **Decimals** — all `parseUnits` calls read decimals from asset metadata.
5. **Approvals** — USDT path resets allowance; DAI uses `approve()`.
6. **Health factor** — borrow flows compute and gate on HF.
7. **Chain parameterized** — no hardcoded `1` or `8453`; reads from `useChain()`.
8. **Pre-flight sim** — Execute path simulates before signing.
9. **License headers** — new `.ts`/`.tsx` files start with the BUSL header.
10. **No emoji in code** — Morpheus does not use emojis in source files (per project convention).

## Glossary

- **Canvas** — the visual workspace containing the node graph
- **Node** — a single visual block representing one Morpho operation
- **Edge** — a directed connection expressing data flow between two nodes
- **LLTV** — Liquidation Loan-to-Value, the threshold at which a Morpho Blue position becomes liquidatable (raw 1e18, e.g. `860000000000000000` = 86%)
- **HF** — Health Factor: `(collateral × LLTV) / borrow`. ≥ 1.0 = safe; < 1.0 = liquidatable
- **MetaMorpho** / **Vault V1** — the original Morpho vault contract (`metaMorphoAbi`)
- **Vault V2** — the newer Morpho vault contract (`vaultV2Abi`) — preferred for new deployments, incompatible ABI with V1
- **Singleton** — the single Morpho Blue contract holding all markets, deployed at the same address on both chains
- **Bundler3** — the deprecated transaction bundler. Do not reference in new code.
