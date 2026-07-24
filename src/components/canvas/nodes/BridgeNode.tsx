// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useEffect, useMemo } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useAllAssets } from "@/lib/hooks/useAllAssets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useBridgeQuote } from "@/lib/hooks/useBridgeQuote";
import { CHAIN_CONFIGS, type SupportedChainId } from "@/lib/web3/chains";
import { resolveBridgeRoute } from "@/lib/canvas/bridge";
import { formatUsd } from "@/lib/utils/format";
import type { BridgeNodeData } from "@/lib/canvas/types";
import type { Asset } from "@/lib/graphql/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function BridgeNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId: homeChainId } = useChain();
  const d = data as unknown as BridgeNodeData;
  const edges = useEdges();
  const allNodes = useNodes();

  const srcChainId = (d.srcChainId ?? homeChainId) as SupportedChainId;

  // Detect the upstream asset + amount feeding this bridge (source chain).
  const { upstreamAsset, upstreamAmount } = useMemo(() => {
    const incoming = edges.find((e) => e.target === id);
    if (!incoming) return { upstreamAsset: null as Asset | null, upstreamAmount: 0 };
    const src = allNodes.find((n) => n.id === incoming.source);
    if (!src) return { upstreamAsset: null as Asset | null, upstreamAmount: 0 };
    const sd = src.data as Record<string, unknown>;
    switch (sd.type) {
      case "borrow": {
        const m = sd.market as { loanAsset: Asset } | null;
        return { upstreamAsset: m?.loanAsset ?? null, upstreamAmount: (sd.borrowAmount as number) || 0 };
      }
      case "swap": {
        const t = sd.tokenOut as Asset | null;
        return { upstreamAsset: t ?? null, upstreamAmount: parseFloat((sd.quoteOut as string) || "0") };
      }
      case "vaultWithdraw": {
        const p = sd.position as { vault: { asset: Asset } } | null;
        return { upstreamAsset: p?.vault.asset ?? null, upstreamAmount: parseFloat((sd.amount as string) || "0") };
      }
      case "supplyCollateral": {
        return { upstreamAsset: (sd.asset as Asset) ?? null, upstreamAmount: parseFloat((sd.amount as string) || "0") };
      }
      default:
        return { upstreamAsset: null as Asset | null, upstreamAmount: 0 };
    }
  }, [edges, allNodes, id]);

  // Destination chains: any integrated chain other than the source.
  const dstOptions = useMemo(
    () =>
      CHAIN_CONFIGS.filter((c) => c.chainId !== srcChainId).map((c) => ({
        value: String(c.chainId),
        label: c.label,
      })),
    [srcChainId]
  );

  // Default the destination to the first non-source chain.
  useEffect(() => {
    if (!d.dstChainId || d.dstChainId === srcChainId) {
      const first = CHAIN_CONFIGS.find((c) => c.chainId !== srcChainId);
      if (first) updateNodeData(id, { srcChainId, dstChainId: first.chainId as SupportedChainId });
    } else if (d.srcChainId !== srcChainId) {
      updateNodeData(id, { srcChainId });
    }
  }, [srcChainId, d.dstChainId, d.srcChainId, id, updateNodeData]);

  const dstChainId = (d.dstChainId ?? srcChainId) as SupportedChainId;
  const { assets: dstAssets } = useAllAssets(dstChainId);

  // Keep tokenIn synced with the upstream asset.
  useEffect(() => {
    if (upstreamAsset && d.tokenIn?.address?.toLowerCase() !== upstreamAsset.address.toLowerCase()) {
      updateNodeData(id, { tokenIn: upstreamAsset, amountIn: String(upstreamAmount) });
    } else if (upstreamAmount && String(upstreamAmount) !== d.amountIn) {
      updateNodeData(id, { amountIn: String(upstreamAmount) });
    }
  }, [upstreamAsset, upstreamAmount, d.tokenIn, d.amountIn, id, updateNodeData]);

  const tokenOutOptions = useMemo(
    () => dstAssets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    [dstAssets]
  );

  const tokenIn = d.tokenIn ?? upstreamAsset;
  const route = useMemo(
    () => resolveBridgeRoute(tokenIn, d.tokenOut ?? null, srcChainId, dstChainId),
    [tokenIn, d.tokenOut, srcChainId, dstChainId]
  );

  // USD value of the input (source chain = home chain).
  const { prices } = useAssetPrices(tokenIn?.address ? [tokenIn.address] : []);
  const tokenInPrice = tokenIn?.address ? prices[tokenIn.address.toLowerCase()] ?? 0 : 0;
  const amountInUsd = upstreamAmount * tokenInPrice;

  // Live CCTP v2 quote from Circle's Iris fee schedule.
  const quote = useBridgeQuote(srcChainId, dstChainId, amountInUsd, route);

  // Persist the quote onto node data for later serialization / execution.
  useEffect(() => {
    const q = quote.receivedUsd > 0 ? String(quote.receivedUsd) : "";
    if (amountInUsd !== d.amountInUsd || q !== d.quoteOut || quote.loading !== d.quoteLoading) {
      updateNodeData(id, { amountInUsd, quoteOut: q, quoteLoading: quote.loading });
    }
  }, [amountInUsd, quote.receivedUsd, quote.loading, d.amountInUsd, d.quoteOut, d.quoteLoading, id, updateNodeData]);

  const srcLabel = CHAIN_CONFIGS.find((c) => c.chainId === srcChainId)?.label ?? `Chain ${srcChainId}`;

  const routeBadge =
    route.rail === "cctp-v2"
      ? { text: `CCTP v2 · Fast · ~${quote.etaFastSeconds}s`, cls: "text-success" }
      : route.rail === "stargate"
        ? { text: "Stargate", cls: "text-brand" }
        : { text: "Unsupported", cls: "text-error" };

  return (
    <NodeShell
      nodeType="bridge"
      title="Bridge"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={route.rail === "unsupported"}
    >
      <div className="space-y-2">
        {/* Route: source (fixed) → destination */}
        <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
          <span className="text-[10px] text-text-tertiary">{srcLabel}</span>
          <span className="text-text-tertiary">⇄</span>
          <div className="nodrag">
            <SearchSelect
              options={dstOptions}
              value={String(dstChainId)}
              onChange={(v) => updateNodeData(id, { dstChainId: Number(v) as SupportedChainId })}
              placeholder="Destination…"
            />
          </div>
        </div>

        {/* Input asset (from upstream) */}
        <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
          <span className="text-[10px] text-text-tertiary">In</span>
          {d.tokenIn || upstreamAsset ? (
            <span className="flex items-center gap-1.5 text-xs text-text-primary">
              {(d.tokenIn ?? upstreamAsset)?.logoURI && (
                <Image
                  src={(d.tokenIn ?? upstreamAsset)!.logoURI}
                  alt=""
                  width={14}
                  height={14}
                  className="rounded-full"
                  unoptimized
                />
              )}
              {upstreamAmount > 0 ? upstreamAmount.toLocaleString(undefined, { maximumFractionDigits: 4 }) : ""}{" "}
              {(d.tokenIn ?? upstreamAsset)?.symbol}
            </span>
          ) : (
            <span className="text-[10px] text-text-tertiary">Connect an input</span>
          )}
        </div>

        {/* Output asset on destination chain */}
        <div>
          <label className="text-[10px] text-text-tertiary">Receive on {CHAIN_CONFIGS.find((c) => c.chainId === dstChainId)?.label}</label>
          <div className="nodrag mt-0.5">
            <SearchSelect
              options={tokenOutOptions}
              value={d.tokenOut?.address ?? ""}
              onChange={(v) => {
                const t = dstAssets.find((a) => a.address === v) ?? null;
                updateNodeData(id, { tokenOut: t });
              }}
              placeholder="Search asset…"
            />
          </div>
        </div>

        {/* Route + estimate */}
        <div className="rounded-lg bg-bg-secondary px-2 py-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Route</span>
            <span className={`font-semibold ${routeBadge.cls}`}>{routeBadge.text}</span>
          </div>
          {route.rail === "cctp-v2" && amountInUsd > 0 && (
            <>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-text-tertiary">Bridge fee</span>
                <span className="text-text-secondary">
                  {quote.loading
                    ? "…"
                    : quote.fastFeeBps != null
                      ? `${quote.fastFeeBps} bps · ${formatUsd(quote.feeUsd)}`
                      : "—"}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-text-tertiary">Est. received</span>
                <span className="text-text-secondary">
                  {quote.loading ? "…" : `~${formatUsd(quote.receivedUsd)}`}
                  {d.tokenOut && !route.needsDstSwap ? ` ${d.tokenOut.symbol}` : ""}
                </span>
              </div>
              {quote.standardFeeBps === 0 && (
                <div className="mt-0.5 text-[9px] text-text-tertiary">
                  Standard transfer: free, ~{Math.round(quote.etaStandardSeconds / 60)} min
                </div>
              )}
              {quote.error && <div className="mt-0.5 text-[9px] text-error">Quote: {quote.error}</div>}
            </>
          )}
          {(route.needsSrcSwap || route.needsDstSwap) && route.rail === "cctp-v2" && (
            <div className="mt-0.5 text-[9px] text-yellow-400">
              Internal swap {route.needsSrcSwap ? "→USDC" : ""}{route.needsSrcSwap && route.needsDstSwap ? " / " : ""}{route.needsDstSwap ? "USDC→" : ""} (slippage applies)
            </div>
          )}
          {route.note && route.rail === "unsupported" && (
            <div className="mt-0.5 text-[9px] text-error">{route.note}</div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-brand !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-brand !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(BridgeNodeComponent);
