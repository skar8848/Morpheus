// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Cross-chain plan compiler (M3). Splits a canvas into per-chain segments
 * joined by bridge legs, so the execution engine can run one Bundler3 bundle
 * per chain around each bridge. See docs/cross-chain-design.md.
 *
 * M3 scope: at most ONE bridge (two segments: source → destination). More than
 * one bridge is detected and reported as not-yet-supported rather than compiled
 * incorrectly.
 */

import type { Edge } from "@xyflow/react";
import type { CanvasNode, BridgeNodeData } from "./types";
import type { Asset } from "@/lib/graphql/types";
import type { SupportedChainId } from "@/lib/web3/chains";
import { getNodeChainId } from "./bridge";

export interface BridgeLeg {
  nodeId: string;
  srcChainId: SupportedChainId;
  dstChainId: SupportedChainId;
  tokenIn: Asset | null;
  tokenOut: Asset | null;
  amountInUsd: number;
}

export interface ChainSegment {
  chainId: SupportedChainId;
  /** Non-bridge node ids that execute on this chain, in graph order. */
  nodeIds: string[];
}

export interface CrossChainPlan {
  multiChain: boolean;
  /** Ordered source → destination. Single-chain plans have one segment. */
  segments: ChainSegment[];
  /** The bridge leg joining the two segments (null for single-chain). */
  bridge: BridgeLeg | null;
  /** Set when the graph can't be compiled (e.g. >1 bridge). */
  error?: string;
}

function isBridge(n: CanvasNode): boolean {
  return (n.data as { type?: string }).type === "bridge";
}

/**
 * Compile a canvas into an ordered execution plan. Pure function — no I/O.
 */
export function buildCrossChainPlan(
  nodes: CanvasNode[],
  edges: Edge[],
  homeChainId: SupportedChainId
): CrossChainPlan {
  const bridges = nodes.filter(isBridge);

  // Single-chain: everything runs on the home chain in one segment.
  if (bridges.length === 0) {
    return {
      multiChain: false,
      segments: [{ chainId: homeChainId, nodeIds: nodes.map((n) => n.id) }],
      bridge: null,
    };
  }

  if (bridges.length > 1) {
    return {
      multiChain: true,
      segments: [],
      bridge: null,
      error: "Only one bridge per strategy is supported for now",
    };
  }

  const bridgeNode = bridges[0];
  const bd = bridgeNode.data as unknown as BridgeNodeData;
  const srcChainId = (bd.srcChainId ?? homeChainId) as SupportedChainId;
  const dstChainId = bd.dstChainId as SupportedChainId;

  // Assign every non-bridge node to a chain (home chain, or the bridge's dst
  // chain if it sits downstream of the bridge).
  const srcNodeIds: string[] = [];
  const dstNodeIds: string[] = [];
  for (const n of nodes) {
    if (isBridge(n)) continue;
    const chain = getNodeChainId(n.id, nodes, edges, homeChainId);
    if (chain === dstChainId) dstNodeIds.push(n.id);
    else srcNodeIds.push(n.id);
  }

  return {
    multiChain: true,
    segments: [
      { chainId: srcChainId, nodeIds: srcNodeIds },
      { chainId: dstChainId, nodeIds: dstNodeIds },
    ],
    bridge: {
      nodeId: bridgeNode.id,
      srcChainId,
      dstChainId,
      tokenIn: bd.tokenIn,
      tokenOut: bd.tokenOut,
      amountInUsd: bd.amountInUsd ?? 0,
    },
  };
}

/** Filter a graph down to one segment's nodes + the edges wholly inside it. */
export function sliceSegment(
  segment: ChainSegment,
  nodes: CanvasNode[],
  edges: Edge[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  const idSet = new Set(segment.nodeIds);
  return {
    nodes: nodes.filter((n) => idSet.has(n.id)),
    edges: edges.filter((e) => idSet.has(e.source) && idSet.has(e.target)),
  };
}
