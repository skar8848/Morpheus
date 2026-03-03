"use client";

interface VaultFiltersProps {
  minApy: string;
  onMinApyChange: (value: string) => void;
  minTvl: string;
  onMinTvlChange: (value: string) => void;
  curatorSearch: string;
  onCuratorSearchChange: (value: string) => void;
  sortBy: "apy" | "tvl";
  onSortByChange: (value: "apy" | "tvl") => void;
}

export default function VaultFilters({
  minApy,
  onMinApyChange,
  minTvl,
  onMinTvlChange,
  curatorSearch,
  onCuratorSearchChange,
  sortBy,
  onSortByChange,
}: VaultFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Min APY */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary">Min APY</label>
        <input
          type="number"
          value={minApy}
          onChange={(e) => onMinApyChange(e.target.value)}
          placeholder="0"
          min="0"
          step="0.1"
          className="w-20 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
        />
        <span className="text-xs text-text-tertiary">%</span>
      </div>

      {/* Min TVL */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary">Min TVL</label>
        <select
          value={minTvl}
          onChange={(e) => onMinTvlChange(e.target.value)}
          className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
        >
          <option value="0">Any</option>
          <option value="100000">$100K</option>
          <option value="1000000">$1M</option>
          <option value="10000000">$10M</option>
        </select>
      </div>

      {/* Curator search */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary">Curator</label>
        <input
          type="text"
          value={curatorSearch}
          onChange={(e) => onCuratorSearchChange(e.target.value)}
          placeholder="Search..."
          className="w-32 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
        />
      </div>

      {/* Sort toggle */}
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-xs text-text-tertiary mr-1">Sort:</span>
        <button
          onClick={() => onSortByChange("tvl")}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            sortBy === "tvl"
              ? "bg-brand/10 text-brand"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          TVL
        </button>
        <button
          onClick={() => onSortByChange("apy")}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            sortBy === "apy"
              ? "bg-brand/10 text-brand"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          APY
        </button>
      </div>
    </div>
  );
}
