"use client";

import Image from "next/image";
import type { Asset } from "@/lib/graphql/types";

interface LoanAssetPickerProps {
  loanAssets: Asset[];
  selectedAsset: Asset | null;
  onSelect: (asset: Asset) => void;
  loading: boolean;
}

export default function LoanAssetPicker({
  loanAssets,
  selectedAsset,
  onSelect,
  loading,
}: LoanAssetPickerProps) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Choose Loan Asset
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Select which asset to borrow against your collateral
        </p>
      </div>

      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 w-24 animate-pulse rounded-full bg-bg-secondary"
            />
          ))}
        </div>
      )}

      {!loading && loanAssets.length === 0 && (
        <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6 text-center text-sm text-text-tertiary">
          Select collateral assets above to discover borrowable assets
        </div>
      )}

      {!loading && loanAssets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {loanAssets.map((asset) => {
            const isSelected =
              selectedAsset?.address.toLowerCase() ===
              asset.address.toLowerCase();
            return (
              <button
                key={asset.address}
                onClick={() => onSelect(asset)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  isSelected
                    ? "border-2 border-brand bg-brand/10 text-brand shadow-[0_0_12px_rgba(41,115,255,0.15)]"
                    : "border border-border bg-bg-secondary text-text-secondary hover:bg-bg-card hover:text-text-primary"
                }`}
              >
                <Image
                  src={
                    asset.logoURI ||
                    `https://cdn.morpho.org/assets/logos/${asset.symbol.toLowerCase()}.svg`
                  }
                  alt={asset.symbol}
                  width={20}
                  height={20}
                  className="rounded-full"
                  unoptimized
                />
                {asset.symbol}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
