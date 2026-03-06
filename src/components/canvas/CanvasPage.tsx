"use client";

import { useCallback, useRef, useEffect, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { useCanvasState } from "@/lib/canvas/useCanvasState";
import { isValidConnection, getConnectionHint } from "@/lib/canvas/validation";
import { VALID_CONNECTIONS, type CanvasNode } from "@/lib/canvas/types";
import Sidebar from "./Sidebar";
import ExecuteButton from "./ExecuteButton";

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
    undo,
    pushHistory,
    setEdges,
    setNodes,
  } = useCanvasState();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowInstance = useRef<any>(null);

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

  // Keyboard handler — Delete + Ctrl+Z
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      const inInput = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

      // Ctrl+Z / Cmd+Z — always works
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      // Delete/Backspace — only when not in input
      if (inInput) return;
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

  // Also listen globally for Ctrl+Z when canvas is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        // Only if focus is within the canvas wrapper
        if (reactFlowWrapper.current?.contains(document.activeElement)) {
          e.preventDefault();
          undo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

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
      if (isDragging.current) return;
      if (resizeDebounce.current) clearTimeout(resizeDebounce.current);
      resizeDebounce.current = setTimeout(() => {
        if (isDragging.current) return;
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
      className="relative h-[calc(100vh-var(--nav-height))] w-full"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <Sidebar onAddPosition={() => {}} highlightType={connectionHint?.highlightType} />

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

      {/* Top-right buttons */}
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        <button
          onClick={() => {
            const viewport = document.querySelector(".react-flow__viewport") as HTMLElement;
            if (!viewport || nodes.length === 0) return;

            const nodesBounds = getNodesBounds(nodes);
            const padding = 80;
            const width = nodesBounds.width + padding * 2;
            const height = nodesBounds.height + padding * 2;
            const transform = getViewportForBounds(nodesBounds, width, height, 0.5, 2, padding);

            toPng(viewport, {
              backgroundColor: "#15181a",
              width,
              height,
              pixelRatio: 3,
              skipFonts: true,
              imagePlaceholder: "",
              filter: (node) => {
                // Skip minimap and controls from the export
                if (node?.classList?.contains("react-flow__minimap")) return false;
                if (node?.classList?.contains("react-flow__controls")) return false;
                return true;
              },
              style: {
                width: `${width}px`,
                height: `${height}px`,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
              },
            }).then((dataUrl) => {
              const a = document.createElement("a");
              a.download = "morpheus-strategy.png";
              a.href = dataUrl;
              a.click();
            }).catch(() => {
              // Fallback: try without images
              toPng(viewport, {
                backgroundColor: "#15181a",
                width,
                height,
                pixelRatio: 2,
                skipFonts: true,
                filter: (node) => {
                  if (node?.classList?.contains("react-flow__minimap")) return false;
                  if (node?.classList?.contains("react-flow__controls")) return false;
                  if (node instanceof HTMLImageElement) return false;
                  return true;
                },
                style: {
                  width: `${width}px`,
                  height: `${height}px`,
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
                },
              }).then((dataUrl) => {
                const a = document.createElement("a");
                a.download = "morpheus-strategy.png";
                a.href = dataUrl;
                a.click();
              });
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
