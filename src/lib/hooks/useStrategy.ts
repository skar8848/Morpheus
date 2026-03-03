"use client";

import { useState, useMemo, useCallback } from "react";
import { useMarkets } from "./useMarkets";
import { useVaults } from "./useVaults";
import { useLoanAssets } from "./useLoanAssets";
import { useTokenBalances } from "./useTokenBalances";
import { COLLATERAL_ASSETS } from "../constants/assets";
import { useChain } from "../context/ChainContext";
import type { Asset, AssetWithBalance, Market, Vault } from "../graphql/types";
import type { SupportedChainId } from "../web3/chains";

export interface PerAssetLiquidation {
  address: string;
  symbol: string;
  logoURI: string;
  currentPrice: number;
  liquidationPrice: number;
  dropPercent: number;
}

export interface SimulationState {
  depositAmounts: Record<string, string>;
  targetLtvs: Record<string, number>;
  borrowAmount: number;
  healthFactor: number;
  liquidationPrices: PerAssetLiquidation[];
  totalDepositValueUsd: number;
}

export interface StrategyState {
  // Assets
  allAssets: Asset[];
  assetsWithBalances: AssetWithBalance[];
  selectedAssets: Asset[];
  toggleAsset: (asset: Asset) => void;

  // Loan assets
  loanAssets: Asset[];
  loanAssetsLoading: boolean;
  selectedLoanAsset: Asset | null;
  setSelectedLoanAsset: (asset: Asset | null) => void;

  // Markets
  markets: Market[];
  selectedMarkets: Market[];
  toggleMarket: (market: Market) => void;
  marketsLoading: boolean;
  marketsError: string | null;

  // Vaults
  vaults: Vault[];
  selectedVaults: Vault[];
  toggleVault: (vault: Vault) => void;
  vaultsLoading: boolean;
  vaultsError: string | null;

  // APY
  combinedApy: number;
  borrowApy: number;
  vaultApy: number;

  // Simulation
  simulation: SimulationState;
  setDepositAmount: (address: string, amount: string) => void;
  setTargetLtv: (address: string, ltv: number) => void;

  // Vault allocations (address → percentage 0-100)
  vaultAllocations: Record<string, number>;
  setVaultAllocation: (vaultAddress: string, pct: number) => void;

  // Withdraw
  withdrawAmounts: Record<string, string>;
  setWithdrawAmount: (vaultAddress: string, amount: string) => void;
}

