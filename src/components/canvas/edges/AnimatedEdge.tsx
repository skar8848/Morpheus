"use client";

import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: "var(--brand)",
          strokeWidth: 2,
          strokeDasharray: "6 3",
          animation: "dash-flow 1s linear infinite",
        }}
      />
      {/* Glow layer */}
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          stroke: "var(--brand)",
          strokeWidth: 6,
          strokeOpacity: 0.15,
          filter: "blur(4px)",
        }}
      />
    </>
  );
}

export default memo(AnimatedEdgeComponent);
