// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Deep-link verification: sign what Morpho says, not what the link says.
 *
 * A `?strategy=` link carries whole market and vault objects: addresses, oracle,
 * IRM, LLTV, names, APYs. The executor encodes the bundle straight from those
 * fields, so a hand-crafted link could dress an attacker's ERC-4626 up as
 * "Steakhouse USDC · 12%", or point a borrow at a permissionless market with a
 * rigged oracle, and the user would see a familiar name and sign it.
 *
 * So a link is trusted for IDENTITY only: a market's uniqueKey, a vault's
 * address. Everything else is fetched again from the Morpho API on the node's
 * own chain and overwrites what the link said. A market or vault the API does
 * not know is cleared from its node (the node stays, empty, like a template)
 * and reported, so the user picks it again from the dropdown.
 *
 * New money only goes where Morpho lists: Borrow, Lend and Vault Deposit require
 * a `listed` market or vault, the same rule the pickers apply to markets.
 * Exits (Repay, the withdraw nodes, imported positions) accept any market or
 * vault the API indexes: a user can legitimately hold a position in an unlisted
 * market, and getting out of it must not be blocked.
 */

import { morphoQuery } from "@/lib/graphql/client";
import { VERIFY_MARKETS_QUERY, VERIFY_VAULTS_QUERY } from "@/lib/graphql/queries";
import type { Asset, Market, UserMarketPosition, UserVaultPosition, Vault } from "@/lib/graphql/types";
import { CHAIN_CONFIGS, type SupportedChainId } from "@/lib/web3/chains";
import { getNodeChainId } from "./bridge";
import type { ImportedStrategy } from "./importStrategy";
import type { CanvasNode, CanvasNodeData } from "./types";

type ListedMarket = Market & { listed: boolean };
type ListedVault = Vault & { listed: boolean };

interface VaultV2Item {
  address: string;
  name: string;
  symbol: string;
  netApy: number | null;
  totalAssetsUsd: number | null;
  asset: Vault["asset"];
}

/** What the Morpho API knows about one chain, keyed by lowercase key/address. */
interface ChainRegistry {
  /** False when the API call failed: nothing on that chain can be vouched for. */
  reachable: boolean;
  markets: Map<string, ListedMarket>;
  vaults: Map<string, ListedVault>;
}

export interface VerifiedImport {
  strategy: ImportedStrategy;
  /** One line per market or vault that was cleared, for the canvas to show. */
  warnings: string[];
  /**
   * False when the Morpho API could not be reached for at least one chain. The
   * strategy is then hollow for reasons that have nothing to do with the link,
   * so the caller should offer a retry rather than load it.
   */
  reachable: boolean;
}

const MARKET_KEY = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const NODE_LABELS: Record<string, string> = {
  borrow: "Borrow",
  lend: "Lend",
  lendWithdraw: "Lend Withdraw",
  repay: "Repay",
  vaultDeposit: "Vault Deposit",
  vaultWithdraw: "Vault Withdraw",
  position: "Position",
};

const short = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex);
const chainLabel = (id: number) => CHAIN_CONFIGS.find((c) => c.chainId === id)?.label ?? `chain ${id}`;

/** The market or vault a node points at, and whether it is new money going in. */
function referenceOf(d: CanvasNodeData): {
  marketKey?: string;
  vaultAddress?: string;
  needsListed: boolean;
} | null {
  switch (d.type) {
    case "borrow":
    case "lend":
      return d.market ? { marketKey: d.market.uniqueKey, needsListed: true } : null;
    case "repay":
      return d.market ? { marketKey: d.market.uniqueKey, needsListed: false } : null;
    case "lendWithdraw":
      return d.position?.market ? { marketKey: d.position.market.uniqueKey, needsListed: false } : null;
    case "vaultDeposit":
      return d.vault ? { vaultAddress: d.vault.address, needsListed: true } : null;
    case "vaultWithdraw":
      return d.position?.vault ? { vaultAddress: d.position.vault.address, needsListed: false } : null;
    case "position":
      if (d.marketPosition?.market) return { marketKey: d.marketPosition.market.uniqueKey, needsListed: false };
      if (d.vaultPosition?.vault) return { vaultAddress: d.vaultPosition.vault.address, needsListed: false };
      return null;
    default:
      return null;
  }
}

