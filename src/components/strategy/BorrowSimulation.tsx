"use client";

import { useMemo } from "react";
import Image from "next/image";
import type { Asset, AssetWithBalance, Market } from "@/lib/graphql/types";
import type { PerAssetLiquidation } from "@/lib/hooks/useStrategy";
import { formatLltv, formatUsd } from "@/lib/utils/format";

interface BorrowSimulationProps {
  selectedMarkets: Market[];
  selectedAssets: AssetWithBalance[];
  loanAsset: Asset;
  depositAmounts: Record<string, string>;
  targetLtvs: Record<string, number>;
  simulation: {
    borrowAmount: number;
    healthFactor: number;
    liquidationPrices: PerAssetLiquidation[];
  };
  onDepositChange: (address: string, amount: string) => void;
  onLtvChange: (address: string, ltv: number) => void;
}

export default function BorrowSimulation({
  selectedMarkets,
  selectedAssets,
  loanAsset,
  depositAmounts,
  targetLtvs,
  simulation,
  onDepositChange,
  onLtvChange,
}: BorrowSimulationProps) {
  // Map collateral address → market for LLTV lookup
  const marketByCollateral = useMemo(() => {
    const map = new Map<string, Market>();
    for (const m of selectedMarkets) {
      const key = m.collateralAsset.address.toLowerCase();
      if (!map.has(key)) map.set(key, m);
    }
    return map;
  }, [selectedMarkets]);

  const hfColor =
    simulation.healthFactor > 2
      ? "text-success"
      : simulation.healthFactor > 1.2
        ? "text-yellow-400"
        : "text-error";

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Borrow Simulation
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Set deposit amount and LTV per collateral asset
        </p>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6 space-y-5">
        {/* Per-asset: deposit input + LTV slider */}
        <div className="space-y-5">
          {selectedAssets.map((asset) => {
            const amount = depositAmounts[asset.address] ?? "";
            const walletBalance = asset.balanceRaw > 0n ? asset.balance : "0";
            const market = marketByCollateral.get(asset.address.toLowerCase());
            const maxLltv = market ? Math.round((Number(market.lltv) / 1e18) * 100) : 80;
            const assetLtv = targetLtvs[asset.address] ?? 50;
            const price = market?.collateralAsset.priceUsd ?? 0;
            const depositValue = (parseFloat(amount) || 0) * price;

            return (
              <div
                key={asset.address}
                className="rounded-xl border border-border bg-bg-secondary p-4 space-y-3"
              >
                {/* Header: asset name + balance */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Image
                      src={asset.logoURI}
                      alt={asset.symbol}
                      width={24}
                      height={24}
                      className="rounded-full"
                      unoptimized
                    />
                    <span className="text-sm font-medium text-text-primary">
                      {asset.symbol}
                    </span>
                    {market && (
                      <span className="text-[10px] text-text-tertiary">
                        LLTV {formatLltv(market.lltv)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onDepositChange(asset.address, walletBalance)}
                    className="text-xs text-brand hover:text-brand-hover transition-colors"
                  >
                    MAX ({parseFloat(walletBalance).toFixed(4)})
                  </button>
                </div>

                {/* Deposit input + USD value */}
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => onDepositChange(asset.address, e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="w-full rounded-xl border border-border bg-bg-card px-4 py-3 pr-28 text-text-primary outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
                    {depositValue > 0 ? formatUsd(depositValue) : "$0.00"}
                  </span>
                </div>

                {/* LTV slider */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-tertiary">
                      Target LTV
                    </span>
                    <span className="text-xs font-medium text-text-primary">
                      {Math.min(assetLtv, maxLltv)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={maxLltv}
                    value={Math.min(assetLtv, maxLltv)}
                    onChange={(e) => onLtvChange(asset.address, Number(e.target.value))}
                    className="w-full accent-brand"
                  />
                  <div className="flex justify-between text-[10px] text-text-tertiary mt-0.5">
                    <span>0%</span>
                    <span>{maxLltv}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-bg-secondary p-4 text-center">
            <p className="text-xs text-text-tertiary mb-1">Total Borrow</p>
            <p className="text-lg font-semibold text-text-primary">
              {simulation.borrowAmount > 0
                ? simulation.borrowAmount.toFixed(2)
                : "—"}
            </p>
            <p className="text-[10px] text-text-tertiary">{loanAsset.symbol}</p>
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary p-4 text-center">
            <p className="text-xs text-text-tertiary mb-1">Health Factor</p>
            <p className={`text-lg font-semibold ${hfColor}`}>
              {simulation.healthFactor > 0
                ? simulation.healthFactor.toFixed(2)
                : "—"}
            </p>
            <p className="text-[10px] text-text-tertiary">
              {simulation.healthFactor > 2
                ? "Safe"
                : simulation.healthFactor > 1.2
                  ? "Caution"
                  : simulation.healthFactor > 0
                    ? "Risky"
                    : "—"}
            </p>
          </div>
        </div>

        {/* Per-asset liquidation prices */}
        {simulation.liquidationPrices.length > 0 && (
          <div>
            <p className="text-xs text-text-tertiary mb-2">Liquidation Prices</p>
            <div className="space-y-2">
              {simulation.liquidationPrices.map((liq) => (
                <div
                  key={liq.address}
                  className="flex items-center justify-between rounded-xl border border-border bg-bg-secondary px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Image
                      src={liq.logoURI}
                      alt={liq.symbol}
                      width={20}
                      height={20}
                      className="rounded-full"
                      unoptimized
                    />
                    <span className="text-sm font-medium text-text-primary">
                      {liq.symbol}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[10px] text-text-tertiary">Current</p>
                      <p className="text-sm text-text-secondary">
                        {formatUsd(liq.currentPrice)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary">Liquidation</p>
                      <p className="text-sm font-semibold text-error">
                        {liq.liquidationPrice > 0 ? formatUsd(liq.liquidationPrice) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary">Buffer</p>
                      <p className={`text-sm font-medium ${liq.dropPercent > 30 ? "text-success" : liq.dropPercent > 15 ? "text-yellow-400" : "text-error"}`}>
                        {liq.dropPercent > 0 ? `-${liq.dropPercent.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
