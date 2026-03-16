// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import type { EdgeTypes } from "@xyflow/react";
import AnimatedEdge from "./AnimatedEdge";

// MUST be defined outside any component to avoid React Flow re-renders
export const edgeTypes: EdgeTypes = {
  animatedEdge: AnimatedEdge,
};