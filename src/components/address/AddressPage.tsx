// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { normalize } from "viem/ens";
import { getEnsAddress } from "wagmi/actions";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { useAddressPositions } from "@/lib/hooks/useAddressPositions";
import { wagmiConfig } from "@/lib/web3/config";
import {
  buildStrategyFromPositions,
  saveImportedStrategy,
} from "@/lib/canvas/importStrategy";
import PositionsSummary from "./PositionsSummary";
import TransactionTimeline from "./TransactionTimeline";

/**
 * Resolve a user-supplied input to an Ethereum address.
 * Accepts:
 *   - 0x-prefixed addresses
 *   - Etherscan / Basescan URLs (https only, known domains only)
 *   - ENS names (`.eth` and other ENS TLDs) — resolved via viem on mainnet
 *
 * Returns null when the input doesn't match any known format, or a string
 * starting with "ENS_NOT_FOUND:" when an ENS lookup fails.
 */
async function resolveAddress(input: string): Promise<string | null | { error: string }> {
  const trimmed = input.trim();

  // Direct address
  const addrMatch = trimmed.match(/^(0x[a-fA-F0-9]{40})$/);
  if (addrMatch && isAddress(addrMatch[1])) return addrMatch[1].toLowerCase();

  // Etherscan/Basescan URL: enforce HTTPS + known domains
  const urlMatch = trimmed.match(
    /^https:\/\/(?:www\.)?(?:etherscan\.io|basescan\.org)\/address\/(0x[a-fA-F0-9]{40})/i
  );
  if (urlMatch && isAddress(urlMatch[1])) return urlMatch[1].toLowerCase();

  // ENS name — anything containing a dot, no spaces, reasonable length
  if (/^[a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(trimmed) && !trimmed.startsWith("0x")) {
    try {
      const normalized = normalize(trimmed);
      const resolved = await getEnsAddress(wagmiConfig, {
        name: normalized,
        chainId: 1, // ENS lives on mainnet
      });
      if (resolved && isAddress(resolved)) return resolved.toLowerCase();
      return { error: `ENS name "${trimmed}" does not resolve to an address` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ENS lookup failed";
      return { error: `ENS resolution error: ${msg.slice(0, 100)}` };
    }
  }

  return null;
}

export default function AddressPage() {
  const { chainId, slug } = useChain();
  const router = useRouter();
  const { address: connectedAddress, isConnected } = useAccount();
  const [inputValue, setInputValue] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  // Avoid SSR/client hydration mismatch — wagmi's isConnected is undefined
  // on the server. Render the connected-wallet button only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const useConnectedWallet = useCallback(() => {
    if (!connectedAddress) return;
    const lower = connectedAddress.toLowerCase();
    setInputValue(lower);
    setInputError(null);
    setAddress(lower);
  }, [connectedAddress]);

  const {
    marketPositions,
    vaultPositions,
    transactions,
    loading,
    error,
    loadMoreTransactions,
    hasMore,
  } = useAddressPositions(address, chainId);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (resolving) return;
      setResolving(true);
      try {
        const result = await resolveAddress(inputValue);
        if (result === null) {
          setInputError("Invalid address, ENS name, or Etherscan URL");
          return;
        }
        if (typeof result === "object" && "error" in result) {
          setInputError(result.error);
          return;
        }
        setInputError(null);
        setAddress(result);
      } finally {
        setResolving(false);
      }
    },
    [inputValue, resolving]
  );

  const handleSeeInCanvas = useCallback(() => {
    if (!address) return;
    const strategy = buildStrategyFromPositions(
      address,
      slug,
      chainId,
      marketPositions,
      vaultPositions
    );
    saveImportedStrategy(strategy);
    router.push(`/${slug}/canvas`);
  }, [address, slug, chainId, marketPositions, vaultPositions, router]);

  const hasPositions = marketPositions.length > 0 || vaultPositions.length > 0;

  const totalSupplyUsd = marketPositions.reduce(
    (sum, p) => sum + (p.state?.supplyAssetsUsd ?? 0),
    0
  );
  const totalCollateralUsd = marketPositions.reduce(
    (sum, p) => sum + (p.state?.collateralUsd ?? 0),
    0
  );
  const totalBorrowUsd = marketPositions.reduce(
    (sum, p) => sum + (p.state?.borrowAssetsUsd ?? 0),
    0
  );
  const totalVaultUsd = vaultPositions.reduce(
    (sum, p) => sum + (p.state?.assetsUsd ?? 0),
    0
  );
  const totalNetWorth = totalSupplyUsd + totalCollateralUsd + totalVaultUsd - totalBorrowUsd;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          Address Explorer
        </h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Visualize Morpho positions and transaction history for any address
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Address (0x...), ENS name (vitalik.eth), or Etherscan URL"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              className={`w-full rounded-xl border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand ${
                inputError ? "border-error" : "border-border"
              }`}
            />
            {inputError && (
              <p className="absolute -bottom-5 left-1 text-[11px] text-error">
                {inputError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={resolving}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resolving ? "Resolving…" : "Explore"}
          </button>
          {mounted && isConnected && connectedAddress && (
            <button
              type="button"
              onClick={useConnectedWallet}
              title={`Use ${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-brand"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 4a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M12 7h-2a1 1 0 100 2h2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Use my wallet
            </button>
          )}
        </div>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className="text-sm text-text-tertiary">Loading Morpho data...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Results */}
      {address && !loading && !error && (
        <div className="space-y-6">
          {/* Address badge + See in Canvas */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="7" r="3.5" stroke="#2973ff" strokeWidth="1.5" />
                  <path d="M3 17.5c0-3.5 3.1-6 7-6s7 2.5 7 6" stroke="#2973ff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <span className="font-mono text-sm text-text-primary">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </span>
                <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                  <span>{marketPositions.length} market positions</span>
                  <span>{vaultPositions.length} vault positions</span>
                  <span>{transactions.length}+ transactions</span>
                </div>
              </div>
            </div>

            {hasPositions && (
              <button
                onClick={handleSeeInCanvas}
                className="flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand/20"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="10" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="5.5" y="10" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M6 3.5h4M3.5 6v4.5h2M12.5 6v4.5h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                See in Canvas
              </button>
            )}
          </div>

          {/* Net worth summary cards */}
          {(totalNetWorth > 0 || marketPositions.length > 0 || vaultPositions.length > 0) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="Net Worth" value={totalNetWorth} accent />
              <SummaryCard label="Collateral" value={totalCollateralUsd} />
              <SummaryCard label="Borrows" value={totalBorrowUsd} negative />
              <SummaryCard label="Vaults" value={totalVaultUsd} />
            </div>
          )}

          {/* Positions */}
          {(marketPositions.length > 0 || vaultPositions.length > 0) && (
            <PositionsSummary
              marketPositions={marketPositions}
              vaultPositions={vaultPositions}
            />
          )}

          {/* Transactions */}
          {transactions.length > 0 && (
            <TransactionTimeline
              transactions={transactions}
              loadMore={loadMoreTransactions}
              hasMore={hasMore}
            />
          )}

          {/* Empty state */}
          {marketPositions.length === 0 &&
            vaultPositions.length === 0 &&
            transactions.length === 0 && (
              <div className="rounded-xl border border-border bg-bg-card py-16 text-center">
                <p className="text-sm text-text-tertiary">
                  No Morpho activity found for this address on this chain
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  negative,
  accent,
}: {
  label: string;
  value: number;
  negative?: boolean;
  accent?: boolean;
}) {
  const formatted =
    value >= 1_000_000
      ? `$${(value / 1_000_000).toFixed(2)}M`
      : value >= 1_000
        ? `$${(value / 1_000).toFixed(1)}K`
        : `$${value.toFixed(2)}`;

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        accent
          ? "border-brand/20 bg-brand/5"
          : "border-border bg-bg-card"
      }`}
    >
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <p
        className={`text-lg font-semibold ${
          accent
            ? "text-brand"
            : negative
              ? "text-error"
              : "text-text-primary"
        }`}
      >
        {negative && value > 0 ? `-${formatted.slice(1)}` : formatted}
      </p>
    </div>
  );
}