async function fetchRegistry(
  chainId: number,
  marketKeys: string[],
  vaultAddresses: string[]
): Promise<ChainRegistry> {
  const registry: ChainRegistry = { reachable: true, markets: new Map(), vaults: new Map() };
  try {
    // Skip a query outright when its list is empty: the API reads an empty `_in`
    // as "no filter" and would hand back every market or vault on the chain.
    const [m, v] = await Promise.all([
      marketKeys.length > 0
        ? morphoQuery<{ markets: { items: ListedMarket[] } }>(VERIFY_MARKETS_QUERY, {
            keys: marketKeys,
            chainId: [chainId],
          })
        : null,
      vaultAddresses.length > 0
        ? morphoQuery<{ vaults: { items: ListedVault[] }; vaultV2s: { items: VaultV2Item[] } }>(
            VERIFY_VAULTS_QUERY,
            { addresses: vaultAddresses, chainId: [chainId] }
          )
        : null,
    ]);
    for (const market of m?.markets.items ?? []) {
      registry.markets.set(market.uniqueKey.toLowerCase(), market);
    }
    for (const vault of v?.vaults.items ?? []) {
      registry.vaults.set(vault.address.toLowerCase(), vault);
    }
    // V2 vaults come back in their own shape; fold them into the V1 one the
    // nodes already render (the query only returns listed V2 vaults).
    for (const vault of v?.vaultV2s.items ?? []) {
      registry.vaults.set(vault.address.toLowerCase(), {
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        asset: vault.asset,
        listed: true,
        state: {
          totalAssets: "0",
          totalAssetsUsd: vault.totalAssetsUsd,
          curator: null,
          netApy: vault.netApy ?? 0,
          fee: 0,
          allocation: [],
        },
      });
    }
  } catch {
    registry.reachable = false;
  }
  return registry;
}

/** Drop the `listed` flag so the node data keeps its usual shape once saved. */
function asMarket({ listed: _listed, ...market }: ListedMarket): Market {
  void _listed;
  return market;
}
function asVault({ listed: _listed, ...vault }: ListedVault): Vault {
  void _listed;
  return vault;
}

/**
 * The token a verified market says a leg uses. The link's own asset object is
 * never kept: its address decides which token gets approved before the bundle
 * is even built, so it has to come from the market Morpho returned.
 */
function marketAsset(a: Market["collateralAsset"] | Market["loanAsset"]): Asset {
  return { symbol: a.symbol, name: a.symbol, address: a.address, decimals: a.decimals, logoURI: a.logoURI };
}

/** Write the API's market or vault into the node, or clear it when there is none. */
function applyReference(
  d: CanvasNodeData,
  market: ListedMarket | null,
  vault: ListedVault | null
): CanvasNodeData | null {
  switch (d.type) {
    case "borrow":
      return {
        ...d,
        market: market ? asMarket(market) : null,
        collateralAsset: market?.collateralAsset ? marketAsset(market.collateralAsset) : null,
      };
    case "lend":
      return {
        ...d,
        market: market ? asMarket(market) : null,
        loanAsset: market ? marketAsset(market.loanAsset) : null,
      };
    case "repay":
      return { ...d, market: market ? asMarket(market) : null };
    case "lendWithdraw":
      return {
        ...d,
        position:
          market && d.position
            ? { ...d.position, market: asMarket(market) as UserMarketPosition["market"] }
            : null,
      };
    case "vaultDeposit":
      return { ...d, vault: vault ? asVault(vault) : null };
    case "vaultWithdraw":
      return {
        ...d,
        position:
          vault && d.position
            ? { ...d.position, vault: asVault(vault) as UserVaultPosition["vault"] }
            : null,
      };
    case "position":
      // A position node with nothing behind it renders as an empty card and
      // can never execute, so the caller drops it instead.
      if (d.marketPosition) {
        return market
          ? {
              ...d,
              marketPosition: {
                ...d.marketPosition,
                market: asMarket(market) as UserMarketPosition["market"],
              },
            }
          : null;
      }
      if (d.vaultPosition) {
        return vault
          ? {
              ...d,
              vaultPosition: { ...d.vaultPosition, vault: asVault(vault) as UserVaultPosition["vault"] },
            }
          : null;
      }
      return d;
    default:
      return d;
  }
}

