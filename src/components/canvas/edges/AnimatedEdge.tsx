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

/** Walk upstream from a node and return true if it or any ancestor has a blocking error */
function isUpstreamBlocked(
  nodeId: string,
  nodesMap: Map<string, Record<string, unknown>>,
  edgesMap: Map<string, string[]>, // target → source[]
  visited = new Set<string>()
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const data = nodesMap.get(nodeId);
  if (data?.exceedsBalance || data?.exceedsLiquidity || data?.incomplete) return true;
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

  // Compute flow label from source node data
  const flowLabel = (() => {
    const nodesMap = new Map<string, Record<string, unknown>>();
    for (const n of allNodes) nodesMap.set(n.id, n.data as Record<string, unknown>);
    const srcData = nodesMap.get(source);
    if (!srcData) return null;
    const type = srcData.type as string;
    const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    switch (type) {
      case "supplyCollateral": {
        const asset = srcData.asset as { symbol?: string } | null;
        const amount = parseFloat(srcData.amount as string);
        if (!asset?.symbol || !isFinite(amount) || amount <= 0) return null;
        return `${fmt(amount)} ${asset.symbol}`;
      }
      case "borrow": {
        const market = srcData.market as { loanAsset?: { symbol?: string } } | null;
        const amount = srcData.borrowAmount as number;
        if (!market?.loanAsset?.symbol || !isFinite(amount) || amount <= 0) return null;
        return `${fmt(amount)} ${market.loanAsset.symbol}`;
      }
      case "swap": {
        const tokenOut = srcData.tokenOut as { symbol?: string } | null;
        const quoteOut = parseFloat(srcData.quoteOut as string);
        if (!tokenOut?.symbol || !isFinite(quoteOut) || quoteOut <= 0) return null;
        return `${fmt(quoteOut)} ${tokenOut.symbol}`;
      }
      case "vaultWithdraw": {
        const pos = srcData.position as { vault?: { asset?: { symbol?: string } } } | null;
        const amount = parseFloat(srcData.amount as string);
        if (!pos?.vault?.asset?.symbol || !isFinite(amount) || amount <= 0) return null;
        return `${fmt(amount)} ${pos.vault.asset.symbol}`;
      }
      case "repay": {
        const market = srcData.market as { loanAsset?: { symbol?: string } } | null;
        const amount = parseFloat(srcData.amount as string);
        if (!market?.loanAsset?.symbol || !isFinite(amount) || amount <= 0) return null;
        return `${fmt(amount)} ${market.loanAsset.symbol}`;
      }
      default:
        return null;
    }
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
      {/* Flow label + delete button */}
      <EdgeLabelRenderer>
        {/* Flow amount label — always visible */}
        {flowLabel && !hovered && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 14}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <span
              className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm transition-opacity ${
                blocked
                  ? "bg-bg-secondary/80 text-text-tertiary"
                  : "bg-bg-card/90 text-text-secondary border border-border/50"
              }`}
            >
              {flowLabel}
            </span>
          </div>
        )}
        {/* Delete button — on hover */}
        {hovered && (
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
            <div className="flex flex-col items-center gap-1">
              {flowLabel && (
                <span className="rounded-md border border-border/50 bg-bg-card/90 px-1.5 py-0.5 text-[9px] font-medium text-text-secondary backdrop-blur-sm">
                  {flowLabel}
                </span>
              )}
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
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(AnimatedEdgeComponent);
