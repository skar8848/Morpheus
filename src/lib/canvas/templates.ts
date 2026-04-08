// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Strategy templates — pre-built canvas shapes the user can load with one click.
 *
 * Each template is a structural starting point. Asset addresses are pre-filled
 * (so the right token icons appear) but Market and Vault objects are stubbed
 * to null — the user picks real markets and vaults from the dropdowns inside
 * each node after loading. This avoids hardcoding marketIds that might be
 * deprecated and lets the user customize per their risk preference.
 */

import type { CanvasNode, CanvasNodeData } from "./types";
import type { Edge } from "@xyflow/react";
import type { ImportedStrategy } from "./importStrategy";
import type { Asset } from "@/lib/graphql/types";

// --- Asset stubs (per chain) ---

const WSTETH_ETH: Asset = {
  symbol: "wstETH",
  name: "Wrapped Lido Staked ETH",
  address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  decimals: 18,
  logoURI: "https://cdn.morpho.org/assets/logos/wsteth.svg",
};

const WETH_ETH: Asset = {
  symbol: "WETH",
  name: "Wrapped Ether",
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  decimals: 18,
  logoURI: "https://cdn.morpho.org/assets/logos/weth.svg",
};

const WBTC_ETH: Asset = {
  symbol: "WBTC",
  name: "Wrapped Bitcoin",
  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  decimals: 8,
  logoURI: "https://cdn.morpho.org/assets/logos/wbtc.svg",
};

const WETH_BASE: Asset = {
  symbol: "WETH",
  name: "Wrapped Ether",
  address: "0x4200000000000000000000000000000000000006",
  decimals: 18,
  logoURI: "https://cdn.morpho.org/assets/logos/weth.svg",
};

// --- Layout helpers ---

const COL = { wallet: 50, supply: 380, borrow: 710, swap: 1040, vault: 1370 };
const ROW = (i: number) => 80 + i * 220;

let nodeCounter = 0;
const id = (prefix: string) => `tpl-${prefix}-${++nodeCounter}`;

function walletNode(
  cid: number,
  chainSlug: string,
  posY = 80
): CanvasNode {
  return {
    id: id("wallet"),
    type: "walletNode",
    position: { x: COL.wallet, y: posY },
    data: {
      type: "wallet",
      address: undefined,
      chain: chainSlug,
      chainId: cid,
      balances: [],
    } as unknown as CanvasNodeData,
  };
}

function supplyNode(asset: Asset, posY = 80): CanvasNode {
  return {
    id: id("supply"),
    type: "supplyCollateralNode",
    position: { x: COL.supply, y: posY },
    data: {
      type: "supplyCollateral",
      asset,
      amount: "",
      amountUsd: 0,
    } as unknown as CanvasNodeData,
  };
}

/**
 * Borrow node with no market selected — the user picks a market for the given
 * collateral/loan pair from the dropdown. We do NOT hardcode market IDs because
 * markets can be deprecated.
 */
function borrowNode(posY = 80): CanvasNode {
  return {
    id: id("borrow"),
    type: "borrowNode",
    position: { x: COL.borrow, y: posY },
    data: {
      type: "borrow",
      market: null,
      ltvPercent: 50,
      borrowAmount: 0,
      borrowAmountUsd: 0,
      healthFactor: null,
      depositAmountUsd: 0,
    } as unknown as CanvasNodeData,
  };
}

function swapNode(tokenIn: Asset, tokenOut: Asset, cid: number, posY = 80): CanvasNode {
  return {
    id: id("swap"),
    type: "swapNode",
    position: { x: COL.swap, y: posY },
    data: {
      type: "swap",
      tokenIn,
      tokenOut,
      amountIn: "",
      quoteOut: "",
      quoteLoading: false,
      chainId: cid,
    } as unknown as CanvasNodeData,
  };
}

function vaultDepositNode(posY = 80): CanvasNode {
  return {
    id: id("vault"),
    type: "vaultDepositNode",
    position: { x: COL.vault, y: posY },
    data: {
      type: "vaultDeposit",
      vault: null,
      amount: "",
      amountUsd: 0,
      depositAll: true,
    } as unknown as CanvasNodeData,
  };
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "animatedEdge",
    animated: true,
  };
}

// --- Templates ---

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  tag: "leverage" | "yield" | "diversified";
  chain: "ethereum" | "base";
  chainId: number;
  build: () => ImportedStrategy;
}

