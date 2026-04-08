// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useCallback, useRef, useEffect, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import "@xyflow/react/dist/style.css";

import type { Edge } from "@xyflow/react";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { useCanvasState } from "@/lib/canvas/useCanvasState";
import { useChain } from "@/lib/context/ChainContext";
import { isValidConnection, getConnectionHint } from "@/lib/canvas/validation";
import { organizeLayout } from "@/lib/canvas/layout";
import { VALID_CONNECTIONS, DRAGGABLE_NODE_TYPES, NODE_SHORTCUTS, NODE_COLORS, type CanvasNode } from "@/lib/canvas/types";
import Sidebar from "./Sidebar";
import ExecuteButton from "./ExecuteButton";
import StrategyGauge from "./StrategyGauge";
import ChatPanel from "./ChatPanel";
import TimeProjection from "./TimeProjection";

export default function CanvasPage() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    deleteNode,
    clearGraph,
    loadTemplate,
    undo,
    redo,
    canUndo,
    canRedo,
    pushHistory,
    setEdges,
    setNodes,
    wasImported,
  } = useCanvasState();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowInstance = useRef<any>(null);

  const { chainId } = useChain();

  // Node placement mode (keyboard shortcut)
  const [placingNodeType, setPlacingNodeType] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Save/Load strategies
  interface SavedStrategy {
    id: string;
    name: string;
    timestamp: number;
    nodes: CanvasNode[];
    edges: Edge[];
  }
  const STRATEGIES_KEY = `morpho-strategies-${chainId}`;
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [saveFlash, setSaveFlash] = useState(false);

  // Load strategies list from localStorage
  const refreshStrategies = useCallback(() => {
    try {
      const raw = localStorage.getItem(STRATEGIES_KEY);
      setSavedStrategies(raw ? JSON.parse(raw) : []);
    } catch {
      setSavedStrategies([]);
    }
  }, [STRATEGIES_KEY]);

  const saveStrategy = useCallback(() => {
    const name = saveName.trim() || `Strategy ${new Date().toLocaleDateString()}`;
    const cleanNodes = nodes.map((n) => {
      const d = n.data as { type: string };
      if (d.type === "wallet") {
        return { ...n, data: { ...n.data, balances: [] } } as CanvasNode;
      }
      return n;
    });
    const entry: SavedStrategy = {
      id: Date.now().toString(),
      name,
      timestamp: Date.now(),
      nodes: JSON.parse(JSON.stringify(cleanNodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    try {
      const existing: SavedStrategy[] = JSON.parse(localStorage.getItem(STRATEGIES_KEY) || "[]");
      existing.unshift(entry);
      localStorage.setItem(STRATEGIES_KEY, JSON.stringify(existing));
    } catch { /* quota exceeded */ }
    setSaveName("");
    setShowSave(false);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
    refreshStrategies();
  }, [saveName, nodes, edges, STRATEGIES_KEY, refreshStrategies]);

  const loadStrategy = useCallback(
    (strategy: SavedStrategy) => {
      pushHistory();
      setNodes(strategy.nodes as CanvasNode[]);
      setEdges(strategy.edges);
      setShowLoad(false);
    },
    [pushHistory, setNodes, setEdges]
  );

  const deleteStrategy = useCallback(
    (id: string) => {
      try {
        const existing: SavedStrategy[] = JSON.parse(localStorage.getItem(STRATEGIES_KEY) || "[]");
        localStorage.setItem(STRATEGIES_KEY, JSON.stringify(existing.filter((s) => s.id !== id)));
      } catch {}
      refreshStrategies();
    },
    [STRATEGIES_KEY, refreshStrategies]
  );

  // Connection hint state
  const [connectionHint, setConnectionHint] = useState<{
    message: string;
    highlightType: string;
  } | null>(null);
  const hintTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track last rejected connection for onConnectEnd
  const lastRejectionRef = useRef<{ source: string; target: string } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onInit = useCallback((instance: any) => {
    reactFlowInstance.current = instance;
  }, []);

  // Auto-organize after importing positions from address page
  useEffect(() => {
    if (!wasImported.current || nodes.length === 0) return;
    wasImported.current = false;

    // Wait for DOM nodes to render so we can measure sizes
    const timer = setTimeout(() => {
      const sizes = new Map<string, { w: number; h: number }>();
      for (const n of nodes) {
        const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
        if (el) sizes.set(n.id, { w: el.offsetWidth, h: el.offsetHeight });
      }
      isOrganizing.current = true;
      const organized = organizeLayout(nodes as CanvasNode[], edges, sizes);
      setNodes(organized);
      setTimeout(() => {
        reactFlowInstance.current?.fitView({ padding: 0.2 });
        isOrganizing.current = false;
      }, 500);
    }, 300);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  // Drag & drop from sidebar
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // Collect all downstream node ids from a starting node
  const getDownstream = useCallback(
    (startId: string, edgeList: typeof edges) => {
      const downstream = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const e of edgeList) {
          if (e.source === current && !downstream.has(e.target)) {
            downstream.add(e.target);
            queue.push(e.target);
          }
        }
      }
      return downstream;
    },
    []
  );

  const GAP = 5; // px gap between nodes
  const isDragging = useRef(false);
  const isOrganizing = useRef(false);

  /** Get real node bounding box from DOM */
  const getNodeRect = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    const el = document.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
    const w = el?.offsetWidth ?? 280;
    const h = el?.offsetHeight ?? 200;
    return { x: pos.x, y: pos.y, w, h };
  }, []);

  /** Check if two rects overlap (with gap) */
  const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    return (
      a.x < b.x + b.w + GAP &&
      a.x + a.w + GAP > b.x &&
      a.y < b.y + b.h + GAP &&
      a.y + a.h + GAP > b.y
    );
  };

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance.current || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      if (type.startsWith("position:")) return;

      // Check if dropping near an edge — insert in between
      const THRESHOLD = 60;
      let insertedOnEdge = false;

      for (const edge of edges) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        const midX = (sourceNode.position.x + targetNode.position.x) / 2 + 120;
        const midY = (sourceNode.position.y + targetNode.position.y) / 2 + 40;
        const dist = Math.sqrt((position.x - midX) ** 2 + (position.y - midY) ** 2);

        if (dist > THRESHOLD) continue;

        const sourceType = (sourceNode.data as { type: string }).type;
        const targetType = (targetNode.data as { type: string }).type;
        const sourceAllowed = VALID_CONNECTIONS[sourceType]?.includes(type) ?? false;
        const newAllowed = VALID_CONNECTIONS[type]?.includes(targetType) ?? false;

        if (!sourceAllowed || !newAllowed) continue;

        // Place new node between source and target
        const sourceRect = getNodeRect(sourceNode.id, sourceNode.position);
        const insertX = sourceNode.position.x + sourceRect.w + GAP;
        const insertY = (sourceNode.position.y + targetNode.position.y) / 2;

        const newId = addNode(type, { x: insertX, y: insertY });
        if (!newId) break;

        // Push target + all downstream nodes to the right
        const newEdges = [
          ...edges.filter((e) => e.id !== edge.id),
          { id: `${edge.source}-${newId}`, source: edge.source, target: newId, type: "animatedEdge", animated: true },
          { id: `${newId}-${edge.target}`, source: newId, target: edge.target, type: "animatedEdge", animated: true },
        ];

        const downstream = getDownstream(edge.target, newEdges);
        downstream.add(edge.target);

        // Shift by actual new node width (estimate 280 + gap since node not in DOM yet)
        const shiftX = 280 + GAP;

        setNodes((nds) =>
          nds.map((n) =>
            downstream.has(n.id)
              ? { ...n, position: { ...n.position, x: n.position.x + shiftX } }
              : n
          )
        );

        setEdges(newEdges);
        insertedOnEdge = true;
        break;
      }

      if (!insertedOnEdge) {
        addNode(type, position);
      }
    },
    [addNode, edges, nodes, setEdges, setNodes, getDownstream, getNodeRect]
  );

  // Validate connection before allowing — also track rejections for hints
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionValidator = useCallback(
    (connection: any) => {
      const valid = isValidConnection(connection, nodes as CanvasNode[]);
      if (!valid && connection.source && connection.target) {
        lastRejectionRef.current = { source: connection.source, target: connection.target };
      }
      return valid;
    },
    [nodes]
  );

  // Show hint when connection attempt ends on an invalid target
  const onConnectEnd = useCallback(() => {
    const rejection = lastRejectionRef.current;
    lastRejectionRef.current = null;
    if (!rejection) return;

    const hint = getConnectionHint(
      { source: rejection.source, target: rejection.target, sourceHandle: null, targetHandle: null },
      nodes as CanvasNode[]
    );
    if (!hint) return;

    // Clear existing timer
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setConnectionHint(hint);
    hintTimerRef.current = setTimeout(() => setConnectionHint(null), 3000);
  }, [nodes]);

  // Place node on canvas click (keyboard shortcut mode)
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (!placingNodeType || !reactFlowInstance.current) return;
      const position = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(placingNodeType, position);
      setPlacingNodeType(null);
    },
    [placingNodeType, addNode]
  );

  // Keyboard handler — Delete + Ctrl+Z + node shortcuts
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      const inInput = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

      // Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y — redo
      if ((event.metaKey || event.ctrlKey) && ((event.shiftKey && event.key === "z") || event.key === "y")) {
        event.preventDefault();
        redo();
        return;
      }

      // Ctrl+Z / Cmd+Z — undo
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      // Delete/Backspace — only when not in input
      if (inInput) return;

      if (event.key === "Escape") {
        setPlacingNodeType(null);
        setShowHelp(false);
        return;
      }

      if (event.key === "?") {
        setShowHelp((prev) => !prev);
        return;
      }

      // Node placement shortcuts (S/B/X/D/W/R) — only bare keys, no modifiers
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const nodeType = NODE_SHORTCUTS[event.key.toLowerCase()];
        if (nodeType) {
          event.preventDefault();
          setPlacingNodeType((prev) => (prev === nodeType ? null : nodeType));
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const selected = nodes.filter((n) => n.selected);
        selected.forEach((n) => {
          if ((n.data as { type: string }).type !== "wallet") {
            deleteNode(n.id);
          }
        });
      }
    },
    [nodes, deleteNode, undo]
  );

  // Also listen globally for Ctrl+Z / Ctrl+Shift+Z when canvas is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!reactFlowWrapper.current?.contains(document.activeElement)) return;
      if ((e.metaKey || e.ctrlKey) && ((e.shiftKey && e.key === "z") || e.key === "y")) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Close save/load dropdowns on outside click
  useEffect(() => {
    if (!showSave && !showLoad) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) {
        setShowSave(false);
        setShowLoad(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSave, showLoad]);

  // Snap back if dropped on another node
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onNodeDragStart = useCallback((_event: any, node: any) => {
    isDragging.current = true;
    dragStartPos.current = { ...node.position };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onNodeDragStop = useCallback((_event: any, draggedNode: any) => {
    isDragging.current = false;
    if (!dragStartPos.current) return;
    const startPos = dragStartPos.current;
    dragStartPos.current = null;

    const draggedRect = getNodeRect(draggedNode.id, draggedNode.position);
    const overlaps = nodes.some((n) => {
      if (n.id === draggedNode.id) return false;
      const otherRect = getNodeRect(n.id, n.position);
      return rectsOverlap(draggedRect, otherRect);
    });

    if (overlaps) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === draggedNode.id
            ? { ...n, position: startPos }
            : n
        )
      );
    }
  }, [nodes, setNodes, getNodeRect]);

  // Watch for node resizes — push overlapping neighbors apart
  const resizeDebounce = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const container = reactFlowWrapper.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (isDragging.current || isOrganizing.current) return;
      if (resizeDebounce.current) clearTimeout(resizeDebounce.current);
      resizeDebounce.current = setTimeout(() => {
        if (isDragging.current || isOrganizing.current) return;
        setNodes((nds) => {
          const rects = nds.map((n) => ({ id: n.id, ...getNodeRect(n.id, n.position) }));
          let changed = false;
          const updated = nds.map((n) => ({ ...n, position: { ...n.position } }));

          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i];
              const b = rects[j];
              if (rectsOverlap(a, b)) {
                // Push the one further right even more right
                const pushIdx = a.x <= b.x ? j : i;
                const stayIdx = a.x <= b.x ? i : j;
                const stay = rects[stayIdx];
                const push = rects[pushIdx];
                const newX = stay.x + stay.w + GAP;
                updated[pushIdx].position.x = newX;
                rects[pushIdx].x = newX;
                changed = true;
              }
            }
          }
          return changed ? updated : nds;
        });
      }, 200);
    });

    // Observe all node elements
    const nodeEls = container.querySelectorAll(".react-flow__node");
    nodeEls.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  });

  // Wrap onNodesChange to snapshot before deletions from React Flow (X button)
  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      const hasDeletion = changes.some((c) => c.type === "remove");
      if (hasDeletion) pushHistory();
      onNodesChange(changes);
    },
    [onNodesChange, pushHistory]
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      const hasDeletion = changes.some((c) => c.type === "remove");
      if (hasDeletion) pushHistory();
      onEdgesChange(changes);
    },
    [onEdgesChange, pushHistory]
  );

  return (
    <div
      ref={reactFlowWrapper}
      className={`relative h-[calc(100vh-var(--nav-height))] w-full ${placingNodeType ? "[&_.react-flow__pane]:cursor-crosshair" : ""}`}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <Sidebar
        onAddPosition={() => {}}
        highlightType={connectionHint?.highlightType}
        onLoadTemplate={(tpl) => {
          const built = tpl.build();
          loadTemplate(built);
        }}
      />

      {/* Connection hint toast */}
      {connectionHint && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-50 -translate-x-1/2 animate-fade-in">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#f59e0b" strokeWidth="1.5" />
              <path d="M8 4.5v4" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.75" fill="#f59e0b" />
            </svg>
            <span className="text-xs font-medium text-text-primary">{connectionHint.message}</span>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onInit={onInit}
        onDragOver={onDragOver}
        onDrop={onDrop}
        isValidConnection={connectionValidator}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: "animatedEdge",
          animated: true,
        }}
        proOptions={{ hideAttribution: true }}
        className="canvas-flow"
      >
        <Controls
          className="!rounded-xl !border !border-border !bg-bg-card !shadow-lg"
          showInteractive={false}
        />
        <MiniMap
          className="!rounded-xl !border !border-border !bg-bg-card"
          nodeColor={(node) => {
            const type = (node.data as { type: string }).type;
            const colors: Record<string, string> = {
              wallet: "#2973ff",
              supplyCollateral: "#2973ff",
              borrow: "#39a699",
              swap: "#f59e0b",
              vaultDeposit: "#a855f7",
              vaultWithdraw: "#f97316",
              position: "#6b7079",
            };
            return colors[type] ?? "#6b7079";
          }}
          maskColor="rgba(21, 24, 26, 0.7)"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255, 255, 255, 0.05)"
        />
      </ReactFlow>

      <ExecuteButton nodes={nodes as CanvasNode[]} edges={edges} />

      {/* AI strategy assistant — sliding right panel */}
      <ChatPanel />
      <StrategyGauge nodes={nodes as CanvasNode[]} edges={edges} />
      <TimeProjection nodes={nodes as CanvasNode[]} edges={edges} />

      {/* Placement mode indicator */}
      {placingNodeType && (
        <div className="pointer-events-none absolute left-1/2 bottom-24 z-50 -translate-x-1/2 animate-fade-in">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border bg-bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <span
              className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
              style={{ backgroundColor: NODE_COLORS[placingNodeType] }}
            >
              {DRAGGABLE_NODE_TYPES.find((t) => t.type === placingNodeType)?.icon}
            </span>
            <span className="text-xs font-medium text-text-primary">
              Click to place{" "}
              <span className="text-brand">
                {DRAGGABLE_NODE_TYPES.find((t) => t.type === placingNodeType)?.label}
              </span>
            </span>
            <kbd className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">ESC</kbd>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-[360px] rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-text-tertiary transition-colors hover:text-text-primary"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Place Nodes
              </p>
              {DRAGGABLE_NODE_TYPES.map(({ type, label, shortcut }) => (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold text-white"
                      style={{ backgroundColor: NODE_COLORS[type] }}
                    />
                    <span className="text-xs text-text-primary">{label}</span>
                  </div>
                  <kbd className="rounded border border-border bg-bg-secondary px-2 py-0.5 text-[11px] font-mono text-text-secondary">
                    {shortcut}
                  </kbd>
                </div>
              ))}
              <div className="!mt-3 border-t border-border pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  General
                </p>
                {[
                  ["Ctrl+Z", "Undo"],
                  ["Ctrl+Shift+Z", "Redo"],
                  ["Delete", "Delete selected node"],
                  ["Escape", "Cancel placement"],
                  ["?", "Toggle this help"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg px-2 py-1.5">
                    <span className="text-xs text-text-primary">{desc}</span>
                    <kbd className="rounded border border-border bg-bg-secondary px-2 py-0.5 text-[11px] font-mono text-text-secondary">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-right buttons */}
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        {/* Undo / Redo */}
        <div className="flex items-center rounded-lg border border-border bg-bg-card/90 overflow-hidden">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2 py-1.5 text-text-tertiary transition-colors hover:text-brand disabled:opacity-30 disabled:hover:text-text-tertiary"
            title="Undo (Ctrl+Z)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 7h7a3 3 0 010 6H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 4L4 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2 py-1.5 text-text-tertiary transition-colors hover:text-brand disabled:opacity-30 disabled:hover:text-text-tertiary"
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M12 7H5a3 3 0 000 6h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {/* Organize */}
        <button
          onClick={() => {
            pushHistory();
            // Measure real DOM sizes for proper alignment
            const sizes = new Map<string, { w: number; h: number }>();
            for (const n of nodes) {
              const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
              if (el) sizes.set(n.id, { w: el.offsetWidth, h: el.offsetHeight });
            }
            // Pause ResizeObserver collision detection during organize
            isOrganizing.current = true;
            const organized = organizeLayout(nodes as CanvasNode[], edges, sizes);
            setNodes(organized);
            setTimeout(() => {
              reactFlowInstance.current?.fitView({ padding: 0.2 });
              isOrganizing.current = false;
            }, 500);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-card/90 px-3 py-1.5 text-[10px] text-text-tertiary transition-colors hover:text-brand"
          title="Auto-organize layout"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="4" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="6" y="6.5" width="4" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="11" y="2" width="4" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="11" y="11" width="4" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 3.5h1M10 8h1M10 8v-4.5h1M10 8v4.5h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          Organize
        </button>
        <button
          onClick={() => {
            const viewport = document.querySelector(".react-flow__viewport") as HTMLElement;
            if (!viewport || nodes.length === 0) return;

            // Compute tight bounding box from real DOM node dimensions
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const n of nodes) {
              const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
              const w = el?.offsetWidth ?? 280;
              const h = el?.offsetHeight ?? 200;
              minX = Math.min(minX, n.position.x);
              minY = Math.min(minY, n.position.y);
              maxX = Math.max(maxX, n.position.x + w);
              maxY = Math.max(maxY, n.position.y + h);
            }

            const padding = 50;
            const contentW = maxX - minX + padding * 2;
            const contentH = maxY - minY + padding * 2;
            // Render at 1:1 scale (zoom=1) for sharp output
            const tx = -minX + padding;
            const ty = -minY + padding;

            const doExport = (skipImages: boolean) =>
              toPng(viewport, {
                backgroundColor: "#15181a",
                width: contentW,
                height: contentH,
                pixelRatio: 3,
                skipFonts: true,
                imagePlaceholder: "",
                filter: (node) => {
                  if (node?.classList?.contains("react-flow__minimap")) return false;
                  if (node?.classList?.contains("react-flow__controls")) return false;
                  if (skipImages && node instanceof HTMLImageElement) return false;
                  return true;
                },
                style: {
                  width: `${contentW}px`,
                  height: `${contentH}px`,
                  transform: `translate(${tx}px, ${ty}px) scale(1)`,
                },
              });

            doExport(false)
              .catch(() => doExport(true))
              .then((dataUrl) => {
                const a = document.createElement("a");
                a.download = "morpheus-strategy.png";
                a.href = dataUrl;
                a.click();
              });
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-card/90 px-3 py-1.5 text-[10px] text-text-tertiary transition-colors hover:text-brand"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="5.5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 9l3.5-3 3 2.5L11 6l3 3v1.5a1 1 0 01-1 1H3a1 1 0 01-1-1V9z" fill="currentColor" fillOpacity="0.3" />
          </svg>
          Screenshot
        </button>
        {/* Save strategy */}
        <div className="relative" data-dropdown>
          <button
            onClick={() => { setShowSave((p) => !p); setShowLoad(false); }}
            className={`flex items-center gap-1.5 rounded-lg border bg-bg-card/90 px-3 py-1.5 text-[10px] transition-colors ${
              saveFlash
                ? "border-success/50 text-success"
                : "border-border text-text-tertiary hover:text-brand"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M12.7 2H4.3A1.3 1.3 0 003 3.3v9.4A1.3 1.3 0 004.3 14h8.4a1.3 1.3 0 001.3-1.3V4.6L12.7 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M11 14V9H5v5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5 2v3h5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {saveFlash ? "Saved!" : "Save"}
          </button>
          {showSave && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border bg-bg-card p-3 shadow-2xl">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Save Strategy
              </p>
              <form
                onSubmit={(e) => { e.preventDefault(); saveStrategy(); }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Strategy name..."
                  className="flex-1 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  Save
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Load strategy */}
        <div className="relative" data-dropdown>
          <button
            onClick={() => { setShowLoad((p) => !p); setShowSave(false); refreshStrategies(); }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-card/90 px-3 py-1.5 text-[10px] text-text-tertiary transition-colors hover:text-brand"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 4.5A1.5 1.5 0 013.5 3h3.3a1.5 1.5 0 011.06.44L9.06 4.5h3.44A1.5 1.5 0 0114 6v6.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-8z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Load
          </button>
          {showLoad && (
            <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-bg-card p-3 shadow-2xl">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Saved Strategies
              </p>
              {savedStrategies.length === 0 ? (
                <p className="py-3 text-center text-[10px] text-text-tertiary">
                  No saved strategies yet
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {savedStrategies.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-2.5 py-2 transition-colors hover:border-brand/30"
                    >
                      <button
                        onClick={() => loadStrategy(s)}
                        className="flex-1 text-left"
                      >
                        <p className="text-xs font-medium text-text-primary">{s.name}</p>
                        <p className="text-[9px] text-text-tertiary">
                          {new Date(s.timestamp).toLocaleDateString()}{" "}
                          {new Date(s.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" · "}
                          {s.nodes.filter((n) => (n.data as { type: string }).type !== "wallet").length} nodes
                        </p>
                      </button>
                      <button
                        onClick={() => deleteStrategy(s.id)}
                        className="ml-2 rounded p-1 text-text-tertiary opacity-0 transition-all hover:text-error group-hover:opacity-100"
                        title="Delete strategy"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => setShowHelp((prev) => !prev)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-bg-card/90 text-xs font-bold text-text-tertiary transition-colors hover:text-brand"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
        <button
          onClick={clearGraph}
          className="rounded-lg border border-border bg-bg-card/90 px-3 py-1.5 text-[10px] text-text-tertiary transition-colors hover:text-error"
        >
          Clear Canvas
        </button>
      </div>
    </div>
  );
}