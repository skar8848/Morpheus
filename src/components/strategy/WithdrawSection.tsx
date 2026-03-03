"use client";

import Image from "next/image";
import type { VaultPosition } from "@/lib/hooks/useUserVaultPositions";
import { formatApy } from "@/lib/utils/format";

interface WithdrawSectionProps {
  positions: VaultPosition[];
  isLoading: boolean;
  withdrawAmounts: Record<string, string>;
  onWithdrawChange: (vaultAddress: string, amount: string) => void;
}

export default function WithdrawSection({
  positions,
  isLoading,
  withdrawAmounts,
  onWithdrawChange,
}: WithdrawSectionProps) {
  if (isLoading) {
    return (
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Withdraw & Redeploy
          </h2>
          <p className="mt-0.5 text-sm text-text-tertiary">
            Scanning your existing vault positions...
          </p>
        </div>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[var(--radius)] bg-bg-secondary"
            />
          ))}
        </div>
      </section>
    );
  }

  if (positions.length === 0) return null;

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Withdraw & Redeploy
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Withdraw from existing positions to fund your strategy
        </p>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-bg-card p-5 space-y-3">
        {positions.map((pos) => {
          const amount = withdrawAmounts[pos.vault.address] ?? "";
          const hasInput = parseFloat(amount) > 0;

          return (
            <div
              key={pos.vault.address}
              className={`rounded-xl border p-4 transition-colors ${
                hasInput
                  ? "border-brand/30 bg-brand/5"
                  : "border-border bg-bg-secondary"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Image
                    src={
                      pos.vault.asset.logoURI ||
                      `https://cdn.morpho.org/assets/logos/${pos.vault.asset.symbol.toLowerCase()}.svg`
                    }
                    alt={pos.vault.asset.symbol}
                    width={28}
                    height={28}
                    className="rounded-full"
                    unoptimized
                  />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {pos.vault.name}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {formatApy(pos.vault.state.netApy)} APY
                    </p>
                  </div>
                </div>

                <button
                  onClick={() =>
                    onWithdrawChange(pos.vault.address, pos.sharesFormatted)
                  }
                  className="text-xs text-brand hover:text-brand-hover transition-colors"
                >
                  MAX ({pos.sharesFormatted})
                </button>
              </div>

              <input
                type="number"
                value={amount}
                onChange={(e) =>
                  onWithdrawChange(pos.vault.address, e.target.value)
                }
                placeholder="0.00"
                min="0"
                step="any"
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/30"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
