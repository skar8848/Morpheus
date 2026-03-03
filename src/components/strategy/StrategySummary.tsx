"use client";

import type { Market, Vault } from "@/lib/graphql/types";
import { formatApy, formatApyWithSign } from "@/lib/utils/format";

interface StrategySummaryProps {
  loanSymbol: string;
  selectedMarkets: Market[];
  selectedVaults: Vault[];
  borrowApy: number;
  vaultApy: number;
  combinedApy: number;
}

export default function StrategySummary({
  loanSymbol,
  selectedMarkets,
  selectedVaults,
  borrowApy,
  vaultApy,
  combinedApy,
}: StrategySummaryProps) {
  const hasStrategy = selectedMarkets.length > 0 || selectedVaults.length > 0;

  if (!hasStrategy) {
    return (
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Strategy Summary
          </h2>
          <p className="mt-0.5 text-sm text-text-tertiary">
            Build your strategy above to see combined yield
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-bg-card p-8 text-center text-sm text-text-tertiary">
          No strategy configured yet
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Strategy Summary
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Combined yield from borrow rewards + vault deployment
        </p>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6">
        {/* Combined APY hero */}
        <div className="mb-6 text-center">
          <p className="text-sm text-text-tertiary mb-1">Combined Net APY</p>
          <p className="text-4xl font-bold text-success">
            {formatApy(combinedApy)}
          </p>
        </div>

        {/* Breakdown table */}
        <div className="space-y-3">
          {/* Borrow legs */}
          {selectedMarkets.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Borrow positions
              </p>
              {selectedMarkets.map((market) => (
                <div
                  key={market.uniqueKey}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-4 py-2.5 mb-1.5"
                >
                  <span className="text-sm text-text-secondary">
                    {market.collateralAsset.symbol} / {market.loanAsset.symbol}
                    <span className="ml-2 text-xs text-text-tertiary">
                      (borrow)
                    </span>
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      market.state.netBorrowApy < 0
                        ? "text-success"
                        : "text-text-primary"
                    }`}
                  >
                    {formatApyWithSign(-market.state.netBorrowApy)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Vault legs */}
          {selectedVaults.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Vault deployments
              </p>
              {selectedVaults.map((vault) => (
                <div
                  key={vault.address}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-4 py-2.5 mb-1.5"
                >
                  <span className="text-sm text-text-secondary">
                    {vault.name}
                    <span className="ml-2 text-xs text-text-tertiary">
                      (earn)
                    </span>
                  </span>
                  <span className="text-sm font-medium text-success">
                    {formatApyWithSign(vault.state.netApy)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Total line */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-text-primary">
              Total strategy APY
            </span>
            <span className="text-lg font-bold text-success">
              {formatApyWithSign(combinedApy)}
            </span>
          </div>
        </div>

        {/* Strategy description */}
        <div className="mt-4 rounded-lg bg-brand/5 border border-brand/10 p-4 text-sm text-text-secondary">
          <p className="font-medium text-brand mb-1">How this works</p>
          <p className="text-xs leading-relaxed text-text-tertiary">
            Deposit collateral into Morpho markets → borrow {loanSymbol} at negative rates
            (you get paid) → deploy borrowed {loanSymbol} into curated vaults for additional
            yield. The combined APY stacks both the borrow rewards and vault earnings.
          </p>
        </div>
      </div>
    </section>
  );
}
