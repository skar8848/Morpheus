"use client";

import Image from "next/image";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { Market, UserMarketPosition } from "@/lib/graphql/types";
import { formatApy, formatLltv, formatTokenAmount, formatUsd } from "@/lib/utils/format";

interface BorrowMarketCardProps {
  market: Market;
  selected: boolean;
  onToggle: () => void;
  existingPosition?: UserMarketPosition | null;
}

export default function BorrowMarketCard({
  market,
  selected,
  onToggle,
  existingPosition,
}: BorrowMarketCardProps) {
  const netApy = market.state.netBorrowApy;
  const isPaidToBorrow = netApy < 0;
  const hasRewards = market.state.rewards.length > 0;

  return (
    <Card selected={selected} onClick={onToggle} className="p-4">
      <div className="flex items-center justify-between">
        {/* Left: pair */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <Image
              src={market.collateralAsset.logoURI || `https://cdn.morpho.org/assets/logos/${market.collateralAsset.symbol.toLowerCase()}.svg`}
              alt={market.collateralAsset.symbol}
              width={32}
              height={32}
              className="rounded-full"
              unoptimized
            />
            <Image
              src={market.loanAsset.logoURI || `https://cdn.morpho.org/assets/logos/${market.loanAsset.symbol.toLowerCase()}.svg`}
              alt={market.loanAsset.symbol}
              width={32}
              height={32}
              className="-ml-2 rounded-full ring-2 ring-bg-card"
              unoptimized
            />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {market.collateralAsset.symbol} / {market.loanAsset.symbol}
            </p>
            <p className="text-xs text-text-tertiary">
              LLTV {formatLltv(market.lltv)}
            </p>
          </div>
        </div>

        {/* Right: APY + info */}
        <div className="flex items-center gap-4">
          {hasRewards && (
            <Badge variant="brand">
              {market.state.rewards.map((r) => r.asset.symbol).join(" + ")} rewards
            </Badge>
          )}
          <div className="text-right">
            <p
              className={`text-lg font-semibold ${
                isPaidToBorrow ? "text-success" : "text-text-primary"
              }`}
            >
              {formatApy(netApy)}
            </p>
            <p className="text-[10px] text-text-tertiary">
              {isPaidToBorrow ? "Paid to borrow" : "Net borrow APY"}
            </p>
          </div>
        </div>
      </div>

      {/* Existing position banner */}
      {existingPosition?.state && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-brand/5 border border-brand/20 px-3 py-2 text-xs">
          <span className="text-brand font-medium">Active position</span>
          {existingPosition.state.borrowAssets && BigInt(existingPosition.state.borrowAssets) > 0n && (
            <span className="text-text-secondary">
              Borrowed:{" "}
              <span className="text-text-primary font-medium">
                {existingPosition.state.borrowAssetsUsd
                  ? formatUsd(existingPosition.state.borrowAssetsUsd)
                  : formatTokenAmount(existingPosition.state.borrowAssets, market.loanAsset.decimals) + " " + market.loanAsset.symbol}
              </span>
            </span>
          )}
          {BigInt(existingPosition.state.collateral) > 0n && (
            <span className="text-text-secondary">
              Collateral:{" "}
              <span className="text-text-primary font-medium">
                {existingPosition.state.collateralUsd
                  ? formatUsd(existingPosition.state.collateralUsd)
                  : formatTokenAmount(existingPosition.state.collateral, market.collateralAsset.decimals) + " " + market.collateralAsset.symbol}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Bottom stats */}
      <div className="mt-3 flex gap-4 border-t border-border pt-3 text-xs text-text-tertiary">
        <div>
          <span className="text-text-secondary">Liquidity: </span>
          {formatTokenAmount(market.state.liquidityAssets, 6)} {market.loanAsset.symbol}
        </div>
        <div>
          <span className="text-text-secondary">Supplied: </span>
          {formatTokenAmount(market.state.supplyAssets, 6)} {market.loanAsset.symbol}
        </div>
      </div>
    </Card>
  );
}
