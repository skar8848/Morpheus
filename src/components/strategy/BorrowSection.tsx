"use client";

import type { Market, UserMarketPosition } from "@/lib/graphql/types";
import BorrowMarketCard from "./BorrowMarketCard";
import Skeleton from "@/components/ui/Skeleton";

interface BorrowSectionProps {
  loanSymbol: string;
  markets: Market[];
  selectedMarkets: Market[];
  onToggle: (market: Market) => void;
  loading: boolean;
  error: string | null;
  userPositions?: UserMarketPosition[];
}

export default function BorrowSection({
  loanSymbol,
  markets,
  selectedMarkets,
  onToggle,
  loading,
  error,
  userPositions = [],
}: BorrowSectionProps) {
  const selectedKeys = new Set(selectedMarkets.map((m) => m.uniqueKey));
  const positionsByKey = new Map(
    userPositions.map((p) => [p.market.uniqueKey, p])
  );

  // Group by collateral asset
  const grouped = markets.reduce<Record<string, Market[]>>((acc, market) => {
    const key = market.collateralAsset.symbol;
    if (!acc[key]) acc[key] = [];
    acc[key].push(market);
    return acc;
  }, {});

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Borrow {loanSymbol}
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Negative rates = you get paid to borrow
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius)]" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius)] border border-error/20 bg-error/5 p-4 text-sm text-error">
          Failed to load markets: {error}
        </div>
      )}

      {!loading && !error && markets.length === 0 && (
        <div className="rounded-[var(--radius)] border border-border bg-bg-card p-8 text-center text-sm text-text-tertiary">
          Select collateral assets above to see available borrow markets
        </div>
      )}

      {!loading &&
        !error &&
        Object.entries(grouped).map(([symbol, groupMarkets]) => (
          <div key={symbol} className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-text-secondary">
              {symbol} collateral
            </h3>
            <div className="space-y-2">
              {groupMarkets
                .sort((a, b) => a.state.netBorrowApy - b.state.netBorrowApy)
                .map((market) => (
                  <BorrowMarketCard
                    key={market.uniqueKey}
                    market={market}
                    selected={selectedKeys.has(market.uniqueKey)}
                    onToggle={() => onToggle(market)}
                    existingPosition={positionsByKey.get(market.uniqueKey)}
                  />
                ))}
            </div>
          </div>
        ))}
    </section>
  );
}
