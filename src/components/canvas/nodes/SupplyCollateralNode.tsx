"use client";

import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { COLLATERAL_ASSETS } from "@/lib/constants/assets";
import type { SupportedChainId } from "@/lib/web3/chains";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import type { SupplyCollateralNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function SupplyCollateralNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const assets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];
  const d = data as unknown as SupplyCollateralNodeData;

  // Fetch real prices from Morpho API
  const allAddresses = useMemo(() => assets.map((a) => a.address), [assets]);
  const { prices } = useAssetPrices(allAddresses);

  // Fetch wallet balances
  const selectedAssets = useMemo(() => (d.asset ? [d.asset] : []), [d.asset]);
  const { assetsWithBalances } = useTokenBalances(selectedAssets);
  const walletBalance = assetsWithBalances[0]?.balance ?? "0";

  const priceUsd = d.asset
    ? prices[d.asset.address.toLowerCase()] ?? 0
    : 0;
  const amountUsd = parseFloat(d.amount || "0") * priceUsd;

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.address, label: a.symbol })),
    [assets]
  );

  return (
    <NodeShell
      nodeType="supplyCollateral"
      title="Supply Collateral"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <div className="space-y-2">
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

        {/* Amount input with USD inline */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">Amount</label>
            {d.asset && walletBalance !== "0" && (
              <button
                type="button"
                onClick={() =>
                  updateNodeData(id, {
                    amount: walletBalance,
                    amountUsd: parseFloat(walletBalance) * priceUsd,
                  })
                }
                className="text-[9px] text-text-tertiary hover:text-brand transition-colors"
              >
                Bal: {walletBalance} {d.asset.symbol}
              </button>
            )}
          </div>
          <div className="nodrag relative mt-0.5 flex items-center rounded-lg border border-border bg-bg-secondary">
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