const TEMPLATES: StrategyTemplate[] = [
  {
    id: "looped-wsteth",
    name: "Looped wstETH",
    description:
      "Leveraged Lido staking — supply wstETH, borrow WETH, swap WETH→wstETH, supply again. Pick the wstETH/WETH market with the LLTV that matches your risk.",
    tag: "leverage",
    chain: "ethereum",
    chainId: 1,
    build() {
      nodeCounter = 0;
      const wallet = walletNode(1, "ethereum", ROW(0));
      const supply1 = supplyNode(WSTETH_ETH, ROW(0));
      const borrow = borrowNode(ROW(0));
      const swap = swapNode(WETH_ETH, WSTETH_ETH, 1, ROW(0));
      const supply2 = supplyNode(WSTETH_ETH, ROW(1));
      // Position swap node at swap column, supply2 below the line
      supply2.position = { x: COL.supply, y: ROW(1) };
      return {
        nodes: [wallet, supply1, borrow, swap, supply2],
        edges: [
          edge(wallet.id, supply1.id),
          edge(supply1.id, borrow.id),
          edge(borrow.id, swap.id),
          edge(swap.id, supply2.id),
        ],
        sourceAddress: "",
      };
    },
  },
  {
    id: "borrow-and-yield",
    name: "Borrow & Yield",
    description:
      "Classic carry trade — supply WETH as collateral, borrow USDC (or any stablecoin), deposit the borrowed stables into a high-APY Morpho vault. Net APY = vault APY − borrow APY.",
    tag: "yield",
    chain: "ethereum",
    chainId: 1,
    build() {
      nodeCounter = 0;
      const wallet = walletNode(1, "ethereum", ROW(0));
      const supply = supplyNode(WETH_ETH, ROW(0));
      const borrow = borrowNode(ROW(0));
      const vault = vaultDepositNode(ROW(0));
      // Slot the vault into the swap column position since there's no swap
      vault.position = { x: COL.swap, y: ROW(0) };
      return {
        nodes: [wallet, supply, borrow, vault],
        edges: [
          edge(wallet.id, supply.id),
          edge(supply.id, borrow.id),
          edge(borrow.id, vault.id),
        ],
        sourceAddress: "",
      };
    },
  },
  {
    id: "multi-collateral-basis",
    name: "Multi-Collateral Diversified",
    description:
      "Spread your risk — supply both wstETH and WBTC as collateral against separate markets, borrow USDC from each, then deposit the combined borrow into a Morpho vault. Diversified collateral reduces single-asset exposure.",
    tag: "diversified",
    chain: "ethereum",
    chainId: 1,
    build() {
      nodeCounter = 0;
      const wallet = walletNode(1, "ethereum", ROW(0));
      const supply1 = supplyNode(WSTETH_ETH, ROW(0));
      const supply2 = supplyNode(WBTC_ETH, ROW(1));
      const borrow1 = borrowNode(ROW(0));
      const borrow2 = borrowNode(ROW(1));
      const vault = vaultDepositNode(ROW(0));
      // Center the vault between the two rows
      vault.position = { x: COL.swap, y: ROW(0) + 110 };
      return {
        nodes: [wallet, supply1, supply2, borrow1, borrow2, vault],
        edges: [
          edge(wallet.id, supply1.id),
          edge(wallet.id, supply2.id),
          edge(supply1.id, borrow1.id),
          edge(supply2.id, borrow2.id),
          edge(borrow1.id, vault.id),
          edge(borrow2.id, vault.id),
        ],
        sourceAddress: "",
      };
    },
  },
  {
    id: "base-eth-yield",
    name: "Base WETH Carry",
    description:
      "Same as Borrow & Yield but on Base — supply WETH on Base, borrow USDC, deposit into a Base Morpho vault. Lower fees, same mechanics.",
    tag: "yield",
    chain: "base",
    chainId: 8453,
    build() {
      nodeCounter = 0;
      const wallet = walletNode(8453, "base", ROW(0));
      const supply = supplyNode(WETH_BASE, ROW(0));
      const borrow = borrowNode(ROW(0));
      const vault = vaultDepositNode(ROW(0));
      vault.position = { x: COL.swap, y: ROW(0) };
      return {
        nodes: [wallet, supply, borrow, vault],
        edges: [
          edge(wallet.id, supply.id),
          edge(supply.id, borrow.id),
          edge(borrow.id, vault.id),
        ],
        sourceAddress: "",
      };
    },
  },
];

/** Return all templates filtered by chain. */
export function getTemplatesForChain(chainId: number): StrategyTemplate[] {
  return TEMPLATES.filter((t) => t.chainId === chainId);
}

/** Return all templates. */
export function getAllTemplates(): StrategyTemplate[] {
  return TEMPLATES;
}

/** Build a template by id. */
export function buildTemplate(id: string): ImportedStrategy | null {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) return null;
  return tpl.build();
}
