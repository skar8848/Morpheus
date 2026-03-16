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
} from "@xyflow/react";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { buildInitialLayout } from "./layout";
import { isValidConnection } from "./validation";
import { VALID_CONNECTIONS, type CanvasNode, type CanvasNodeData } from "./types";
import { consumeImportedStrategy } from "./importStrategy";

const MAX_HISTORY = 50;

interface SavedGraph {
  nodes: CanvasNode[];
  edges: Edge[];
}

export function useCanvasState() {
  const { address } = useAccount();
  const { slug, chainId } = useChain();

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const initialized = useRef(false);
  const wasImported = useRef(false);

  // --- Undo / Redo history ---
  const historyRef = useRef<SavedGraph[]>([]);
  const redoRef = useRef<SavedGraph[]>([]);
  const skipHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const pushHistory = useCallback(() => {
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

  // Initialize: imported strategy → localStorage draft → fresh layout
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const imported = consumeImportedStrategy();
    if (imported) {
      setNodes(imported.nodes);
      setEdges(imported.edges);
      wasImported.current = true;
      return;
    }

    // Load saved draft from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedGraph;
        if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          setNodes(parsed.nodes);
          setEdges(parsed.edges || []);
          return;
        }
      }
    } catch { /* ignore corrupt data */ }

    const initial = buildInitialLayout(address, slug, chainId, [], []);
    setNodes(initial);
  }, [address, slug, chainId, setNodes, setEdges]);

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
        case "supplyCollateral":
          data = { type: "supplyCollateral", asset: null, amount: "", amountUsd: 0 };
          break;
        case "borrow":
          data = {
            type: "borrow",
            market: null,
            ltvPercent: 50,
            borrowAmount: 0,
            borrowAmountUsd: 0,
            healthFactor: null,
            depositAmountUsd: 0,
          };
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
        default:
          return;
      }

      const nodeTypeMap: Record<string, string> = {
        supplyCollateral: "supplyCollateralNode",
        borrow: "borrowNode",
        swap: "swapNode",
        vaultDeposit: "vaultDepositNode",
        vaultWithdraw: "vaultWithdrawNode",
        repay: "repayNode",
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

  // Delete a node — reconnect upstream→downstream if valid
  const deleteNode = useCallback(
    (nodeId: string) => {
      pushHistory();

      // Find incoming and outgoing edges
      const incoming = edges.filter((e) => e.target === nodeId);
      const outgoing = edges.filter((e) => e.source === nodeId);

      // Build bridge edges for each upstream→downstream pair if valid
      const bridgeEdges: Edge[] = [];
      const currentNodes = nodes as CanvasNode[];

      for (const inEdge of incoming) {
        for (const outEdge of outgoing) {
          const sourceNode = currentNodes.find((n) => n.id === inEdge.source);
          const targetNode = currentNodes.find((n) => n.id === outEdge.target);
          if (!sourceNode || !targetNode) continue;

          const sourceType = (sourceNode.data as { type: string }).type;
          const targetType = (targetNode.data as { type: string }).type;
          const allowed = VALID_CONNECTIONS[sourceType];
          if (allowed?.includes(targetType)) {
            bridgeEdges.push({
              id: `${inEdge.source}-${outEdge.target}`,
              source: inEdge.source,
              target: outEdge.target,
              type: "animatedEdge",
              animated: true,
            });
          }
        }
      }

      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => [
        ...eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
        ...bridgeEdges,
      ]);
    },
    [setNodes, setEdges, edges, nodes, pushHistory]
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

  return {
    nodes,
    edges,
    onNodesChange: onNodesChange as OnNodesChange<CanvasNode>,
    onEdgesChange: onEdgesChange as OnEdgesChange<Edge>,
    onConnect,
    addNode,
    deleteNode,
    updateNodeData,
    clearGraph,
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