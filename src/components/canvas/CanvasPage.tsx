"use client";

import { useCallback, useRef, useEffect, type DragEvent } from "react";
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
import { isValidConnection } from "@/lib/canvas/validation";
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

  // Validate connection before allowing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionValidator = useCallback(
    (connection: any) => isValidConnection(connection, nodes as CanvasNode[]),
    [nodes]
  );

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
      <Sidebar onAddPosition={() => {}} />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
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
