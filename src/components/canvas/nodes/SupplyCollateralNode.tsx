"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { COLLATERAL_ASSETS } from "@/lib/constants/assets";
import type { SupportedChainId } from "@/lib/web3/chains";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import type { SupplyCollateralNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

interface UpstreamInput {
  nodeId: string;
  label: string;
  amount: number;
  type: "wallet" | "swap" | "vaultWithdraw";
}

function SupplyCollateralNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const assets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];
  const d = data as unknown as SupplyCollateralNodeData;
  const edges = useEdges();
  const allNodes = useNodes();

  // Detect ALL upstream inputs
  const { upstreamInputs, suggestedAsset } = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    type AssetInfo = { address: string; symbol: string; logoURI: string; decimals: number; name: string };
    const inputs: UpstreamInput[] = [];
    let suggested: AssetInfo | null = null;

    for (const edge of incomingEdges) {
      const sourceNode = allNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const sd = sourceNode.data as Record<string, unknown>;

      if (sd.type === "swap") {
        const tokenOut = sd.tokenOut as AssetInfo | null;
        const quoteOut = parseFloat((sd.quoteOut as string) || "0");
        if (tokenOut) {
          suggested = tokenOut;
          inputs.push({
            nodeId: sourceNode.id,
            label: `Swap → ${tokenOut.symbol}`,
            amount: quoteOut,
            type: "swap",
          });
        }
      } else if (sd.type === "vaultWithdraw") {
        const position = sd.position as { vault: { asset: AssetInfo; name: string } } | null;
        const amt = parseFloat((sd.amount as string) || "0");
        if (position?.vault.asset) {
          suggested = position.vault.asset;
          inputs.push({
            nodeId: sourceNode.id,
            label: `Withdraw ${position.vault.name}`,
            amount: amt,
            type: "vaultWithdraw",
          });
        }
      } else if (sd.type === "wallet") {
        // Wallet balance computed below via useTokenBalances
        inputs.push({
          nodeId: sourceNode.id,
          label: "Wallet",
          amount: 0, // filled below
          type: "wallet",
        });
      }
    }

    return { upstreamInputs: inputs, suggestedAsset: suggested };
  }, [edges, allNodes, id]);

  // Auto-select asset from upstream
  const prevSuggestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!suggestedAsset) {
      prevSuggestedRef.current = null;
      return;
    }
    const addr = suggestedAsset.address.toLowerCase();
    if (addr !== prevSuggestedRef.current) {
      prevSuggestedRef.current = addr;
      const match = assets.find((a) => a.address.toLowerCase() === addr);
      updateNodeData(id, { asset: match ?? suggestedAsset });
    }
  }, [suggestedAsset]);

  // Fetch real prices from Morpho API
  const allAddresses = useMemo(() => assets.map((a) => a.address), [assets]);
  const { prices } = useAssetPrices(allAddresses);

  // Fetch wallet balance for selected asset
  const selectedAssets = useMemo(() => (d.asset ? [d.asset] : []), [d.asset]);
  const { assetsWithBalances } = useTokenBalances(selectedAssets);
  const walletBalance = parseFloat(assetsWithBalances[0]?.balance ?? "0");

  // Fill wallet input amounts + compute total
  const hasWalletInput = upstreamInputs.some((i) => i.type === "wallet");
  const inputsWithBalances = upstreamInputs.map((i) =>
    i.type === "wallet" ? { ...i, amount: walletBalance } : i
  );
  // If no upstream edges at all but user has wallet balance, show it
  const totalFromUpstream = inputsWithBalances.reduce((sum, i) => sum + i.amount, 0);
  const totalAvailable = upstreamInputs.length === 0 ? walletBalance : totalFromUpstream;

  const priceUsd = d.asset
    ? prices[d.asset.address.toLowerCase()] ?? 0
    : 0;
  const currentAmount = parseFloat(d.amount || "0");
  const amountUsd = currentAmount * priceUsd;
  const exceedsBalance = currentAmount > 0 && (
    totalAvailable > 0 ? currentAmount > totalAvailable : hasWalletInput
  );

  // Check if upstream asset has no collateral markets on this chain
  const upstreamNotSupported = useMemo(() => {
    if (!suggestedAsset) return null;
    const match = assets.find((a) => a.address.toLowerCase() === suggestedAsset.address.toLowerCase());
    if (match) return null;
    return suggestedAsset;
  }, [suggestedAsset, assets]);

  // Persist states for edge rendering
  const prevExceedsRef = useRef(false);
  const prevIncompleteRef = useRef(false);
  useEffect(() => {
    if (exceedsBalance !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsBalance;
      updateNodeData(id, { exceedsBalance });
    }
  }, [exceedsBalance]);
  useEffect(() => {
    const incomplete = !!upstreamNotSupported;
    if (incomplete !== prevIncompleteRef.current) {
      prevIncompleteRef.current = incomplete;
      updateNodeData(id, { incomplete });
    }
  }, [upstreamNotSupported]);

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    [assets]
  );

  return (
    <NodeShell
      nodeType="supplyCollateral"
      title="Supply Collateral"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsBalance}
    >
      <div className="space-y-2">
        {/* Warning: upstream asset not supported as collateral */}
        {upstreamNotSupported && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            {upstreamNotSupported.symbol} has no collateral markets on this chain
          </div>
        )}

        {/* Asset selector */}
        <div>
          <label className="text-[10px] text-text-tertiary">Asset</label>
          <SearchSelect
            options={assetOptions}
            value={d.asset?.address ?? ""}
            onChange={(addr) => {
              const asset = assets.find((a) => a.address === addr) ?? null;
              updateNodeData(id, { asset });
            }}
            placeholder="Search asset..."
          />
        </div>

        {/* Multi-input sources breakdown */}
        {d.asset && inputsWithBalances.length > 1 && (
          <div className="space-y-0.5 rounded-lg bg-bg-secondary px-2 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">Sources</span>
            {inputsWithBalances.map((input) => (
              <div key={input.nodeId} className="flex items-center justify-between">
                <span className="text-[10px] text-text-tertiary">{input.label}</span>
                <span className="text-[10px] text-text-secondary">
                  {input.amount.toFixed(4)} {d.asset?.symbol}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-0.5">
              <span className="text-[10px] font-medium text-text-tertiary">Total</span>
              <span className="text-[10px] font-medium text-text-primary">
                {totalAvailable.toFixed(4)} {d.asset?.symbol}
              </span>
            </div>
          </div>
        )}

        {/* Wallet balance indicator */}
        {d.asset && (hasWalletInput || upstreamInputs.length === 0) && (
          <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1">
            <span className="text-[10px] text-text-tertiary">Wallet</span>
            <span className="text-[10px] text-text-secondary">
              {walletBalance.toFixed(4)} {d.asset.symbol}
            </span>
          </div>
        )}

        {/* Amount input with USD inline + slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">Amount</label>
            {d.asset && totalAvailable > 0 && (
              <button
                type="button"
                onClick={() =>
                  updateNodeData(id, {
                    amount: totalAvailable.toFixed(6),
                    amountUsd: totalAvailable * priceUsd,
                  })
                }
                className="text-[9px] text-text-tertiary hover:text-brand transition-colors"
              >
                MAX
              </button>
            )}
          </div>
          <div className={`nodrag relative flex items-center rounded-lg border bg-bg-secondary ${
            exceedsBalance ? "border-error" : "border-border"
          }`}>
            <input
              type="number"
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={d.amount}
              onChange={(e) =>
                updateNodeData(id, {
                  amount: e.target.value,
                  amountUsd: parseFloat(e.target.value || "0") * priceUsd,
                })
              }
            />
            {amountUsd > 0 && (
              <span className="pointer-events-none shrink-0 pr-2 text-[10px] text-text-tertiary">
                ~${amountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          {exceedsBalance && (
            <p className="text-[10px] text-error">
              Exceeds available balance ({totalAvailable.toFixed(4)} {d.asset?.symbol ?? ""})
            </p>
          )}
          {d.asset && totalAvailable > 0 && (
            <div className="nodrag">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.min(100, totalAvailable > 0 ? Math.round((currentAmount / totalAvailable) * 100) : 0)}
                onChange={(e) => {
                  const p = parseInt(e.target.value);
                  const amt = (totalAvailable * p) / 100;
                  updateNodeData(id, {
                    amount: amt.toFixed(6),
                    amountUsd: amt * priceUsd,
                  });
                }}
                className="w-full accent-brand"
              />
              <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                <span className="text-[10px] text-text-tertiary">
                  {currentAmount.toFixed(4)} {d.asset.symbol}
                </span>
                <span className="text-[10px] text-text-tertiary">
                  of {totalAvailable.toFixed(4)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Selected asset preview */}
        {d.asset && (
          <div className="flex items-center gap-2 rounded-lg bg-bg-secondary px-2 py-1.5">
            <Image
              src={d.asset.logoURI}
              alt={d.asset.symbol}
              width={16}
              height={16}
              className="rounded-full"
              unoptimized
            />
            <span className="text-xs font-medium text-text-primary">
              {d.asset.symbol}
            </span>
            {priceUsd > 0 && (
              <span className="ml-auto text-[10px] text-text-tertiary">
                ${priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        )}
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

export default memo(SupplyCollateralNodeComponent);
