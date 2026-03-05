"use client";

import { useCallback, useEffect, useRef } from "react";
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

  // --- Undo history ---
  const historyRef = useRef<SavedGraph[]>([]);
  const skipHistoryRef = useRef(false);

  const pushHistory = useCallback(() => {
    // Snapshot current state before a destructive action
    historyRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    skipHistoryRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [setNodes, setEdges]);

  // Initialize with just the wallet node — fresh start every time
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initial = buildInitialLayout(
      address,
      slug,
      chainId,
      [],
      []
    );
    setNodes(initial);
  }, [address, slug, chainId, setNodes]);

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
        default:
          return;
      }

      const nodeTypeMap: Record<string, string> = {
        supplyCollateral: "supplyCollateralNode",
        borrow: "borrowNode",
        swap: "swapNode",
        vaultDeposit: "vaultDepositNode",
        vaultWithdraw: "vaultWithdrawNode",
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
  }, [address, slug, chainId, setNodes, setEdges, pushHistory]);

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
    pushHistory,
    setNodes,
    setEdges,
  };
}
