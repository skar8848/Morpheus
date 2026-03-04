"use client";

import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { COLLATERAL_ASSETS } from "@/lib/constants/assets";
import type { SupportedChainId } from "@/lib/web3/chains";
import { useCowQuote } from "@/lib/hooks/useCowQuote";
import type { SwapNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function SwapNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as SwapNodeData;
  const assets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];

  const isMainnet = chainId === 1;

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.address, label: a.symbol })),
    [assets]
  );

  // CowSwap quote
  const { quote, loading: quoteLoading } = useCowQuote({
    tokenIn: d.tokenIn?.address,
    tokenOut: d.tokenOut?.address,
    amountIn: d.amountIn,
    decimalsIn: d.tokenIn?.decimals ?? 18,
    decimalsOut: d.tokenOut?.decimals ?? 18,
    enabled: isMainnet && !!d.tokenIn && !!d.tokenOut && parseFloat(d.amountIn || "0") > 0,
  });

  return (
    <NodeShell
      nodeType="swap"
      title="Swap (CowSwap)"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <div className="space-y-2">
        {!isMainnet && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            CowSwap — Ethereum mainnet only
          </div>
        )}

        {/* Token In */}
        <div>
          <label className="text-[10px] text-text-tertiary">From</label>
          <SearchSelect
            options={assetOptions}
            value={d.tokenIn?.address ?? ""}
            onChange={(addr) => {
              const token = assets.find((a) => a.address === addr) ?? null;
              updateNodeData(id, { tokenIn: token });
            }}
            placeholder="Search token..."
          />
        </div>

        {/* Amount In */}
        <div className="nodrag">
          <label className="text-[10px] text-text-tertiary">Amount</label>
          <input
            type="number"
            placeholder="0.00"
            className="mt-0.5 w-full rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            value={d.amountIn}
            onChange={(e) => updateNodeData(id, { amountIn: e.target.value })}
          />
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M8 13l3-3M8 13l-3-3"
              stroke="var(--text-tertiary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Token Out */}
        <div>
          <label className="text-[10px] text-text-tertiary">To</label>
          <SearchSelect
            options={assetOptions}
            value={d.tokenOut?.address ?? ""}
            onChange={(addr) => {
              const token = assets.find((a) => a.address === addr) ?? null;
              updateNodeData(id, { tokenOut: token });
            }}
            placeholder="Search token..."
          />
        </div>

        {/* Quote display */}
        {isMainnet && d.tokenIn && d.tokenOut && parseFloat(d.amountIn || "0") > 0 && (
          <div className="rounded-lg bg-bg-secondary px-2 py-1.5">
            <span className="text-[10px] text-text-tertiary">Estimated output</span>
            {quoteLoading ? (
              <div className="mt-0.5 h-4 animate-pulse rounded bg-bg-primary" />
            ) : quote ? (
              <div className="flex items-center gap-1.5">
                <Image
                  src={d.tokenOut.logoURI}
                  alt={d.tokenOut.symbol}
                  width={14}
                  height={14}
                  className="rounded-full"
                  unoptimized
                />
                <span className="text-xs font-medium text-text-primary">
                  {quote} {d.tokenOut.symbol}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary">No quote available</p>
            )}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-yellow-400 !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-yellow-400 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(SwapNodeComponent);
