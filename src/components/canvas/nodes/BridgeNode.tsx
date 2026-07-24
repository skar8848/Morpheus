// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useEffect, useMemo } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useAllAssets } from "@/lib/hooks/useAllAssets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useBridgeRoutes } from "@/lib/hooks/useBridgeRoutes";
import { CHAIN_CONFIGS, type SupportedChainId } from "@/lib/web3/chains";
import ChainIcon from "../ChainIcon";
import { isUsdc } from "@/lib/canvas/bridge";
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
        iconNode: <ChainIcon chainId={c.chainId} />,
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

  // USD value of the input + price of the output token (for token-denominated
  // receive display).
  const priceAddrs = useMemo(
    () => [tokenIn?.address, d.tokenOut?.address].filter(Boolean) as string[],
    [tokenIn?.address, d.tokenOut?.address]
  );
  const { prices } = useAssetPrices(priceAddrs);
  const tokenInPrice = tokenIn?.address ? prices[tokenIn.address.toLowerCase()] ?? 0 : 0;
  const tokenOutPrice = d.tokenOut?.address ? prices[d.tokenOut.address.toLowerCase()] ?? 0 : 0;
  const amountInUsd = upstreamAmount * tokenInPrice;

  // Candidate routes, ranked best-first. CCTP is offered first for USDC but
  // never imposed — the user picks the route.
  const inIsUsdc = isUsdc(tokenIn, srcChainId);
  const outIsUsdc = isUsdc(d.tokenOut ?? null, dstChainId);
  const { routes, loading: routesLoading } = useBridgeRoutes(
    srcChainId,
    dstChainId,
    amountInUsd,
    inIsUsdc && (outIsUsdc || !d.tokenOut)
  );

  const selected = useMemo(
    () => routes.find((r) => r.id === d.routeId && !r.unavailable) ?? routes.find((r) => !r.unavailable) ?? null,
    [routes, d.routeId]
  );

  // Persist the chosen route + quote onto node data for serialization/execution.
  useEffect(() => {
    const q = selected && selected.receivedUsd > 0 ? String(selected.receivedUsd) : "";
    if (
      amountInUsd !== d.amountInUsd ||
      q !== d.quoteOut ||
      routesLoading !== d.quoteLoading ||
      (selected && selected.id !== d.routeId)
    ) {
      updateNodeData(id, {
        amountInUsd,
        quoteOut: q,
        quoteLoading: routesLoading,
        routeId: selected?.id,
      });
    }
  }, [amountInUsd, selected, routesLoading, d.amountInUsd, d.quoteOut, d.quoteLoading, d.routeId, id, updateNodeData]);

  const srcLabel = CHAIN_CONFIGS.find((c) => c.chainId === srcChainId)?.label ?? `Chain ${srcChainId}`;

  return (
    <NodeShell
      nodeType="bridge"
      title="Bridge (Stargate)"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={routes.length > 0 && !selected}
    >
      <div className="space-y-2">
        {/* Route: source (fixed) → destination */}
        <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
          <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
            <ChainIcon chainId={srcChainId} />
            {srcLabel}
          </span>
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

        {/* Routes — ranked best-first, pick one (Stargate-style comparison) */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">Routes</label>
            {routesLoading && <span className="text-[9px] text-text-tertiary">quoting…</span>}
          </div>
          <div className="nodrag mt-0.5 space-y-1">
            {routes.length === 0 && !routesLoading && (
              <p className="text-[9px] text-text-tertiary">Pick a destination chain and asset</p>
            )}
            {routes.map((r) => {
              const isSel = selected?.id === r.id;
              const tokenAmt =
                d.tokenOut && tokenOutPrice > 0 ? r.receivedUsd / tokenOutPrice : null;
              const eta =
                r.etaSeconds >= 60 ? `~${Math.round(r.etaSeconds / 60)} min` : `~${r.etaSeconds}s`;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!!r.unavailable}
                  onClick={() => updateNodeData(id, { routeId: r.id })}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    r.unavailable
                      ? "cursor-not-allowed border-border bg-bg-secondary/40 opacity-50"
                      : isSel
                        ? "border-brand/50 bg-brand/10"
                        : "border-border bg-bg-secondary hover:border-brand/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-text-primary">
                      {r.name}
                      {r.preferred && !r.unavailable && (
                        <span className="rounded bg-success/15 px-1 text-[8px] font-semibold text-success">
                          best for USDC
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-text-tertiary">{eta}</span>
                  </div>
                  {r.unavailable ? (
                    <div className="mt-0.5 text-[9px] text-text-tertiary">{r.unavailable}</div>
                  ) : (
                    <div className="mt-0.5 flex items-center justify-between text-[9px] text-text-tertiary">
                      <span className="text-text-secondary">
                        {tokenAmt != null && d.tokenOut
                          ? `~${tokenAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${d.tokenOut.symbol} (${formatUsd(r.receivedUsd)})`
                          : formatUsd(r.receivedUsd)}
                      </span>
                      <span>
                        fee {r.feeBps != null ? `${r.feeBps} bps · ` : ""}
                        {formatUsd(r.feeUsd)}
                        {r.gasUsd != null ? ` · gas ~${formatUsd(r.gasUsd)}` : ""}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
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
