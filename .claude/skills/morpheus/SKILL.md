---
name: morpheus
description: >
  Use this skill when the user wants to visualize, build, or share a Morpho
  lending strategy as a node graph. Morpheus is a visual canvas editor for
  Morpho strategies. Given a strategy goal in natural language, use the Morpho
  MCP to discover markets and vaults, then call the Morpheus API to generate
  a deep-link URL the user can open in their browser to see and execute the
  strategy. Trigger phrases: "visualize this strategy in Morpheus", "build a
  Morpho strategy and show me", "give me a Morpheus link for X", "create a
  yield strategy on Base/Ethereum", "open this in Morpheus".
---

# Morpheus

Morpheus is a visual node-graph editor for composing Morpho lending strategies. It exposes a stateless HTTP API so any agent can build a strategy server-side and hand the user a deep-link URL that opens directly into a pre-built canvas.

## Mental model

A canvas is a directed graph of nodes connected by edges:

- **wallet** — user's source. Connects to: `vaultDeposit` (direct earn), `supplyCollateral` (borrow flow), `swap`, `repay`
- **supplyCollateral** — supply ERC-20 as **collateral on a Morpho Blue market**. Use ONLY when there's a downstream `borrow` — never as a "transfer" bridge. Connects from `wallet`/`swap`/`vaultWithdraw`/`position`. Connects to: `borrow`
- **borrow** — borrow loan asset from a Morpho Blue market. Connects from `supplyCollateral`. Connects to: `swap`, `vaultDeposit`
- **swap** — CowSwap intent (Ethereum mainnet only). Connects from `wallet`/`borrow`/`vaultWithdraw`. Connects to: `vaultDeposit`/`supplyCollateral`/`wallet`/`repay`
- **vaultDeposit** — deposit into a Morpho Vault. Terminal node. Can be fed by `wallet` (pure earn), `borrow` (carry trade), `swap`, or `vaultWithdraw` (rebalance).
- **vaultWithdraw** — withdraw from existing vault position. Connects from `position`. Connects to: `swap`/`vaultDeposit`/`supplyCollateral`/`repay`
- **repay** — repay a Morpho Blue borrow. Terminal.
- **position** — read-only existing position.

### Choosing the right shape

| User intent | Correct flow |
|---|---|
| "Deposit X into vault Y" (pure earn) | `wallet → vaultDeposit` (2 nodes) |
| "Supply X as collateral and borrow Y" | `wallet → supplyCollateral → borrow` |
| "Borrow against my collateral and farm the borrowed asset in a vault" (carry trade) | `wallet → supplyCollateral → borrow → vaultDeposit` |
| "Looped staking" (leverage) | `wallet → supplyCollateral → borrow → swap → supplyCollateral` |

