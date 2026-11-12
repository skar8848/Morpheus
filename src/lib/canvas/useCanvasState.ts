// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Edge,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type OnBeforeDelete,
} from "@xyflow/react";
import { useAccount } from "wagmi";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useChain } from "@/lib/context/ChainContext";
import { buildInitialLayout } from "./layout";
import { isValidConnection } from "./validation";
import { KNOWN_NODE_TYPES, VALID_CONNECTIONS, type CanvasNode, type CanvasNodeData } from "./types";
import type { SupportedChainId } from "@/lib/web3/chains";
import { consumeImportedStrategy, parseDeepLink } from "./importStrategy";
import { stripDustNodes } from "./dust";

const MAX_HISTORY = 50;

interface SavedGraph {
  nodes: CanvasNode[];
  edges: Edge[];
}

/**
 * Drop nodes the canvas can no longer render, and the edges that touched them.
 *
 * A draft saved by an older build can hold node kinds that have since been
 * removed (the standalone Supply Collateral node, folded into Borrow). React Flow
 * renders an unknown type as a blank box with no handles, which looks like a bug
 * and can never be connected or executed — better to leave it out.
 */
function dropUnknownNodes(
  nodes: CanvasNode[],
  edges: Edge[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  const kept = nodes.filter((n) => typeof n.type === "string" && KNOWN_NODE_TYPES.has(n.type));
  if (kept.length === nodes.length) return { nodes, edges };
  const ids = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

export function useCanvasState() {
  const { address } = useAccount();
  const { slug, chainId } = useChain();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const initialized = useRef(false);
  const wasImported = useRef(false);

  // --- Undo / Redo history ---
  const historyRef = useRef<SavedGraph[]>([]);
  const redoRef = useRef<SavedGraph[]>([]);
  const skipHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  // The graph the last snapshot was taken from. One user action can reach
  // pushHistory twice in the same tick (a deletion that removes nodes and
  // selected edges: once from deleteNodes, once from the edges change), and a
  // second identical snapshot would make the next Undo look like it did
  // nothing.
  const lastSnapshotRef = useRef<{ nodes: CanvasNode[]; edges: Edge[] } | null>(null);

  const pushHistory = useCallback(() => {
    const last = lastSnapshotRef.current;
    if (last && last.nodes === nodes && last.edges === edges) return;
    lastSnapshotRef.current = { nodes, edges };
    // Snapshot current state before a destructive action
    historyRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    // New action clears redo stack
    redoRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    // Save current state for redo
    redoRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    skipHistoryRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    // Save current state for undo
    historyRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    skipHistoryRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, setNodes, setEdges]);

  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  // Force re-evaluation when historyVersion changes
  void historyVersion;

  const STORAGE_KEY = `morpho-canvas-${chainId}`;

  // Initialize: deep link (?strategy=) → imported strategy → localStorage draft → fresh layout
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 1. Highest precedence: URL deep link from an agent
    const deepLink = parseDeepLink(searchParams);
    if (deepLink) {
      setNodes(deepLink.nodes);
      setEdges(deepLink.edges);
      wasImported.current = true;
      // Strip ?strategy= from the URL so a refresh doesn't re-import
      // and so the saved draft takes over from here.
      try {
        if (pathname) {
          const next = new URLSearchParams(searchParams?.toString() ?? "");
          next.delete("strategy");
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
      } catch { /* router not available, ignore */ }
      return;
    }

    // 2. Next: import from /address page (localStorage handoff)
    const imported = consumeImportedStrategy();
    if (imported) {
      const clean = stripDustNodes(imported.nodes, imported.edges);
      setNodes(clean.nodes);
      setEdges(clean.edges);
      wasImported.current = true;
      return;
    }

    // 3. Saved draft from previous session
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedGraph;
        if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          const known = dropUnknownNodes(parsed.nodes, parsed.edges || []);
          const clean = stripDustNodes(known.nodes, known.edges);
          if (clean.nodes.length > 0) {
            setNodes(clean.nodes);
            setEdges(clean.edges);
            return;
          }
        }
      }
    } catch { /* ignore corrupt data */ }

    // 4. Fresh layout
    const initial = buildInitialLayout(address, slug, chainId, [], []);
    setNodes(initial);
  }, [address, slug, chainId, setNodes, setEdges, searchParams, router, pathname]);

  // Auto-save to localStorage (debounced 2s)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!initialized.current || nodes.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        // Strip wallet balances (large, re-fetched on load)
        const cleanNodes = nodes.map((n) => {
          const d = n.data as { type: string };
          if (d.type === "wallet") {
            return { ...n, data: { ...n.data, balances: [] } } as CanvasNode;
          }
          return n;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: cleanNodes, edges }));
      } catch { /* quota exceeded, ignore */ }
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, STORAGE_KEY]);

  // Connection handler with validation
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection, nodes as CanvasNode[])) return;
      pushHistory();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "animatedEdge",
            animated: true,
          },
          eds
        )
      );
    },
    [nodes, setEdges, pushHistory]
  );

  // Add a new node at a position
  const addNode = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const id = `${type}-${Date.now()}`;
      let data: CanvasNodeData;

      switch (type) {
        case "borrow":
          data = {
            type: "borrow",
            collateralAsset: null,
            collateralAmount: "",
            collateralAmountUsd: 0,
            market: null,
            ltvPercent: 50,
            borrowAmount: 0,
            borrowAmountUsd: 0,
            healthFactor: null,
          };
          break;
        case "lend":
          data = { type: "lend", loanAsset: null, market: null, amount: "", amountUsd: 0 };
          break;
        case "lendWithdraw":
          data = { type: "lendWithdraw", position: null, amount: "" };
          break;
        case "swap":
          data = {
            type: "swap",
            tokenIn: null,
            tokenOut: null,
            amountIn: "",
            quoteOut: "",
            quoteLoading: false,
            chainId,
          };
          break;
        case "vaultDeposit":
          data = { type: "vaultDeposit", vault: null, amount: "", amountUsd: 0 };
          break;
        case "vaultWithdraw":
          data = { type: "vaultWithdraw", position: null, amount: "" };
          break;
        case "repay":
          data = { type: "repay", market: null, amount: "", amountUsd: 0 };
          break;
        case "bridge":
          data = {
            type: "bridge",
            srcChainId: chainId as SupportedChainId,
            dstChainId: chainId as SupportedChainId, // BridgeNode defaults this to a non-source chain
            tokenIn: null,
            tokenOut: null,
            amountIn: "",
            amountInUsd: 0,
            quoteOut: "",
            quoteOutUsd: 0,
            quoteLoading: false,
            routeTool: undefined,
          };
          break;
        default:
          return;
      }

      const nodeTypeMap: Record<string, string> = {
        borrow: "borrowNode",
        lend: "lendNode",
        lendWithdraw: "lendWithdrawNode",
        swap: "swapNode",
        vaultDeposit: "vaultDepositNode",
        vaultWithdraw: "vaultWithdrawNode",
        repay: "repayNode",
        bridge: "bridgeNode",
      };

      const newNode: CanvasNode = {
        id,
        type: nodeTypeMap[type] || type,
        position,
        data,
      };

      pushHistory();
      setNodes((nds) => [...nds, newNode]);
      return id;
    },
    [chainId, setNodes, pushHistory]
  );

  // Delete nodes: reconnect each surviving upstream to each surviving
  // downstream when that connection is valid. The wallet is never deleted.
  //
  // All the nodes go in one call on purpose: deleting them one by one from a
  // render closure re-bridged through nodes that were already gone (select
  // A and B in X→A→B→Y, the second call wired A→Y with A deleted), and each
  // call pushed its own history entry.
  const deleteNodes = useCallback(
    (nodeIds: string[]) => {
      const currentNodes = nodes as CanvasNode[];
      const doomed = new Set(
        nodeIds.filter((id) => {
          const node = currentNodes.find((n) => n.id === id);
          return node && (node.data as { type: string }).type !== "wallet";
        })
      );
      if (doomed.size === 0) return;
      pushHistory();

      // Walk through deleted nodes so a chain of them bridges its two ends.
      const walk = (start: string, dir: "up" | "down"): Set<string> => {
        const found = new Set<string>();
        const seen = new Set<string>([start]);
        const queue = [start];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const e of edges) {
            const next = dir === "up"
              ? (e.target === current ? e.source : null)
              : (e.source === current ? e.target : null);
            if (!next || seen.has(next)) continue;
            seen.add(next);
            if (doomed.has(next)) queue.push(next);
            else found.add(next);
          }
        }
        return found;
      };

      const kept = edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));
      const existing = new Set(kept.map((e) => `${e.source}->${e.target}`));
      const bridgeEdges: Edge[] = [];
      for (const id of doomed) {
        for (const sourceId of walk(id, "up")) {
          for (const targetId of walk(id, "down")) {
            const key = `${sourceId}->${targetId}`;
            if (sourceId === targetId || existing.has(key)) continue;
            const sourceNode = currentNodes.find((n) => n.id === sourceId);
            const targetNode = currentNodes.find((n) => n.id === targetId);
            if (!sourceNode || !targetNode) continue;
            const sourceType = (sourceNode.data as { type: string }).type;
            const targetType = (targetNode.data as { type: string }).type;
            if (!VALID_CONNECTIONS[sourceType]?.includes(targetType)) continue;
            existing.add(key);
            bridgeEdges.push({
              id: `${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: "animatedEdge",
              animated: true,
            });
          }
        }
      }

      setNodes((nds) => nds.filter((n) => !doomed.has(n.id)));
      setEdges((eds) => [
        ...eds.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
        ...bridgeEdges,
      ]);
    },
    [setNodes, setEdges, edges, nodes, pushHistory]
  );

  // Every deletion React Flow starts (Delete/Backspace, a node's X button via
  // deleteElements) lands here first. Nodes are taken over by deleteNodes so
  // all paths bridge and record history the same way; React Flow keeps only
  // the edges it would delete on their own (selected, not touching a node in
  // this deletion), and the wallet's edges survive unless selected.
  const onBeforeDelete: OnBeforeDelete<CanvasNode, Edge> = useCallback(
    async ({ nodes: removing, edges: removingEdges }) => {
      const removingIds = new Set(removing.map((n) => n.id));
      if (removing.length > 0) deleteNodes([...removingIds]);
      return {
        nodes: [],
        edges: removingEdges.filter((e) => {
          const touches = removingIds.has(e.source) || removingIds.has(e.target);
          return !touches || (e.selected === true && !removing.some(
            (n) => (n.id === e.source || n.id === e.target) && (n.data as { type: string }).type !== "wallet"
          ));
        }),
      };
    },
    [deleteNodes]
  );

  // Update data for a specific node
  const updateNodeData = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? ({ ...n, data: { ...n.data, ...newData } } as CanvasNode)
            : n
        )
      );
    },
    [setNodes]
  );

  // Clear canvas — reset to just the wallet node
  const clearGraph = useCallback(() => {
    pushHistory();
    const initial = buildInitialLayout(address, slug, chainId, [], []);
    setNodes(initial);
    setEdges([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [address, slug, chainId, setNodes, setEdges, pushHistory, STORAGE_KEY]);

  // Load a strategy template — replaces the current canvas
  const loadTemplate = useCallback(
    (built: { nodes: CanvasNode[]; edges: Edge[] }) => {
      pushHistory();
      // Inject the connected wallet address into wallet nodes
      const next = built.nodes.map((n) => {
        const d = n.data as { type?: string };
        if (d.type === "wallet") {
          return {
            ...n,
            data: {
              ...n.data,
              address,
              chain: slug,
              chainId,
            },
          } as CanvasNode;
        }
        return n;
      });
      setNodes(next);
      setEdges(built.edges);
      // Trigger the auto-organize effect in CanvasPage so the freshly loaded
      // template is laid out cleanly without the user having to click Organize.
      wasImported.current = true;
    },
    [address, slug, chainId, setNodes, setEdges, pushHistory]
  );

  return {
    nodes,
    edges,
    onNodesChange: onNodesChange as OnNodesChange<CanvasNode>,
    onEdgesChange: onEdgesChange as OnEdgesChange<Edge>,
    onConnect,
    addNode,
    deleteNodes,
    onBeforeDelete,
    updateNodeData,
    clearGraph,
    loadTemplate,
    undo,
    redo,
    canUndo,
    canRedo,
    pushHistory,
    setNodes,
    setEdges,
    wasImported,
  };
}