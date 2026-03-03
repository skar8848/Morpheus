"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import type { Vault } from "@/lib/graphql/types";
import DeployVaultCard from "./DeployVaultCard";
import VaultFilters from "./VaultFilters";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 5;

interface DeploySectionProps {
  loanSymbol: string;
  vaults: Vault[];
  selectedVaults: Vault[];
  onToggle: (vault: Vault) => void;
  loading: boolean;
  error: string | null;
  vaultAllocations: Record<string, number>;
  onAllocationChange: (vaultAddress: string, pct: number) => void;
}

export default function DeploySection({
  loanSymbol,
  vaults,
  selectedVaults,
  onToggle,
  loading,
  error,
  vaultAllocations,
  onAllocationChange,
}: DeploySectionProps) {
  const selectedAddresses = new Set(selectedVaults.map((v) => v.address));

  // Filter state
  const [minApy, setMinApy] = useState("");
  const [minTvl, setMinTvl] = useState("0");
  const [curatorSearch, setCuratorSearch] = useState("");
  const [sortBy, setSortBy] = useState<"apy" | "tvl">("tvl");
  const [page, setPage] = useState(0);

  const filteredVaults = useMemo(() => {
    let result = [...vaults];

    // Min APY filter
    const minApyValue = parseFloat(minApy);
    if (!isNaN(minApyValue) && minApyValue > 0) {
      result = result.filter(
        (v) => v.state.netApy * 100 >= minApyValue
      );
    }

    // Min TVL filter
    const minTvlValue = parseFloat(minTvl);
    if (minTvlValue > 0) {
      result = result.filter(
        (v) => (v.state.totalAssetsUsd ?? 0) >= minTvlValue
      );
    }

    // Curator search
    if (curatorSearch.trim()) {
      const search = curatorSearch.toLowerCase();
      result = result.filter(
        (v) =>
          v.state.curator?.toLowerCase().includes(search) ||
          v.name.toLowerCase().includes(search)
      );
    }

    // Sort
    if (sortBy === "apy") {
      result.sort((a, b) => b.state.netApy - a.state.netApy);
    } else {
      result.sort((a, b) => (b.state.totalAssetsUsd ?? 0) - (a.state.totalAssetsUsd ?? 0));
    }

    return result;
  }, [vaults, minApy, minTvl, curatorSearch, sortBy]);

  // Reset page when filters change
  const filterKey = `${minApy}:${minTvl}:${curatorSearch}:${sortBy}`;
  useMemo(() => {
    setPage(0);
  }, [filterKey]);

  const totalPages = Math.ceil(filteredVaults.length / PAGE_SIZE);
  const pagedVaults = filteredVaults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Deploy {loanSymbol}
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          Earn additional yield in curated vaults
        </p>
      </div>

      {!loading && !error && vaults.length > 0 && (
        <VaultFilters
          minApy={minApy}
          onMinApyChange={setMinApy}
          minTvl={minTvl}
          onMinTvlChange={setMinTvl}
          curatorSearch={curatorSearch}
          onCuratorSearchChange={setCuratorSearch}
          sortBy={sortBy}
          onSortByChange={setSortBy}
        />
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius)]" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius)] border border-error/20 bg-error/5 p-4 text-sm text-error">
          Failed to load vaults: {error}
        </div>
      )}

      {!loading && !error && vaults.length === 0 && (
        <div className="rounded-[var(--radius)] border border-border bg-bg-card p-8 text-center text-sm text-text-tertiary">
          Select borrow markets above to see deployment vaults
        </div>
      )}

      {!loading && !error && filteredVaults.length === 0 && vaults.length > 0 && (
        <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6 text-center text-sm text-text-tertiary">
          No vaults match your filters
        </div>
      )}

      {!loading && !error && pagedVaults.length > 0 && (
        <>
          <div className="space-y-2">
            {pagedVaults.map((vault) => (
              <DeployVaultCard
                key={vault.address}
                vault={vault}
                selected={selectedAddresses.has(vault.address)}
                onToggle={() => onToggle(vault)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Previous
              </button>

              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${
                    i === page
                      ? "bg-brand text-white"
                      : "border border-border text-text-secondary hover:bg-bg-secondary"
                  }`}
                >
                  {i + 1}
                </button>
              ))}

              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}

          {/* Count */}
          <p className="mt-2 text-center text-xs text-text-tertiary">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredVaults.length)} of {filteredVaults.length} vaults
          </p>
        </>
      )}

      {/* Vault allocation when 2+ vaults selected */}
      {selectedVaults.length >= 2 && (
        <div className="mt-5 rounded-[var(--radius)] border border-border bg-bg-card p-5">
          <div className="mb-3">
            <p className="text-sm font-semibold text-text-primary">
              Allocation
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              How to split borrowed {loanSymbol} across vaults
            </p>
          </div>
          <div className="space-y-3">
            {selectedVaults.map((vault) => {
              const pct = vaultAllocations[vault.address] ?? 0;
              return (
                <div key={vault.address} className="flex items-center gap-3">
                  <Image
                    src={vault.asset.logoURI || `https://cdn.morpho.org/assets/logos/${vault.asset.symbol.toLowerCase()}.svg`}
                    alt={vault.asset.symbol}
                    width={20}
                    height={20}
                    className="rounded-full shrink-0"
                    unoptimized
                  />
                  <span className="text-xs text-text-secondary truncate w-32 shrink-0">
                    {vault.name}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => onAllocationChange(vault.address, Number(e.target.value))}
                    className="flex-1 accent-brand"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => onAllocationChange(vault.address, Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                      className="w-14 rounded-lg border border-border bg-bg-secondary px-2 py-1 text-center text-sm text-text-primary outline-none focus:border-brand"
                    />
                    <span className="text-xs text-text-tertiary">%</span>
                  </div>
                </div>
              );
            })}
          </div>
          {(() => {
            const total = selectedVaults.reduce((s, v) => s + (vaultAllocations[v.address] ?? 0), 0);
            if (total !== 100) {
              return (
                <p className="mt-2 text-xs text-yellow-400">
                  Total: {total}% — should be 100%
                </p>
              );
            }
            return null;
          })()}
        </div>
      )}
    </section>
  );
}