export function useStrategy(): StrategyState {
  const { chainId } = useChain();

  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<Market[]>([]);
  const [selectedVaults, setSelectedVaults] = useState<Vault[]>([]);
  const [selectedLoanAsset, setSelectedLoanAsset] = useState<Asset | null>(null);

  // Simulation state — per-asset deposit amounts keyed by address
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});
  const [targetLtvs, setTargetLtvs] = useState<Record<string, number>>({});
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, string>>({});
  const [vaultAllocations, setVaultAllocations] = useState<Record<string, number>>({});

  const setDepositAmount = useCallback((address: string, amount: string) => {
    setDepositAmounts((prev) => ({ ...prev, [address]: amount }));
  }, []);

  const setTargetLtv = useCallback((address: string, ltv: number) => {
    setTargetLtvs((prev) => ({ ...prev, [address]: ltv }));
  }, []);

  const setWithdrawAmount = useCallback((vaultAddress: string, amount: string) => {
    setWithdrawAmounts((prev) => ({ ...prev, [vaultAddress]: amount }));
  }, []);

  const setVaultAllocation = useCallback((vaultAddress: string, pct: number) => {
    setVaultAllocations((prev) => {
      const clamped = Math.min(100, Math.max(0, pct));
      const others = Object.keys(prev).filter((k) => k !== vaultAddress);
      if (others.length === 0) return { [vaultAddress]: 100 };

      const oldOthersTotal = others.reduce((s, k) => s + (prev[k] ?? 0), 0);
      const remaining = 100 - clamped;

      const next: Record<string, number> = { [vaultAddress]: clamped };
      if (oldOthersTotal === 0) {
        // Edge case: all others were 0, split remaining equally
        const each = Math.floor(remaining / others.length);
        others.forEach((k, i) => {
          next[k] = i === others.length - 1 ? remaining - each * (others.length - 1) : each;
        });
      } else {
        // Redistribute proportionally
        let distributed = 0;
        others.forEach((k, i) => {
          if (i === others.length - 1) {
            next[k] = remaining - distributed;
          } else {
            const share = Math.round((prev[k] / oldOthersTotal) * remaining);
            next[k] = share;
            distributed += share;
          }
        });
      }
      return next;
    });
  }, []);

  // Per-chain assets
  const allAssets = useMemo(
    () => COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [],
    [chainId]
  );

  // Real wallet balances
  const { assetsWithBalances } = useTokenBalances(allAssets);

  // Collateral addresses for queries
  const collateralAddresses = useMemo(
    () => selectedAssets.map((a) => a.address),
    [selectedAssets]
  );

  // Discover available loan assets from API
  const { loanAssets, loading: loanAssetsLoading } = useLoanAssets(collateralAddresses);

  // Fetch markets for selected collateral + loan asset
  const loanAddresses = useMemo(
    () => (selectedLoanAsset ? [selectedLoanAsset.address] : []),
    [selectedLoanAsset]
  );

  const { markets, loading: marketsLoading, error: marketsError } = useMarkets(
    collateralAddresses,
    loanAddresses
  );

  // Fetch vaults for selected loan asset
  const { vaults, loading: vaultsLoading, error: vaultsError } = useVaults(
    selectedMarkets.length > 0 && selectedLoanAsset
      ? [selectedLoanAsset.address]
      : []
  );

  // Reset downstream selections when chain changes
  const chainIdRef = useMemo(() => chainId, [chainId]);
  useMemo(() => {
    setSelectedAssets([]);
    setSelectedMarkets([]);
    setSelectedVaults([]);
    setSelectedLoanAsset(null);
    setDepositAmounts({});
    setWithdrawAmounts({});
    setVaultAllocations({});
    setTargetLtvs({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainIdRef]);

  const toggleAsset = useCallback((asset: Asset) => {
    setSelectedAssets((prev) => {
      const exists = prev.find((a) => a.address === asset.address);
      if (exists) {
        const next = prev.filter((a) => a.address !== asset.address);
        // Remove markets that used this collateral
        setSelectedMarkets((m) =>
          m.filter((mk) => mk.collateralAsset.address !== asset.address)
        );
        return next;
      }
      return [...prev, asset];
    });
  }, []);

  const toggleMarket = useCallback((market: Market) => {
    setSelectedMarkets((prev) => {
      const exists = prev.find((m) => m.uniqueKey === market.uniqueKey);
      if (exists) return prev.filter((m) => m.uniqueKey !== market.uniqueKey);
      return [...prev, market];
    });
  }, []);

  const toggleVault = useCallback((vault: Vault) => {
    setSelectedVaults((prev) => {
      const exists = prev.find((v) => v.address === vault.address);
      let next: Vault[];
      if (exists) {
        next = prev.filter((v) => v.address !== vault.address);
      } else {
        next = [...prev, vault];
      }
      // Auto-set equal split
      const pct = next.length > 0 ? Math.floor(100 / next.length) : 0;
      const allocs: Record<string, number> = {};
      next.forEach((v, i) => {
        // Last vault gets the remainder to ensure sum = 100
        allocs[v.address] = i === next.length - 1 ? 100 - pct * (next.length - 1) : pct;
      });
      setVaultAllocations(allocs);
      return next;
    });
  }, []);

  // APY calculations
  const borrowApy = useMemo(() => {
    if (selectedMarkets.length === 0) return 0;
    const sum = selectedMarkets.reduce(
      (acc, m) => acc + m.state.netBorrowApy,
      0
    );
    return sum / selectedMarkets.length;
  }, [selectedMarkets]);

  const vaultApy = useMemo(() => {
    if (selectedVaults.length === 0) return 0;
    const totalAlloc = selectedVaults.reduce(
      (s, v) => s + (vaultAllocations[v.address] ?? 0),
      0
    );
    if (totalAlloc === 0) {
      // Fallback: simple average
      return selectedVaults.reduce((acc, v) => acc + v.state.netApy, 0) / selectedVaults.length;
    }
    // Weighted average by allocation
    return selectedVaults.reduce(
      (acc, v) => acc + v.state.netApy * ((vaultAllocations[v.address] ?? 0) / totalAlloc),
      0
    );
  }, [selectedVaults, vaultAllocations]);

  const combinedApy = useMemo(() => {
    return Math.abs(borrowApy) + vaultApy;
  }, [borrowApy, vaultApy]);

  // Simulation calculations — per-asset LTV, borrow, health factor
  const simulation = useMemo((): SimulationState => {
    const loanPrice = selectedLoanAsset?.priceUsd ?? 1;

    let totalDepositValueUsd = 0;
    let totalBorrowValueUsd = 0;
    let totalWeightedLltv = 0; // sum of (depositValue × LLTV)

    const liquidationPrices: PerAssetLiquidation[] = [];

    for (const market of selectedMarkets) {
      const addr = market.collateralAsset.address;
      const depositAmount = parseFloat(depositAmounts[addr] || "0") || 0;
      const price = market.collateralAsset.priceUsd ?? 0;
      const depositValue = depositAmount * price;
      const lltv = Number(market.lltv) / 1e18;

      // Per-asset LTV (default 50% if not set)
      const assetLtv = targetLtvs[addr] ?? 50;
      const effectiveLtv = Math.min(assetLtv / 100, lltv);

      totalDepositValueUsd += depositValue;
      totalBorrowValueUsd += depositValue * effectiveLtv;
      totalWeightedLltv += depositValue * lltv;

      // Per-asset liquidation price
      if (depositAmount > 0 && price > 0) {
        const liqPrice = lltv > 0 ? price * (assetLtv / 100) / lltv : 0;
        const dropPct = price > 0 ? ((price - liqPrice) / price) * 100 : 0;
        // Avoid duplicates if multiple markets for same collateral
        if (!liquidationPrices.some((l) => l.address.toLowerCase() === addr.toLowerCase())) {
          liquidationPrices.push({
            address: addr,
            symbol: market.collateralAsset.symbol,
            logoURI: market.collateralAsset.logoURI,
            currentPrice: price,
            liquidationPrice: liqPrice,
            dropPercent: dropPct,
          });
        }
      }
    }

    const borrowAmount = loanPrice > 0 ? totalBorrowValueUsd / loanPrice : 0;

    // Weighted health factor: sum(depositValue × LLTV) / totalBorrowValue
    const healthFactor =
      totalBorrowValueUsd > 0 ? totalWeightedLltv / totalBorrowValueUsd : Infinity;

    return {
      depositAmounts,
      targetLtvs,
      borrowAmount,
      healthFactor: isFinite(healthFactor) ? healthFactor : 0,
      liquidationPrices,
      totalDepositValueUsd,
    };
  }, [depositAmounts, targetLtvs, selectedMarkets, selectedLoanAsset]);

  return {
    allAssets,
    assetsWithBalances,
    selectedAssets,
    toggleAsset,

    loanAssets,
    loanAssetsLoading,
    selectedLoanAsset,
    setSelectedLoanAsset,

    markets,
    selectedMarkets,
    toggleMarket,
    marketsLoading,
    marketsError,

    vaults,
    selectedVaults,
    toggleVault,
    vaultsLoading,
    vaultsError,

    combinedApy,
    borrowApy,
    vaultApy,

    simulation,
    setDepositAmount,
    setTargetLtv,

    vaultAllocations,
    setVaultAllocation,

    withdrawAmounts,
    setWithdrawAmount,
  };
}
