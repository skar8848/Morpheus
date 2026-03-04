import type { EdgeTypes } from "@xyflow/react";
import AnimatedEdge from "./AnimatedEdge";

// MUST be defined outside any component to avoid React Flow re-renders
export const edgeTypes: EdgeTypes = {
  animatedEdge: AnimatedEdge,
};
