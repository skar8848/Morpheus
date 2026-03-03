"use client";

import type { Asset, AssetWithBalance } from "@/lib/graphql/types";
import AssetStack from "./AssetStack";

interface CollateralSelectorProps {
  assets: Asset[];
  assetsWithBalances: AssetWithBalance[];
  selectedAssets: Asset[];
  onToggle: (asset: Asset) => void;
}

export default function CollateralSelector({
  assets,
  assetsWithBalances,
  selectedAssets,
  onToggle,
}: CollateralSelectorProps) {
  const selectedAddresses = selectedAssets.map((a) => a.address);

  // Find balance for a selected asset
  const getBalance = (address: string): string | null => {
    const found = assetsWithBalances.find(
      (a) => a.address.toLowerCase() === address.toLowerCase()
    );
    if (!found || found.balanceRaw === 0n) return null;
    return found.balance;
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            Your Assets
          </h2>
          <p className="mt-0.5 text-sm text-text-tertiary">
            Select collateral to deposit
          </p>
        </div>
        {selectedAssets.length > 0 && (
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
            {selectedAssets.length} selected
          </span>
        )}
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6">
        <AssetStack
          assets={assets}
          assetsWithBalances={assetsWithBalances}
          selectedAddresses={selectedAddresses}
          onToggle={onToggle}
        />

        {/* Selected assets detail */}
        {selectedAssets.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedAssets.map((asset) => {
              const balance = getBalance(asset.address);
              return (
                <div
                  key={asset.address}
                  className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-text-primary">
                    {asset.symbol}
                  </span>
                  <span className="text-text-tertiary">
                    {balance ?? "—"} {asset.symbol}
                  </span>
                  <button
                    onClick={() => onToggle(asset)}
                    className="ml-1 text-text-tertiary hover:text-text-primary"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