/**
 * Re-resolve every market and vault a deep-linked strategy names against the
 * Morpho API. Never throws: an unreachable API clears what it could not vouch
 * for rather than letting the link's own data through.
 */
export async function verifyImportedStrategy(
  strategy: ImportedStrategy,
  homeChainId: SupportedChainId
): Promise<VerifiedImport> {
  const { nodes, edges } = strategy;

  // Nodes downstream of a bridge live on its destination chain, so each node is
  // checked against the registry of the chain it will actually execute on.
  const chainOf = new Map<string, number>();
  const wanted = new Map<number, { markets: Set<string>; vaults: Set<string> }>();
  for (const n of nodes) {
    const ref = referenceOf(n.data);
    if (!ref) continue;
    const cid = getNodeChainId(n.id, nodes, edges, homeChainId);
    chainOf.set(n.id, cid);
    const bucket = wanted.get(cid) ?? { markets: new Set<string>(), vaults: new Set<string>() };
    if (ref.marketKey && MARKET_KEY.test(ref.marketKey)) bucket.markets.add(ref.marketKey.toLowerCase());
    if (ref.vaultAddress && ADDRESS.test(ref.vaultAddress)) bucket.vaults.add(ref.vaultAddress.toLowerCase());
    wanted.set(cid, bucket);
  }

  const registries = new Map<number, ChainRegistry>();
  await Promise.all(
    Array.from(wanted, async ([cid, { markets, vaults }]) => {
      registries.set(cid, await fetchRegistry(cid, [...markets], [...vaults]));
    })
  );

  const warnings: string[] = [];
  const dropped = new Set<string>();
  const verified: CanvasNode[] = [];

  for (const n of nodes) {
    const ref = referenceOf(n.data);
    if (!ref) {
      verified.push(n);
      continue;
    }
    const cid = chainOf.get(n.id) ?? homeChainId;
    const registry = registries.get(cid);
    const label = NODE_LABELS[n.data.type] ?? n.data.type;

    let market: ListedMarket | null = null;
    let vault: ListedVault | null = null;
    let problem: string | null = null;

    if (!registry?.reachable) {
      problem = `${label}: the Morpho API could not be reached to verify it`;
    } else if (ref.marketKey) {
      market = registry.markets.get(ref.marketKey.toLowerCase()) ?? null;
      if (!market) problem = `${label}: market ${short(ref.marketKey)} is not a Morpho market on ${chainLabel(cid)}`;
      else if (ref.needsListed && !market.listed) {
        problem = `${label}: market ${short(ref.marketKey)} is not listed by Morpho`;
        market = null;
      } else if (n.data.type === "borrow" && !market.collateralAsset) {
        // Idle markets are listed but take no collateral: the API returns a null
        // collateral asset for them, so there is nothing to borrow against.
        problem = `${label}: market ${short(ref.marketKey)} takes no collateral, nothing can be borrowed from it`;
        market = null;
      }
    } else if (ref.vaultAddress) {
      vault = registry.vaults.get(ref.vaultAddress.toLowerCase()) ?? null;
      if (!vault) problem = `${label}: vault ${short(ref.vaultAddress)} is not a Morpho vault on ${chainLabel(cid)}`;
      else if (ref.needsListed && !vault.listed) {
        problem = `${label}: vault ${short(ref.vaultAddress)} is not listed by Morpho`;
        vault = null;
      }
    }

    if (problem) warnings.push(`${problem}. Pick it again.`);
    const data = applyReference(n.data, market, vault);
    if (data === null) {
      dropped.add(n.id);
      continue;
    }
    verified.push({ ...n, data } as CanvasNode);
  }

  return {
    strategy: {
      ...strategy,
      nodes: verified,
      edges: dropped.size > 0
        ? edges.filter((e) => !dropped.has(e.source) && !dropped.has(e.target))
        : edges,
    },
    warnings,
    reachable: Array.from(registries.values()).every((r) => r.reachable),
  };
}
