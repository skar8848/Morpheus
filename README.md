<p align="center">
  <img src="public/morpheus_logo.png" alt="Morpheus" width="120" />
</p>

<h1 align="center">Morpheus</h1>

<p align="center">
  Visual strategy composer for <a href="https://morpho.org">Morpho Protocol</a> — build, simulate, and execute complex DeFi yield strategies on Ethereum and Base.
</p>

<p align="center">
  <a href="https://morpheus-visualizer.vercel.app">Live App</a>
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
| **Supply Collateral** | Supply assets as collateral to a Morpho market |
| **Borrow** | Borrow against supplied collateral with custom LTV |
| **Swap** | Execute token swaps via CoW Swap |
| **Vault Deposit** | Deploy assets into ERC-4626 vaults |
| **Vault Withdraw** | Withdraw from existing vault positions |
| **Repay** | Repay borrowed positions |

**Canvas features:**
- Drag & drop nodes from sidebar or use keyboard shortcuts (`S`, `B`, `X`, `D`, `W`, `R`)
- Smart connection validation — only valid flows are allowed
- Auto-layout to organize nodes
- Save/load strategies to browser storage
- Export strategy as PNG screenshot
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`)
- Import existing on-chain positions directly onto the canvas

### Strategy — Guided Form Builder

A step-by-step interface for users who prefer a linear workflow over freeform canvas:

1. View your active positions
2. Pick collateral assets
3. Choose a loan asset
4. Configure borrow amounts across markets
5. Simulate health factor and liquidation prices
6. Select vaults and allocate funds
7. Review and execute the full transaction bundle

### Address Explorer

Inspect any address's Morpho activity:
- Supply, collateral, borrow, and vault positions with USD values
- Full transaction history (deposits, borrows, repays, liquidations)
- Net worth dashboard
- One-click import of positions into the canvas

## Supported Chains

- **Ethereum** (Mainnet)
- **Base**

## Protocol Integrations

- **Morpho Blue** — Lending, borrowing, collateral supply, and repayment
- **ERC-4626 Vaults** — Morpho strategy vaults with APY and allocation data
- **CoW Swap** — Decentralized token swaps via batch auctions
- **Morpho Bundler3** — Atomic multi-step transaction execution

## Tech Stack

- **Next.js 16** + **React 19** + **TypeScript**
- **Tailwind CSS 4** — Dark theme UI
- **React Flow** — Interactive node-based canvas
- **Wagmi + Viem** — Wallet connection and on-chain interactions
- **Morpho GraphQL API** — Market, vault, and position data

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `S` | Add Supply Collateral node |
| `B` | Add Borrow node |
| `X` | Add Swap node |
| `D` | Add Vault Deposit node |
| `W` | Add Vault Withdraw node |
| `R` | Add Repay node |
| `Delete` | Remove selected node |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `?` | Show help |

## Deployment

Deployed on [Vercel](https://vercel.com). Pushes to `main` trigger automatic deployments.