**Do NOT use `supplyCollateral` as a bridge for direct vault deposits** — it has different semantics (it touches a Morpho Blue market, not the vault's underlying asset). The connection rules now allow `wallet → vaultDeposit` directly.

## Endpoint

**`POST /api/canvas`** (default base URL: `http://localhost:3000`, override via env `MORPHEUS_BASE_URL` or ask the user for their deployed URL — e.g. `https://morpheus-app.vercel.app`)

```jsonc
{
  "chain": "ethereum" | "base",
  "sourceAddress": "0x...",
  "nodes": [
    {
      "id": "string",                  // unique within request
      "type": "walletNode" | "supplyCollateralNode" | "borrowNode" | "swapNode" | "vaultDepositNode" | "vaultWithdrawNode" | "repayNode" | "positionNode",
      "position": { "x": number, "y": number },
      "data": { "type": "wallet" | "supplyCollateral" | ... , /* node-specific */ }
    }
  ],
  "edges": [
    {
      "id": "string",
      "source": "<node id>",
      "target": "<node id>",
      "type": "animatedEdge",
      "animated": true
    }
  ]
}
```

Returns:

```jsonc
{
  "ok": true,
  "deepLinkUrl": "http://localhost:3000/ethereum/canvas?strategy=eyJjaGFp...",
  "chain": "ethereum",
  "nodeCount": 4,
  "edgeCount": 3
}
```

Validation errors come back as `{ ok: false, errors: [...] }`. Limits: 100 KB body, 200 nodes, 500 edges. CORS is `*`.

## How to compose with the Morpho MCP

The standard agent flow combines two tools:

1. **Morpho MCP** (`morpho_query_vaults`, `morpho_query_markets`, `morpho_get_vault`, etc.) → discover the best vaults/markets for the user's goal. The MCP returns full data including addresses, decimals, APYs.
2. **Morpheus `/api/canvas`** → wrap that data into a node graph and get a shareable URL.

### Recommended flow

1. Parse the user's intent (deposit X into highest-yielding vault, leverage Y, etc.)
2. Use `morpho_query_vaults` / `morpho_query_markets` to find candidates on the right chain
3. Build the node graph in your head:
   - Always start with a `walletNode` (no incoming edges)
   - Add the actions as nodes connected by `animatedEdge` edges
   - Use the asset address as `data.asset.address`, decimals from the API, etc.
4. POST to `/api/canvas`
5. Return the `deepLinkUrl` to the user with a one-line description of what they'll see

### Example: "deposit 10k USDC into the highest-yielding vault on Base"

This is a **pure earn** flow — `wallet → vaultDeposit` directly. NO `supplyCollateral` node.

```typescript
// Step 1: discover the best vault
const vaults = await callMcpTool("morpho_query_vaults", {
  chain: "base",
  asset_symbol: "USDC",
  sort: "apy_desc",
  limit: 1,
});
const best = vaults.items[0];

// Step 2: build a 2-node canvas — wallet directly to vault
const canvas = {
  chain: "base",
  sourceAddress: userAddress,
  nodes: [
    {
      id: "w1",
      type: "walletNode",
      position: { x: 50, y: 200 },
      data: {
        type: "wallet",
        address: userAddress,
        chain: "base",
        chainId: 8453,
        balances: [],
      },
    },
    {
      id: "v1",
      type: "vaultDepositNode",
      position: { x: 380, y: 200 },
      data: {
        type: "vaultDeposit",
        vault: {
          address: best.address,
          name: best.name,
          symbol: best.symbol,
          asset: {
            symbol: "USDC",
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            decimals: 6,
            logoURI: "https://cdn.morpho.org/assets/logos/usdc.svg",
          },
          state: {
            totalAssets: "0",
            totalAssetsUsd: best.tvlUsd,
            curator: null,
            netApy: best.apyPct / 100,
            fee: 0,
            allocation: [],
          },
        },
        amount: "10000",
        amountUsd: 10000,
        depositAll: false,
      },
    },
  ],
  edges: [
    { id: "e1", source: "w1", target: "v1", type: "animatedEdge", animated: true },
  ],
};

// Step 3: POST
const res = await fetch(`${MORPHEUS_BASE_URL}/api/canvas`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(canvas),
});
const { deepLinkUrl } = await res.json();

// Step 4: present to user
return `Here's your Morpheus deep link: ${deepLinkUrl}\n\nClick to open the canvas with the strategy pre-built. Review the simulation, then click Execute to sign.`;
```

### Example: "borrow 5k USDC against my wstETH and farm the USDC in a vault"

This is a **carry trade** — supplyCollateral IS appropriate here because you're posting wstETH on a Morpho Blue market to borrow against it.

```
wallet → supplyCollateral(wstETH) → borrow(wstETH/USDC market) → vaultDeposit(USDC vault)
```

4 nodes, 3 edges, in that exact order.

## Hard rules

1. **Never invent vault or market addresses.** Always discover them via the Morpho MCP first.
2. **Never auto-execute.** The deep link only opens the canvas — the user must click Execute and sign.
3. **Never set the wallet address to anything other than the user's own.** If you don't know it, leave it as `undefined`.
4. **Always parameterize the chain.** `chain: "ethereum"` (chainId 1) or `chain: "base"` (chainId 8453) — match the chain of the markets/vaults you found.
5. **Decimals must match the asset.** USDC = 6, WETH/wstETH = 18, etc. Read from the MCP response, never assume.
6. **Validate before presenting.** If unsure, POST to `/api/canvas/validate` first to check the schema without generating a URL.
7. **CowSwap is Ethereum-only.** Don't include `swapNode` for Base canvases.
8. **Vault deposits are terminal.** No outgoing edges from `vaultDeposit` or `repay` nodes.

## How to find the user's wallet address

Don't ask repeatedly. If the user is testing locally, leave `sourceAddress` as `"0x0000000000000000000000000000000000000000"` and let them connect their wallet inside Morpheus. The wallet node will be re-injected with their actual address when the canvas loads.

## Common templates

The user can also load 4 pre-built templates from Morpheus's sidebar without an agent:
- **Looped wstETH** (Ethereum): leverage stETH staking
- **Borrow & Yield** (Ethereum): supply WETH → borrow USDC → deposit into vault
- **Multi-Collateral Diversified** (Ethereum): wstETH + WBTC → borrow USDC → vault
- **Base WETH Carry** (Base): same as Borrow & Yield but on Base

If the user's goal matches one of these, suggest the template name first — it's faster than building manually.

## Verifying after build

After POSTing successfully, mention what the user will see when they open the link:
- Number of nodes / steps
- Which markets/vaults are pre-selected
- Net projected APY (computed from your chosen markets/vaults)
- Whether they'll need to set the LTV slider on the BorrowNode
