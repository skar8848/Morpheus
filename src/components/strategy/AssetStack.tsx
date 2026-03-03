"use client";

import { useState } from "react";
import Image from "next/image";
import type { Asset, AssetWithBalance } from "@/lib/graphql/types";

interface AssetStackProps {
  assets: Asset[];
  assetsWithBalances: AssetWithBalance[];
  selectedAddresses: string[];
  onToggle: (asset: Asset) => void;
}

export default function AssetStack({
  assets,
  assetsWithBalances,
  selectedAddresses,
  onToggle,
}: AssetStackProps) {
  const [hovered, setHovered] = useState(false);

  const hasSelection = selectedAddresses.length > 0;

  const getBalance = (address: string): string | null => {
    const found = assetsWithBalances.find(
      (a) => a.address.toLowerCase() === address.toLowerCase()
    );
    if (!found || found.balanceRaw === 0n) return null;
    return found.balance;
  };

  // When there's a selection: selected assets are always expanded at the front,
  // unselected assets stack behind them (collapsed unless hovered)
  const selectedAssets = assets.filter((a) =>
    selectedAddresses.includes(a.address)
  );
  const unselectedAssets = assets.filter(
    (a) => !selectedAddresses.includes(a.address)
  );

  // Calculate positions
  const EXPANDED_GAP = 72;
  const COLLAPSED_GAP = 16;
  const TOKEN_SIZE = 44;

  const getPosition = (asset: Asset) => {
    const isSelected = selectedAddresses.includes(asset.address);

    if (hasSelection) {
      const selectedIdx = selectedAssets.indexOf(asset);
      const unselectedIdx = unselectedAssets.indexOf(asset);

      if (isSelected) {
        // Selected assets are always expanded
        return selectedIdx * EXPANDED_GAP;
      } else {
        // Unselected start after selected block
        const selectedEnd = selectedAssets.length * EXPANDED_GAP;
        if (hovered) {
          return selectedEnd + unselectedIdx * EXPANDED_GAP;
        }
        return selectedEnd + unselectedIdx * COLLAPSED_GAP;
      }
    } else {
      // No selection: normal behavior (expand on hover)
      const idx = assets.indexOf(asset);
      return hovered ? idx * EXPANDED_GAP : idx * COLLAPSED_GAP;
    }
  };

  const containerWidth = (() => {
    if (hasSelection) {
      const selectedWidth = selectedAssets.length * EXPANDED_GAP;
      const unselectedWidth = hovered
        ? unselectedAssets.length * EXPANDED_GAP
        : (unselectedAssets.length - 1) * COLLAPSED_GAP + TOKEN_SIZE;
      return selectedWidth + Math.max(unselectedWidth, 0);
    }
    return hovered
      ? assets.length * EXPANDED_GAP
      : (assets.length - 1) * COLLAPSED_GAP + TOKEN_SIZE;
  })();

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 72,
        width: containerWidth,
      }}
    >
      {assets.map((asset) => {
        const isSelected = selectedAddresses.includes(asset.address);
        const balance = getBalance(asset.address);
        const tooltipText = balance
          ? `${asset.symbol} — ${balance} ${asset.symbol}`
          : asset.symbol;
        const left = getPosition(asset);

        // Show label when expanded (hovered) or when selected
        const showLabel = hovered || isSelected;

        return (
          <button
            key={asset.address}
            onClick={() => onToggle(asset)}
            className="absolute flex flex-col items-center transition-all duration-300 ease-out"
            style={{
              left,
              zIndex: isSelected ? 20 : 10 - assets.indexOf(asset),
            }}
            title={tooltipText}
          >
            <div
              className={`rounded-full transition-all duration-300 ease-out ${
                isSelected
                  ? "scale-110 ring-2 ring-brand shadow-[0_0_12px_rgba(41,115,255,0.4)]"
                  : "ring-2 ring-bg-primary hover:ring-text-tertiary/40"
              }`}
            >
              <Image
                src={asset.logoURI}
                alt={asset.symbol}
                width={40}
                height={40}
                className="rounded-full"
                unoptimized
              />
            </div>
            <span
              className={`mt-1 text-[10px] font-medium transition-all duration-200 ${
                showLabel ? "opacity-100" : "opacity-0"
              } ${isSelected ? "text-brand" : "text-text-tertiary"}`}
            >
              {asset.symbol}
            </span>
          </button>
        );
      })}
    </div>
  );
}
