"use client";

import Image from "next/image";
import type {
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";
import {
  formatApy,
  formatUsd,
  formatTokenAmount,
  formatLltv,
} from "@/lib/utils/format";

interface ActivePositionsProps {
  marketPositions: UserMarketPosition[];
  vaultPositions: UserVaultPosition[];
  loading: boolean;
  error: string | null;
}

export default function ActivePositions({
  marketPositions,
  vaultPositions,
  loading,
  error,
}: ActivePositionsProps) {
  const borrowPositions = marketPositions.filter(
    (p) => p.state && p.state.borrowAssets && BigInt(p.state.borrowAssets) > 0n
  );
  const supplyPositions = marketPositions.filter(
    (p) =>
      p.state && p.state.supplyAssets && BigInt(p.state.supplyAssets) > 0n
  );
  const collateralPositions = marketPositions.filter(
    (p) => p.state && BigInt(p.state.collateral) > 0n
  );

  const isEmpty =
    borrowPositions.length === 0 &&
    supplyPositions.length === 0 &&
    collateralPositions.length === 0 &&
    vaultPositions.length === 0;

  if (!loading && isEmpty && !error) return null;

  const hfColor = (hf: number | null) => {
    if (hf === null) return "text-text-tertiary";
    if (hf > 2) return "text-success";
    if (hf > 1.2) return "text-yellow-400";
    return "text-error";
  };

  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Active Positions
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Your current Morpho positions on this chain
        </p>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[var(--radius)] bg-bg-secondary"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius)] border border-error/20 bg-error/5 p-4 text-sm text-error">
          Failed to load positions: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-[var(--radius)] border border-border bg-bg-card overflow-hidden">
          {/* Borrow positions */}
          {borrowPositions.length > 0 && (
            <div>
              <div className="px-5 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Borrows
                </p>
              </div>
              <div className="divide-y divide-border">
                {borrowPositions.map((pos) => (
                  <div
                    key={`borrow-${pos.market.uniqueKey}`}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center">
                        <Image
                          src={pos.market.collateralAsset.logoURI}
                          alt={pos.market.collateralAsset.symbol}
                          width={28}
                          height={28}
                          className="rounded-full"
                          unoptimized
                        />
                        <Image
                          src={pos.market.loanAsset.logoURI}
                          alt={pos.market.loanAsset.symbol}
                          width={28}
                          height={28}
                          className="-ml-2 rounded-full ring-2 ring-bg-card"
                          unoptimized
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {pos.market.collateralAsset.symbol} /{" "}
                          {pos.market.loanAsset.symbol}
                        </p>
                        <p className="text-xs text-text-tertiary">
                          LLTV {formatLltv(pos.market.lltv)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-right">
                      {/* Collateral */}
                      {pos.state && BigInt(pos.state.collateral) > 0n && (
                        <div>
                          <p className="text-xs text-text-tertiary">Collateral</p>
                          <p className="text-sm font-medium text-text-primary">
                            {pos.state.collateralUsd
                              ? formatUsd(pos.state.collateralUsd)
                              : formatTokenAmount(
                                  pos.state.collateral,
                                  pos.market.collateralAsset.decimals
                                )}
                          </p>
                        </div>
                      )}

                      {/* Borrowed */}
                      <div>
                        <p className="text-xs text-text-tertiary">Borrowed</p>
                        <p className="text-sm font-medium text-text-primary">
                          {pos.state?.borrowAssetsUsd
                            ? formatUsd(pos.state.borrowAssetsUsd)
                            : pos.state?.borrowAssets
                              ? formatTokenAmount(
                                  pos.state.borrowAssets,
                                  pos.market.loanAsset.decimals
                                )
                              : "—"}
                        </p>
                      </div>

                      {/* Borrow APY */}
                      <div>
                        <p className="text-xs text-text-tertiary">Borrow APY</p>
                        <p
                          className={`text-sm font-medium ${
                            pos.market.state.netBorrowApy < 0
                              ? "text-success"
                              : "text-text-primary"
                          }`}
                        >
                          {formatApy(pos.market.state.netBorrowApy)}
                        </p>
                      </div>

                      {/* Health Factor */}
                      <div>
                        <p className="text-xs text-text-tertiary">HF</p>
                        <p
                          className={`text-sm font-semibold ${hfColor(pos.healthFactor)}`}
                        >
                          {pos.healthFactor
                            ? pos.healthFactor.toFixed(2)
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Supply positions */}
          {supplyPositions.length > 0 && (
            <div>
              <div className="px-5 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Market Supplies
                </p>
              </div>
              <div className="divide-y divide-border">
                {supplyPositions.map((pos) => (
                  <div
                    key={`supply-${pos.market.uniqueKey}`}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <Image
                        src={pos.market.loanAsset.logoURI}
                        alt={pos.market.loanAsset.symbol}
                        width={28}
                        height={28}
                        className="rounded-full"
                        unoptimized
                      />
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {pos.market.loanAsset.symbol} supply
                        </p>
                        <p className="text-xs text-text-tertiary">
                          {pos.market.collateralAsset.symbol} /{" "}
                          {pos.market.loanAsset.symbol}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-text-primary">
                        {pos.state?.supplyAssetsUsd
                          ? formatUsd(pos.state.supplyAssetsUsd)
                          : pos.state?.supplyAssets
                            ? formatTokenAmount(
                                pos.state.supplyAssets,
                                pos.market.loanAsset.decimals
                              )
                            : "—"}
                      </p>
                      <p className="text-xs text-text-tertiary">Supplied</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vault positions */}
          {vaultPositions.length > 0 && (
            <div>
              <div className="px-5 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Vault Deposits
                </p>
              </div>
              <div className="divide-y divide-border">
                {vaultPositions.map((pos) => (
                  <div
                    key={`vault-${pos.vault.address}`}
                    className="flex items-center justify-between px-5 py-3"
                  >
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
                          {pos.vault.symbol}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-right">
                      <div>
                        <p className="text-xs text-text-tertiary">Deposited</p>
                        <p className="text-sm font-medium text-text-primary">
                          {pos.state?.assetsUsd
                            ? formatUsd(pos.state.assetsUsd)
                            : pos.state?.assets
                              ? formatTokenAmount(
                                  pos.state.assets,
                                  pos.vault.asset.decimals
                                )
                              : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-tertiary">APY</p>
                        <p className="text-sm font-medium text-success">
                          {formatApy(pos.vault.state.netApy)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collateral-only positions (no borrow) */}
          {collateralPositions.filter(
            (p) => !borrowPositions.some((b) => b.market.uniqueKey === p.market.uniqueKey)
          ).length > 0 && (
            <div>
              <div className="px-5 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Collateral Only
                </p>
              </div>
              <div className="divide-y divide-border">
                {collateralPositions
                  .filter(
                    (p) =>
                      !borrowPositions.some(
                        (b) => b.market.uniqueKey === p.market.uniqueKey
                      )
                  )
                  .map((pos) => (
                    <div
                      key={`collateral-${pos.market.uniqueKey}`}
                      className="flex items-center justify-between px-5 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <Image
                          src={pos.market.collateralAsset.logoURI}
                          alt={pos.market.collateralAsset.symbol}
                          width={28}
                          height={28}
                          className="rounded-full"
                          unoptimized
                        />
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {pos.market.collateralAsset.symbol}
                          </p>
                          <p className="text-xs text-text-tertiary">
                            in {pos.market.collateralAsset.symbol} /{" "}
                            {pos.market.loanAsset.symbol}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-text-primary">
                          {pos.state?.collateralUsd
                            ? formatUsd(pos.state.collateralUsd)
                            : formatTokenAmount(
                                pos.state!.collateral,
                                pos.market.collateralAsset.decimals
                              )}
                        </p>
                        <p className="text-xs text-text-tertiary">Collateral</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
