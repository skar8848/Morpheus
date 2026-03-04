"use client";

import { useCallback, useRef, useEffect, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { useCanvasState } from "@/lib/canvas/useCanvasState";
import { isValidConnection, getConnectionHint } from "@/lib/canvas/validation";
import type { CanvasNode } from "@/lib/canvas/types";
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

      addNode(type, position);
    },
    [addNode]
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

      {/* Clear button */}
      <button
        onClick={clearGraph}
        className="absolute right-4 top-4 z-30 rounded-lg border border-border bg-bg-card/90 px-3 py-1.5 text-[10px] text-text-tertiary transition-colors hover:text-error"
      >
        Clear Canvas
      </button>
    </div>
  );
}
