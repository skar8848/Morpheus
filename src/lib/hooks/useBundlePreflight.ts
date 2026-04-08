// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useEffect, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import {
  runPreflight,
  EMPTY_PREFLIGHT,
  type PreflightResult,
} from "@/lib/canvas/preflight";
import type { CanvasNode } from "@/lib/canvas/types";

const DEBOUNCE_MS = 600;

/**
 * Run preflight on the current strategy whenever it changes.
 * Debounced so rapid edits don't spam estimateGas.
 *
 * Pass `enabled = false` (e.g., when the panel is collapsed) to skip work entirely.
 */
export function useBundlePreflight(
  nodes: CanvasNode[],
  edges: Edge[],
  enabled: boolean
): PreflightResult {
  const { address } = useAccount();
  const { chainId } = useChain();
  const [result, setResult] = useState<PreflightResult>(EMPTY_PREFLIGHT);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setResult(EMPTY_PREFLIGHT);
      return;
    }

    setResult((prev) => ({ ...prev, loading: true }));

    const id = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const next = await runPreflight(nodes, edges, address, chainId);
        // Drop stale results
        if (id !== requestIdRef.current) return;
        setResult(next);
      } catch (err) {
        if (id !== requestIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setResult({
          ...EMPTY_PREFLIGHT,
          errors: [`Preflight crashed: ${msg}`],
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nodes, edges, address, chainId]);

  return result;
}
