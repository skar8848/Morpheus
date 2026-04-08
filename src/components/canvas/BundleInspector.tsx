// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo, useState } from "react";
import { decodeFunctionData, formatUnits } from "viem";
import type { Edge } from "@xyflow/react";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { buildExecutionBundle } from "@/lib/canvas/executor";
import { generalAdapterAbi } from "@/lib/constants/contracts";
import type { CanvasNode } from "@/lib/canvas/types";
import type { SupportedChainId } from "@/lib/web3/chains";

interface BundleInspectorProps {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface DecodedCall {
  index: number;
  to: string;
  functionName: string;
  args: unknown[];
  rawData: string;
  value: bigint;
  skipRevert: boolean;
  decodeError: string | null;
}

/** Truncate an address for display */
function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Render an arg value as a short string */
function renderArg(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") {
    // Show big numbers as scientific notation if very large
    if (value > 10n ** 20n) return `${formatUnits(value, 18)} (×10¹⁸)`;
    if (value > 10n ** 12n) return value.toString();
    return value.toString();
  }
  if (typeof value === "string") {
    if (value.startsWith("0x") && value.length >= 12) return shortAddr(value);
    return value;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") {
    // Tuple — show key/value compactly
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).slice(0, 3);
    return `{ ${entries.map(([k, v]) => `${k}: ${renderArg(v)}`).join(", ")}${Object.keys(obj).length > 3 ? ", …" : ""} }`;
  }
  return String(value);
}

export default function BundleInspector({ nodes, edges }: BundleInspectorProps) {
  const [open, setOpen] = useState(false);
  const { address } = useAccount();
  const { chainId } = useChain();
  const [copied, setCopied] = useState<number | null>(null);

  // Build the bundle to inspect — only when the panel is open to save work
  const decoded = useMemo<DecodedCall[]>(() => {
    if (!open || !address) return [];
    let bundle;
    try {
      bundle = buildExecutionBundle(nodes, edges, address, chainId as SupportedChainId);
    } catch {
      return [];
    }
    return bundle.calls.map((call, i) => {
      let functionName = "unknown";
      let args: unknown[] = [];
      let decodeError: string | null = null;
      try {
        const result = decodeFunctionData({
          abi: generalAdapterAbi,
          data: call.data,
        });
        functionName = result.functionName;
        args = result.args ? Array.from(result.args) : [];
      } catch (err) {
        decodeError = err instanceof Error ? err.message.slice(0, 80) : "decode failed";
      }
      return {
        index: i,
        to: call.to,
        functionName,
        args,
        rawData: call.data,
        value: call.value,
        skipRevert: call.skipRevert,
        decodeError,
      };
    });
  }, [open, nodes, edges, address, chainId]);

  const copyToClipboard = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignored — clipboard may be blocked */
    }
  };

  if (!nodes.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-secondary/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-secondary"
      >
        <span className="flex items-center gap-2">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`origin-center transition-transform ${open ? "" : "-rotate-90"}`}
            />
          </svg>
          Inspect raw bundler calls
        </span>
        {open && decoded.length > 0 && (
          <span className="font-mono normal-case tracking-normal text-text-tertiary">
            {decoded.length} call{decoded.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border px-2 py-2">
          {!address && (
            <p className="px-2 py-3 text-[10px] text-text-tertiary">
              Connect a wallet to build and inspect the bundle.
            </p>
          )}
          {address && decoded.length === 0 && (
            <p className="px-2 py-3 text-[10px] text-text-tertiary">
              No calls in the bundle yet — configure your nodes.
            </p>
          )}
          {decoded.map((call) => (
            <div
              key={call.index}
              className="mb-1 rounded-md border border-border bg-bg-card px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-sm bg-brand/10 px-1 py-0.5 text-[8px] font-bold tabular-nums text-brand">
                    #{call.index + 1}
                  </span>
                  <span className="truncate font-mono text-[10px] font-semibold text-text-primary">
                    {call.functionName}
                  </span>
                  <span className="hidden text-[9px] font-mono text-text-tertiary sm:inline">
                    → {shortAddr(call.to)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(call.rawData, call.index)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-brand"
                >
                  {copied === call.index ? "✓ copied" : "copy raw"}
                </button>
              </div>
              {call.decodeError ? (
                <p className="mt-1 font-mono text-[9px] text-error">
                  decode failed: {call.decodeError}
                </p>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {call.args.map((arg, argIdx) => (
                    <p
                      key={argIdx}
                      className="truncate font-mono text-[9px] text-text-tertiary"
                      title={typeof arg === "object" ? JSON.stringify(arg, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : String(arg)}
                    >
                      arg{argIdx}: <span className="text-text-secondary">{renderArg(arg)}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
