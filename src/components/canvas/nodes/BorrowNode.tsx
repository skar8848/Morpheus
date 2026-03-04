"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useLoanAssets } from "@/lib/hooks/useLoanAssets";
import { useAssetPrices } from "@/lib/hooks/useAssetPrices";
import { formatApy, formatLltv } from "@/lib/utils/format";
import type { BorrowNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

function BorrowNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as BorrowNodeData;
  const edges = useEdges();
  const nodes = useNodes();

  // Find the collateral asset + amount from connected SupplyCollateral node
  const { connectedCollateralAddress, connectedAmount } = useMemo(() => {
    const incomingEdge = edges.find((e) => e.target === id);
    if (!incomingEdge) return { connectedCollateralAddress: null, connectedAmount: 0 };

    const sourceNode = nodes.find((n) => n.id === incomingEdge.source);
    if (!sourceNode) return { connectedCollateralAddress: null, connectedAmount: 0 };

    const sd = sourceNode.data as {
      type?: string;
      asset?: { address: string } | null;
      amount?: string;
    };
    if (sd.type === "supplyCollateral" && sd.asset) {
      return {
        connectedCollateralAddress: sd.asset.address,
        connectedAmount: parseFloat(sd.amount || "0"),
      };
    }
    return { connectedCollateralAddress: null, connectedAmount: 0 };
  }, [edges, nodes, id]);

  // Fetch real price for the connected collateral asset
  const priceAddresses = useMemo(
    () => (connectedCollateralAddress ? [connectedCollateralAddress] : []),
    [connectedCollateralAddress]
  );
  const { prices } = useAssetPrices(priceAddresses);
  const collateralPrice = connectedCollateralAddress
    ? prices[connectedCollateralAddress.toLowerCase()] ?? 0
    : 0;
  const connectedAmountUsd = connectedAmount * collateralPrice;

  // Auto-sync collateral USD from connected supply node
  useEffect(() => {
    if (connectedAmountUsd > 0 && connectedAmountUsd !== d.depositAmountUsd) {
      updateNodeData(id, { depositAmountUsd: connectedAmountUsd });
    }
  }, [connectedAmountUsd]);

  // Reset borrow selections when collateral asset changes
  const prevCollateralRef = useRef(connectedCollateralAddress);
  useEffect(() => {
    if (
      prevCollateralRef.current !== null &&
      connectedCollateralAddress !== prevCollateralRef.current
    ) {
      updateNodeData(id, {
        loanAssetAddress: undefined,
        market: null,
        borrowAmount: 0,
        borrowAmountUsd: 0,
        healthFactor: null,
        ltvPercent: 50,
      });
    }
    prevCollateralRef.current = connectedCollateralAddress;
  }, [connectedCollateralAddress]);

  // Fetch loan assets for this collateral
  const collateralAddresses = useMemo(
    () => (connectedCollateralAddress ? [connectedCollateralAddress] : []),
    [connectedCollateralAddress]
  );
  const { loanAssets, loading: loanAssetsLoading } = useLoanAssets(collateralAddresses);

  const selectedLoanAddress = (d as unknown as { loanAssetAddress?: string }).loanAssetAddress;

  // Fetch markets filtered by collateral + loan asset
  const loanAddresses = useMemo(
    () => (selectedLoanAddress ? [selectedLoanAddress] : []),
    [selectedLoanAddress]
  );
  const { markets, loading: marketsLoading } = useMarkets(collateralAddresses, loanAddresses);

  // Compute borrow amount + HF reactively from LTV
  const depositUsd = d.depositAmountUsd || connectedAmountUsd;
  useEffect(() => {
    if (!d.market || depositUsd <= 0) {
      if (d.borrowAmount !== 0) {
        updateNodeData(id, { borrowAmount: 0, borrowAmountUsd: 0, healthFactor: null });
      }
      return;
    }

    const lltv = Number(d.market.lltv) / 1e18;
    const maxBorrow = depositUsd * lltv;
    const targetBorrow = (depositUsd * d.ltvPercent) / 100;
    const borrowAmount = Math.min(targetBorrow, maxBorrow * 0.99);
    const hf = borrowAmount > 0 ? (depositUsd * lltv) / borrowAmount : null;

    updateNodeData(id, {
      borrowAmount,
      borrowAmountUsd: borrowAmount,
      healthFactor: hf,
    });
  }, [d.market?.uniqueKey, d.ltvPercent, depositUsd]);

  const hfColor = (hf: number | null) => {
    if (hf === null) return "text-text-tertiary";
    if (hf > 2) return "text-success";
    if (hf > 1.2) return "text-yellow-400";
    return "text-error";
  };

  // SearchSelect options
  const loanOptions = useMemo(
    () => loanAssets.map((a) => ({ value: a.address, label: a.symbol })),
    [loanAssets]
  );
  const marketOptions = useMemo(
    () =>
      markets.map((m) => ({
        value: m.uniqueKey,
        label: `${m.collateralAsset.symbol}/${m.loanAsset.symbol} — LLTV ${formatLltv(m.lltv)} — ${formatApy(m.state.netBorrowApy)}`,
      })),
    [markets]
  );

  return (
    <NodeShell
      nodeType="borrow"
      title="Borrow"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
    >
      <div className="space-y-2">
        {/* No connection hint */}
        {!connectedCollateralAddress && (
          <div className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[10px] text-text-tertiary">
            Connect a Supply Collateral node to see available markets
          </div>
        )}

        {/* Step 1: Pick loan asset */}
        {connectedCollateralAddress && (
          <div>
            <label className="text-[10px] text-text-tertiary">Borrow Asset</label>
            {loanAssetsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={loanOptions}
                value={selectedLoanAddress ?? ""}
                onChange={(v) => updateNodeData(id, { loanAssetAddress: v, market: null })}
                placeholder="Search asset..."
              />
            )}
          </div>
        )}

        {/* Step 2: Pick market */}
        {selectedLoanAddress && (
          <div>
            <label className="text-[10px] text-text-tertiary">Market</label>
            {marketsLoading ? (
              <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
            ) : (
              <SearchSelect
                options={marketOptions}
                value={d.market?.uniqueKey ?? ""}
                onChange={(v) => {
                  const market = markets.find((m) => m.uniqueKey === v) ?? null;
                  updateNodeData(id, { market });
                }}
                placeholder="Search market..."
              />
            )}
          </div>
        )}

        {/* Selected market info + slider */}
        {d.market && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-bg-secondary px-2 py-1.5">
              <div className="relative flex items-center">
                <Image
                  src={d.market.collateralAsset.logoURI}
                  alt={d.market.collateralAsset.symbol}
                  width={14}
                  height={14}
                  className="rounded-full"
                  unoptimized
                />
                <Image
                  src={d.market.loanAsset.logoURI}
                  alt={d.market.loanAsset.symbol}
                  width={14}
                  height={14}
                  className="-ml-1.5 rounded-full ring-1 ring-bg-card"
                  unoptimized
                />
              </div>
              <span className="text-xs text-text-primary">
                {d.market.collateralAsset.symbol}/{d.market.loanAsset.symbol}
              </span>
              <span className="ml-auto text-[10px] text-success">
                {formatApy(d.market.state.netBorrowApy)}
              </span>
            </div>

            {/* Collateral value (auto-filled from supply) */}
            <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
              <span className="text-[10px] text-text-tertiary">Collateral</span>
              <span className="text-xs font-medium text-text-primary">
                ${depositUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* LTV slider — nodrag prevents node dragging */}
            <div className="nodrag">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-text-tertiary">Target LTV</label>
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min={0}
                    max={Math.floor((Number(d.market.lltv) / 1e18) * 100)}
                    value={d.ltvPercent}
                    onChange={(e) => {
                      const max = Math.floor((Number(d.market!.lltv) / 1e18) * 100);
                      const val = Math.max(0, Math.min(max, parseInt(e.target.value) || 0));
                      updateNodeData(id, { ltvPercent: val });
                    }}
                    className="w-10 rounded bg-bg-secondary px-1 py-0.5 text-right text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-text-tertiary">%</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.floor((Number(d.market.lltv) / 1e18) * 100)}
                value={d.ltvPercent}
                onChange={(e) =>
                  updateNodeData(id, { ltvPercent: parseInt(e.target.value) })
                }
                className="mt-1 w-full accent-brand"
              />
              <div className="flex justify-between text-[9px] text-text-tertiary">
                <span>0%</span>
                <span>LLTV {formatLltv(d.market.lltv)}</span>
              </div>
            </div>

            {/* Borrow amount + HF */}
            <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-2 py-1.5">
              <div>
                <span className="text-[10px] text-text-tertiary">Borrow</span>
                <p className="text-xs font-medium text-text-primary">
                  ${d.borrowAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-text-tertiary">HF</span>
                <p className={`text-xs font-semibold ${hfColor(d.healthFactor)}`}>
                  {d.healthFactor ? d.healthFactor.toFixed(2) : "—"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-success !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-success !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(BorrowNodeComponent);
