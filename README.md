<p align="center">
  <img src="public/morpheus_logo.svg" alt="Morpheus" width="120" />
</p>

<h1 align="center">Morpheus</h1>

<p align="center">
  Visual strategy composer for <a href="https://morpho.org">Morpho Protocol</a> — build, simulate, and execute complex DeFi yield strategies on Ethereum, Base, Arbitrum, HyperEVM and Monad.
</p>

<p align="center">
  <a href="https://morpheus-visualizer.vercel.app/ethereum/canvas">Live App</a>
</p>

---

## What is Morpheus?

Morpheus is a visual interface that lets you compose multi-step DeFi strategies on top of Morpho Blue. Instead of executing transactions one by one, you design your strategy as a flow of connected nodes on an interactive canvas, then execute everything in a single bundled transaction.

**Example**: Supply wstETH as collateral → Borrow USDC → Swap to WETH via CoW Swap → Deposit into a vault — all in one click.

## Features

### Canvas — Visual Strategy Builder

The core of Morpheus. Drag-and-drop nodes onto a canvas to build strategies visually.

**Node types:**
| Node | Description |
|------|-------------|
| **Wallet** | Starting point — shows your token balances |
| **Borrow** | Post collateral on a Morpho market and borrow against it with a custom LTV — one node holds both legs |
| **Lend** | Supply an asset into one isolated Morpho market and earn its supply APY |
| **Lend Withdraw** | Take supply back out of an isolated market |
| **Swap** | Execute token swaps via CoW Swap |
| **Vault Deposit** | Deploy assets into ERC-4626 vaults |
| **Vault Withdraw** | Withdraw from existing vault positions |
| **Repay** | Repay borrowed positions, optionally freeing the collateral in the same bundle |
| **Bridge** | Move an asset to another supported chain through LI.FI, so the next nodes run there |
| **Position** | An existing on-chain position imported from the Address page (read-only) |

**Canvas features:**
- Drag & drop nodes from sidebar or use keyboard shortcuts (`B`, `L`, `U`, `X`, `D`, `W`, `R`, `G`)
- Smart connection validation — only valid flows are allowed
- Auto-layout to organize nodes
- Save/load strategies to browser storage
- Export strategy as PNG screenshot
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`)
- Import existing on-chain positions directly onto the canvas

### Address Explorer

Inspect any address's Morpho activity:
- Supply, collateral, borrow, and vault positions with USD values
- Full transaction history (deposits, borrows, repays, liquidations)
- Net worth dashboard
- One-click import of positions into the canvas

## Supported Chains

- **Ethereum** (Mainnet)
- **Base**
- **Arbitrum**
- **HyperEVM**
- **Monad**

## Protocol Integrations

- **Morpho Blue** — Lending, borrowing, collateral supply, and repayment
- **ERC-4626 Vaults** — Morpho strategy vaults with APY and allocation data
- **CoW Swap** — Decentralized token swaps via batch auctions
- **Morpho Bundler3** — Atomic multi-step transaction execution
- **LI.FI**: cross-chain routes for the Bridge node

## Tech Stack

- **Next.js 16** + **React 19** + **TypeScript**
- **Tailwind CSS 4** — Dark theme UI
- **React Flow** — Interactive node-based canvas
- **Wagmi + Viem** — Wallet connection and on-chain interactions
- **Morpho GraphQL API** — Market, vault, and position data

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `B` | Add Borrow node |
| `L` | Add Lend node |
| `U` | Add Lend Withdraw node |
| `X` | Add Swap node |
| `D` | Add Vault Deposit node |
| `W` | Add Vault Withdraw node |
| `R` | Add Repay node |
| `G` | Add Bridge node |
| `M` | Toggle the minimap |
| `Delete` / `Backspace` | Remove selected node |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `?` | Show help |

## Built by

- **[@0xhaizeka](https://x.com/0xhaizeka)** — design, development, and everything in between

## Deployment

Deployed on [Vercel](https://vercel.com). Pushes to `main` trigger automatic deployments.

## License

This project is licensed under the [Business Source License 1.1](./LICENSE).

**TL;DR:** You can view, fork, and use this code for non-commercial/educational purposes. Commercial use requires a separate license. The code will automatically transition to Apache 2.0 on 2030-03-16.

For commercial licensing, contact alban.derouin@gmail.com.
