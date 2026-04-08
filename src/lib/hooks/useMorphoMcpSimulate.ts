// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useEffect, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { buildExecutionBundle } from "@/lib/canvas/executor";
import type { CanvasNode } from "@/lib/canvas/types";
import type { SupportedChainId } from "@/lib/web3/chains";

const DEBOUNCE_MS = 1500;

/** Lightly typed shape of the Morpho MCP simulate-transactions response. */
export interface MorphoMcpSimulateResult {
  chain?: string;
  allSucceeded?: boolean;
  totalGasUsed?: string;
  executionResults?: Array<{
    transactionIndex?: number;
    success?: boolean;
    gasUsed?: string;
    revertReason?: string;
    logs?: Array<{
      contract?: string;
      eventName?: string;
      description?: string;
      formatted?: Record<string, unknown>;
    }>;
  }>;
  analysis?: {
    protocol?: string;
    operation?: string;
    market?: {
      marketId?: string;
      healthFactor?: string | number;
      liquidationRisk?: string;
      borrowAPYAfter?: string | number;
      utilizationAfter?: string | number;
    };
    vault?: {
      vaultAddress?: string;
      sharesAfter?: string;
      assetsAfter?: string;
      shareDelta?: string;
      assetDelta?: string;
      projectedApy?: string | number;
    };
    warnings?: Array<{ level?: string; message?: string; code?: string }>;
  };
  warnings?: Array<{ level?: string; message?: string; code?: string }>;
}

export interface UseMorphoMcpSimulateState {
  loading: boolean;
  result: MorphoMcpSimulateResult | null;
  error: string | null;
  /** True when the local executor failed to build a bundle (no MCP call attempted) */
  bundleBuildFailed: boolean;
}

const EMPTY: UseMorphoMcpSimulateState = {
  loading: false,
  result: null,
  error: null,
  bundleBuildFailed: false,
};

/**
 * Call the Morpho MCP simulate-transactions endpoint via the server proxy.
 * Debounced (1.5s) and only fires when `enabled` is true.
 */
export function useMorphoMcpSimulate(
  nodes: CanvasNode[],
  edges: Edge[],
  enabled: boolean
): UseMorphoMcpSimulateState {
  const { address } = useAccount();
  const { chainId, slug } = useChain();
  const [state, setState] = useState<UseMorphoMcpSimulateState>(EMPTY);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !address) {
      setState(EMPTY);
      return;
    }
    if (slug !== "ethereum" && slug !== "base") {
      setState({ ...EMPTY, error: `Morpho MCP unsupported chain: ${slug}` });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const id = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      // Build the bundle locally
      let bundle;
      try {
        bundle = buildExecutionBundle(
          nodes,
          edges,
          address,
          chainId as SupportedChainId
        );
      } catch (err) {
        if (id !== requestIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          loading: false,
          result: null,
          error: `Bundle build failed: ${msg.slice(0, 200)}`,
          bundleBuildFailed: true,
        });
        return;
      }

      if (bundle.calls.length === 0) {
        if (id !== requestIdRef.current) return;
        setState({ ...EMPTY });
        return;
      }

      // Forward to the proxy with the single multicall tx
      try {
        const res = await fetch("/api/morpho-simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chain: slug,
            from: address,
            transactions: [
              {
                to: bundle.to,
                data: bundle.data,
                value: "0",
                chainId: String(chainId),
              },
            ],
          }),
        });
        const data = await res.json();
        if (id !== requestIdRef.current) return;

        if (!res.ok || !data.ok) {
          setState({
            loading: false,
            result: null,
            error: data.error || `MCP request failed (${res.status})`,
            bundleBuildFailed: false,
          });
          return;
        }

        setState({
          loading: false,
          result: data.result as MorphoMcpSimulateResult,
          error: null,
          bundleBuildFailed: false,
        });
      } catch (err) {
        if (id !== requestIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          loading: false,
          result: null,
          error: `Network error: ${msg.slice(0, 200)}`,
          bundleBuildFailed: false,
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nodes, edges, address, chainId, slug]);

  return state;
}
