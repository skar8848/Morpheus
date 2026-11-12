// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Cross-chain bridge helpers (design: docs/cross-chain-design.md).
 *
 * Per-node chain resolution (which chain a node runs on once a bridge sits
 * upstream of it), cross-chain edge detection, and USDC detection for the
 * bridge node. Routes are quoted by /api/bridge-routes and executed through
 * LI.FI (crossChainExecutor.ts), not resolved here.
 */

import type { Edge } from "@xyflow/react";
import type { CanvasNode, BridgeNodeData } from "./types";
import type { Asset } from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";

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
    if (new Set(chains).size < 2) continue;

    // The node settles on the chain most of its inputs agree on (ties go to the
    // canvas chain). Only the inputs that DISAGREE are at fault — flagging every
    // edge would blame links that are perfectly fine.
    const counts = new Map<SupportedChainId, number>();
    for (const c of chains) counts.set(c, (counts.get(c) ?? 0) + 1);
    let settleChain = chains[0];
    let best = -1;
    for (const [chain, n] of counts) {
      if (n > best || (n === best && chain === homeChainId)) {
        best = n;
        settleChain = chain;
      }
    }

    const settleName = CHAIN_LABELS[settleChain] ?? `chain ${settleChain}`;
    incoming.forEach((e, i) => {
      if (chains[i] === settleChain) return;
      const fromName = CHAIN_LABELS[chains[i]] ?? `chain ${chains[i]}`;
      conflicts.set(e.id, `Arrives on ${fromName}, but this node settles on ${settleName}`);
    });
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
        // An unconfigured bridge has no destination yet: until it does, what
        // sits behind it stays on the home chain, as getNodeOutputChainId
        // already assumes.
        return (node.data as BridgeNodeData).dstChainId ?? homeChainId;
      }
      for (const e of edges) if (e.target === id) next.push(e.source);
    }
    frontier = next;
  }
  return homeChainId;
}
