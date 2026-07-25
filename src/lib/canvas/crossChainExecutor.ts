// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Cross-chain execution (M3).
 *
 * The shape changed once bridge routes came from LI.FI rather than a hand-rolled
 * CCTP flow: LI.FI returns a ready transaction and its own relayers deliver on
 * the destination chain. So a bridge leg is *one* user transaction (plus an
 * ERC-20 approval), not a burn / attestation / mint sequence.
 *
 * A cross-chain strategy therefore executes as an ordered list of phases:
 *
 *   1. source bundle      — Morpho actions before the bridge (existing engine)
 *   2. approve            — ERC-20 allowance for the bridge router
 *   3. bridge             — the LI.FI transaction; funds land on the destination
 *   4. destination bundle — Morpho actions after the bridge, on the other chain
 *
 * Phase 4 needs the bridged funds to have arrived, so it is a separate signature
 * on a different chain. The plan is persisted so a refresh mid-bridge doesn't
 * lose it.
 */

import type { Edge } from "@xyflow/react";
import { parseUnits } from "viem";
import type { CanvasNode, BridgeNodeData } from "./types";
import type { SupportedChainId } from "@/lib/web3/chains";
import { buildCrossChainPlan, sliceSegment } from "./crossChainPlan";

export type PhaseKind = "sourceBundle" | "approve" | "bridge" | "destinationBundle";

export interface ExecutionPhase {
  kind: PhaseKind;
  label: string;
  detail: string;
  chainId: SupportedChainId;
}

export interface CrossChainExecution {
  isCrossChain: boolean;
  phases: ExecutionPhase[];
  /** Nodes/edges that run on the source chain (before the bridge). */
  sourceSegment: { nodes: CanvasNode[]; edges: Edge[] } | null;
  /** Nodes/edges that run on the destination chain (after the bridge). */
  destinationSegment: { nodes: CanvasNode[]; edges: Edge[] } | null;
  bridge: {
    nodeId: string;
    srcChainId: SupportedChainId;
    dstChainId: SupportedChainId;
    srcToken: string;
    dstToken: string;
    amountRaw: string;
    tool?: string;
    label: string;
  } | null;
  error?: string;
}

const NO_EXECUTION: CrossChainExecution = {
  isCrossChain: false,
  phases: [],
  sourceSegment: null,
  destinationSegment: null,
  bridge: null,
};

/**
 * Turn a canvas into an ordered execution plan. Pure — no network, no signing.
 */
export function planCrossChainExecution(
  nodes: CanvasNode[],
  edges: Edge[],
  homeChainId: SupportedChainId
): CrossChainExecution {
  const plan = buildCrossChainPlan(nodes, edges, homeChainId);
  if (!plan.multiChain || !plan.bridge) return NO_EXECUTION;
  if (plan.error) return { ...NO_EXECUTION, isCrossChain: true, error: plan.error };

  const bridgeNode = nodes.find((n) => n.id === plan.bridge!.nodeId);
  const bd = bridgeNode?.data as unknown as BridgeNodeData | undefined;
  if (!bd?.tokenIn || !bd.tokenOut) {
    return { ...NO_EXECUTION, isCrossChain: true, error: "Bridge node is missing its source or destination asset" };
  }

  const amountIn = parseFloat(bd.amountIn || "0");
  if (!isFinite(amountIn) || amountIn <= 0) {
    return { ...NO_EXECUTION, isCrossChain: true, error: "Bridge node has no amount to send" };
  }

  let amountRaw: string;
  try {
    // toFixed, not String(): small amounts otherwise render as "1e-7", which
    // parseUnits rejects.
    amountRaw = parseUnits(amountIn.toFixed(bd.tokenIn.decimals), bd.tokenIn.decimals).toString();
  } catch {
    return { ...NO_EXECUTION, isCrossChain: true, error: "Bridge amount could not be encoded" };
  }

  const src = sliceSegment(plan.segments[0], nodes, edges);
  const dst = sliceSegment(plan.segments[1], nodes, edges);

  // A segment only needs a bundle if it holds Morpho actions; wallet and
  // position nodes on their own produce no calls.
  const actionable = (segment: { nodes: CanvasNode[] }) =>
    segment.nodes.some((n) => {
      const t = (n.data as { type?: string }).type;
      return t === "supplyCollateral" || t === "borrow" || t === "vaultDeposit" || t === "vaultWithdraw" || t === "repay";
    });

  const phases: ExecutionPhase[] = [];
  const srcChainId = plan.bridge.srcChainId;
  const dstChainId = plan.bridge.dstChainId;

  if (actionable(src)) {
    phases.push({
      kind: "sourceBundle",
      label: "Source actions",
      detail: "Morpho actions before the bridge",
      chainId: srcChainId,
    });
  }
  phases.push({
    kind: "approve",
    label: `Approve ${bd.tokenIn.symbol}`,
    detail: "Allowance for the bridge router",
    chainId: srcChainId,
  });
  phases.push({
    kind: "bridge",
    label: `Bridge ${bd.tokenIn.symbol} → ${bd.tokenOut.symbol}`,
    detail: "Delivered on the destination chain by the route provider",
    chainId: srcChainId,
  });
  if (actionable(dst)) {
    phases.push({
      kind: "destinationBundle",
      label: "Destination actions",
      detail: "Signed once the bridged funds arrive",
      chainId: dstChainId,
    });
  }

  return {
    isCrossChain: true,
    phases,
    sourceSegment: actionable(src) ? src : null,
    destinationSegment: actionable(dst) ? dst : null,
    bridge: {
      nodeId: plan.bridge.nodeId,
      srcChainId,
      dstChainId,
      srcToken: bd.tokenIn.address,
      dstToken: bd.tokenOut.address,
      amountRaw,
      tool: bd.routeTool,
      label: `${bd.tokenIn.symbol} → ${bd.tokenOut.symbol}`,
    },
  };
}

export interface BridgeTransaction {
  ok: boolean;
  error?: string;
  tool?: string | null;
  toolName?: string | null;
  substituted?: boolean;
  approvalAddress?: string | null;
  minReceived?: string | null;
  transaction?: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number; gasLimit: string | null };
}

/** Fetch a fresh, signable bridge transaction for the planned leg. */
export async function fetchBridgeTransaction(
  bridge: NonNullable<CrossChainExecution["bridge"]>,
  wallet: `0x${string}`
): Promise<BridgeTransaction> {
  try {
    const res = await fetch("/api/bridge-step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        srcChainId: bridge.srcChainId,
        dstChainId: bridge.dstChainId,
        srcToken: bridge.srcToken,
        dstToken: bridge.dstToken,
        amountRaw: bridge.amountRaw,
        wallet,
        tool: bridge.tool,
      }),
    });
    return (await res.json()) as BridgeTransaction;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed to build bridge transaction" };
  }
}

// --- Resumable state -------------------------------------------------------

export interface PendingBridge {
  bridgeTxHash: string;
  srcChainId: number;
  dstChainId: number;
  label: string;
  startedAt: number;
  /** Serialized destination segment, so phase 4 survives a refresh. */
  destination?: { nodes: CanvasNode[]; edges: Edge[] } | null;
}

const PENDING_KEY = "morpheus-pending-bridge";

export function savePendingBridge(p: PendingBridge) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage full or unavailable — the flow still works, just not resumable */
  }
}

export function loadPendingBridge(): PendingBridge | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingBridge) : null;
  } catch {
    return null;
  }
}

export function clearPendingBridge() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
