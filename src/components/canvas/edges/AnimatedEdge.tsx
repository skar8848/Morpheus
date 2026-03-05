"use client";

import { memo, useState, useCallback, useRef } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useNodes,
  useEdges,
  type EdgeProps,
} from "@xyflow/react";

/** Walk upstream from a node and return true if it or any ancestor has exceedsBalance or incomplete */
function isUpstreamBlocked(
  nodeId: string,
  nodesMap: Map<string, Record<string, unknown>>,
  edgesMap: Map<string, string[]>, // target → source[]
  visited = new Set<string>()
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const data = nodesMap.get(nodeId);
  if (data?.exceedsBalance || data?.incomplete) return true;
  const sources = edgesMap.get(nodeId) ?? [];
  return sources.some((src) => isUpstreamBlocked(src, nodesMap, edgesMap, visited));
}

function AnimatedEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const allNodes = useNodes();
  const allEdges = useEdges();
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<NodeJS.Timeout | null>(null);
  const lockedPos = useRef<{ x: number; y: number } | null>(null);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Check if this edge should be grayed:
  // - source or any ancestor has exceedsBalance/incomplete
  // - OR target node itself is incomplete (missing piece)
  const blocked = (() => {
    const nodesMap = new Map<string, Record<string, unknown>>();
    for (const n of allNodes) nodesMap.set(n.id, n.data as Record<string, unknown>);
    const edgesMap = new Map<string, string[]>();
    for (const e of allEdges) {
      const arr = edgesMap.get(e.target) ?? [];
      arr.push(e.source);
      edgesMap.set(e.target, arr);
    }
    // Check target node directly for incomplete
    const targetData = nodesMap.get(target);
    if (targetData?.incomplete) return true;
    return isUpstreamBlocked(source, nodesMap, edgesMap);
  })();

  const enter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setHovered(true);
  }, []);

  const leave = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      setHovered(false);
      lockedPos.current = null;
    }, 200);
  }, []);

  if (hovered && !lockedPos.current) {
    lockedPos.current = { x: labelX, y: labelY };
  }

  const btnX = lockedPos.current?.x ?? labelX;
  const btnY = lockedPos.current?.y ?? labelY;

  const edgeColor = blocked ? "var(--text-tertiary)" : hovered ? "var(--error)" : "var(--brand)";

  return (
    <>
      {/* Visible edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth: 2,
          strokeDasharray: "6 3",
          animation: blocked ? "none" : "dash-flow 1s linear infinite",
          transition: "stroke 0.15s ease",
          opacity: blocked ? 0.35 : 1,
          pointerEvents: "none",
        }}
      />
      {/* Glow layer */}
      {!blocked && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: hovered ? "var(--error)" : "var(--brand)",
            strokeWidth: 6,
            strokeOpacity: 0.15,
            filter: "blur(4px)",
            transition: "stroke 0.15s ease",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Fat hitbox for hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={40}
        onMouseEnter={enter}
        onMouseLeave={leave}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
      />
      {/* Delete button */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            onMouseEnter={enter}
            onMouseLeave={leave}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${btnX}px, ${btnY}px)`,
              pointerEvents: "all",
              padding: 8,
            }}
          >
            <button
              onClick={() => deleteElements({ edges: [{ id }] })}
              className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border border-error/40 bg-bg-card text-error shadow-lg transition-transform hover:scale-110"
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1L9 9M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(AnimatedEdgeComponent);
