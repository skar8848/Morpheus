// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Cross-chain bridge helpers (design: docs/cross-chain-design.md).
 *
 * M1 scope: route resolution + per-node chain resolution. No execution yet.
 * The bridge block is CowSwap-style: its route is derived from the input asset
 * (source chain) and output asset (destination chain). USDC on both sides →
 * CCTP v2 direct; otherwise CCTP with an internal swap leg on the side that
 * isn't USDC (surfaced in the quote, not as separate nodes).
 */

import type { Edge } from "@xyflow/react";
import type { CanvasNode, BridgeNodeData } from "./types";
import type { Asset } from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";

/** CCTP v2 domain ids (≠ chainId). Only for chains Morpheus integrates. */
export const CCTP_DOMAINS: Partial<Record<SupportedChainId, number>> = {
  1: 0, // Ethereum
  8453: 6, // Base
  42161: 3, // Arbitrum
  999: 19, // HyperEVM
  143: 15, // Monad
};

/** Native USDC per chain (verified for the CCTP-native set we ship first). */
export const USDC_ADDRESS: Partial<Record<SupportedChainId, `0x${string}`>> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // HyperEVM (999) / Monad (143) USDC addresses TBD — verify before enabling.
};

export function isUsdc(asset: Asset | null, chainId: SupportedChainId): boolean {
  const usdc = USDC_ADDRESS[chainId];
  if (!asset || !usdc) return false;
  return asset.address.toLowerCase() === usdc.toLowerCase();
}

export interface BridgeRoute {
  /** "cctp-v2" today; "stargate"/"unsupported" reserved for later rails. */
  rail: "cctp-v2" | "stargate" | "unsupported";
  /** Bridge USDC on the source side needs a swap in→USDC first. */
  needsSrcSwap: boolean;
  /** Deliver a non-USDC output needs a swap USDC→out on destination. */
  needsDstSwap: boolean;
  /** Rough delivery estimate; live quote comes in M2. */
  etaSeconds: number;
  /** Human note for the UI when the route is degraded or blocked. */
  note?: string;
}

/**
 * Resolve the bridge route from the CowSwap-style in/out.
 * M1: CCTP v2 only. Non-CCTP chains and unknown-USDC chains are flagged.
 */
export function resolveBridgeRoute(
  tokenIn: Asset | null,
  tokenOut: Asset | null,
  src: SupportedChainId,
  dst: SupportedChainId
): BridgeRoute {
  if (src === dst) {
    return { rail: "unsupported", needsSrcSwap: false, needsDstSwap: false, etaSeconds: 0, note: "Source and destination chains are the same" };
  }
  const srcCctp = CCTP_DOMAINS[src] !== undefined;
  const dstCctp = CCTP_DOMAINS[dst] !== undefined;
  if (!srcCctp || !dstCctp) {
    return { rail: "unsupported", needsSrcSwap: false, needsDstSwap: false, etaSeconds: 0, note: "One side isn't CCTP-supported (Stargate rail pending)" };
  }
  // Both chains are on CCTP. A missing native-USDC address means we can't yet
  // build the internal swap leg, so require known USDC on any non-USDC side.
  const inUsdc = isUsdc(tokenIn, src);
  const outUsdc = isUsdc(tokenOut, dst);
  if ((!inUsdc && !USDC_ADDRESS[src]) || (!outUsdc && !USDC_ADDRESS[dst])) {
    return { rail: "unsupported", needsSrcSwap: false, needsDstSwap: false, etaSeconds: 0, note: "USDC address unknown on this chain — verify to enable" };
  }
  return {
    rail: "cctp-v2",
    needsSrcSwap: tokenIn != null && !inUsdc,
    needsDstSwap: tokenOut != null && !outUsdc,
    etaSeconds: 15, // CCTP Fast on the mainnet↔Base/Arb set
  };
}

/**
 * Effective chain of a node: the home chain, unless the node sits downstream of
 * a bridge, in which case it's that bridge's destination chain. Used by
 * validation now and by the execution plan compiler later (M3).
 */
export function getNodeOutputChainId(
  nodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
  homeChainId: SupportedChainId
): SupportedChainId {
  const node = nodes.find((n) => n.id === nodeId);
  // A bridge consumes on its source chain but *delivers* on its destination.
  if (node && (node.data as { type?: string }).type === "bridge") {
    return (node.data as BridgeNodeData).dstChainId ?? homeChainId;
  }
  return getNodeChainId(nodeId, nodes, edges, homeChainId);
}

/**
 * Edges that feed a node from a different chain than its other inputs.
 *
 * A node can only execute on one chain, so mixing (say) a mainnet borrow and a
 * Base bridge output into the same vault deposit can never settle. Returns the
 * ids of every edge into such a node so the UI can grey them and explain why.
 */
export function findChainConflictEdges(
  nodes: CanvasNode[],
  edges: Edge[],
  homeChainId: SupportedChainId
): Map<string, string> {
  const conflicts = new Map<string, string>();
  const byTarget = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = byTarget.get(e.target) ?? [];
    arr.push(e);
    byTarget.set(e.target, arr);
  }

  for (const incoming of byTarget.values()) {
    if (incoming.length < 2) continue;
    const chains = incoming.map((e) => getNodeOutputChainId(e.source, nodes, edges, homeChainId));
    const distinct = Array.from(new Set(chains));
    if (distinct.length < 2) continue;
    const names = distinct.map((c) => CHAIN_LABELS[c] ?? `chain ${c}`).join(" and ");
    for (const e of incoming) {
      conflicts.set(e.id, `Inputs arrive on ${names} — a node settles on one chain only`);
    }
  }
  return conflicts;
}

/** Short chain names for user-facing conflict messages. */
const CHAIN_LABELS: Partial<Record<SupportedChainId, string>> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  999: "HyperEVM",
  143: "Monad",
};

export function getNodeChainId(
  nodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
  homeChainId: SupportedChainId
): SupportedChainId {
  const visited = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.find((n) => n.id === id);
      if (node && id !== nodeId && (node.data as { type?: string }).type === "bridge") {
        return (node.data as BridgeNodeData).dstChainId;
      }
      for (const e of edges) if (e.target === id) next.push(e.source);
    }
    frontier = next;
  }
  return homeChainId;
}
