"use client";

import Image from "next/image";
import { formatApy, formatUsd, formatTokenAmount, formatLltv } from "@/lib/utils/format";
import { safeBigInt } from "@/lib/utils/bigint";
import type { UserMarketPosition, UserVaultPosition } from "@/lib/graphql/types";

interface Props {
  marketPositions: UserMarketPosition[];
  vaultPositions: UserVaultPosition[];
}

export default function PositionsSummary({ marketPositions, vaultPositions }: Props) {
  // Separate borrows from supply-only
  const borrowPositions = marketPositions.filter(
    (p) => p.state?.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n
  );
  const supplyPositions = marketPositions.filter(
    (p) =>
      p.state?.supplyAssets &&
      safeBigInt(p.state.supplyAssets) > 0n &&
      (!p.state.borrowAssets || safeBigInt(p.state.borrowAssets) === 0n)
  );

  return (
    <div className="space-y-4">
      {/* Borrow positions */}
      {borrowPositions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Borrow Positions
          </h3>
          <div className="space-y-2">
            {borrowPositions.map((p) => (
              <BorrowPositionCard key={p.market.uniqueKey} position={p} />
            ))}
          </div>
        </div>
      )}

      {/* Supply-only positions */}
      {supplyPositions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Supply Positions
          </h3>
          <div className="space-y-2">
            {supplyPositions.map((p) => (
              <SupplyPositionCard key={p.market.uniqueKey} position={p} />
            ))}
          </div>
        </div>
      )}

      {/* Vault positions */}
      {vaultPositions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Vault Positions
          </h3>
          <div className="space-y-2">
            {vaultPositions.map((p) => (
              <VaultPositionCard key={p.vault.address} position={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BorrowPositionCard({ position }: { position: UserMarketPosition }) {
  const { market, state, healthFactor } = position;
  if (!state) return null;

  const collateralAmt = formatTokenAmount(state.collateral, market.collateralAsset?.decimals ?? 18);
  const borrowAmt = state.borrowAssets
    ? formatTokenAmount(state.borrowAssets, market.loanAsset.decimals)
    : "0";

  const hfColor =
    healthFactor === null
      ? "text-text-tertiary"
      : healthFactor > 2
        ? "text-success"
        : healthFactor > 1.2
          ? "text-yellow-400"
          : "text-error";

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Stacked asset icons */}
          <div className="relative h-8 w-12">
            {market.collateralAsset?.logoURI && (
              <Image
                src={market.collateralAsset.logoURI}
                alt={market.collateralAsset.symbol}
                width={32}
                height={32}
                className="absolute left-0 top-0 rounded-full"
                unoptimized
              />
            )}
            <Image
              src={market.loanAsset.logoURI}
              alt={market.loanAsset.symbol}
              width={24}
              height={24}
              className="absolute bottom-0 right-0 rounded-full ring-2 ring-bg-card"
              unoptimized
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                {market.collateralAsset?.symbol ?? "?"} / {market.loanAsset.symbol}
              </span>
              <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                LLTV {formatLltv(market.lltv)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
              <span>
                Collateral: {collateralAmt} {market.collateralAsset?.symbol}
                {state.collateralUsd ? ` (${formatUsd(state.collateralUsd)})` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-error">
            -{borrowAmt} {market.loanAsset.symbol}
          </div>
          {state.borrowAssetsUsd != null && (
            <div className="text-[11px] text-text-tertiary">
              {formatUsd(state.borrowAssetsUsd)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: HF + borrow rate */}
      <div className="mt-2 flex items-center gap-4 border-t border-border pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">Health Factor</span>
          <span className={`text-xs font-semibold ${hfColor}`}>
            {healthFactor !== null ? healthFactor.toFixed(2) : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">Borrow Rate</span>
          <span
            className={`text-xs font-medium ${
              market.state.netBorrowApy <= 0 ? "text-success" : "text-error"
            }`}
          >
            {formatApy(Math.abs(market.state.netBorrowApy))}
          </span>
        </div>
      </div>
    </div>
  );
}

function SupplyPositionCard({ position }: { position: UserMarketPosition }) {
  const { market, state } = position;
  if (!state?.supplyAssets) return null;

  const supplyAmt = formatTokenAmount(state.supplyAssets, market.loanAsset.decimals);

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-bg-card p-4">
      <div className="flex items-center gap-3">
        <Image
          src={market.loanAsset.logoURI}
          alt={market.loanAsset.symbol}
          width={32}
          height={32}
          className="rounded-full"
          unoptimized
        />
        <div>
          <span className="text-sm font-medium text-text-primary">
            Supply {market.loanAsset.symbol}
          </span>
          <div className="text-[11px] text-text-tertiary">
            Market: {market.collateralAsset?.symbol ?? "?"}/{market.loanAsset.symbol}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-success">
          {supplyAmt} {market.loanAsset.symbol}
        </div>
        {state.supplyAssetsUsd != null && (
          <div className="text-[11px] text-text-tertiary">
            {formatUsd(state.supplyAssetsUsd)}
          </div>
        )}
      </div>
    </div>
  );
}

function VaultPositionCard({ position }: { position: UserVaultPosition }) {
  const { vault, state } = position;
  if (!state?.assets) return null;

  const amt = formatTokenAmount(state.assets, vault.asset.decimals);

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-bg-card p-4">
      <div className="flex items-center gap-3">
        <Image
          src={vault.asset.logoURI}
          alt={vault.asset.symbol}
          width={32}
          height={32}
          className="rounded-full"
          unoptimized
        />
        <div>
          <span className="text-sm font-medium text-text-primary">{vault.name}</span>
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span>{vault.asset.symbol}</span>
            <span className="text-success">{formatApy(vault.state.netApy)} APY</span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-text-primary">
          {amt} {vault.asset.symbol}
        </div>
        {state.assetsUsd != null && (
          <div className="text-[11px] text-text-tertiary">{formatUsd(state.assetsUsd)}</div>
        )}
      </div>
    </div>
  );
}
