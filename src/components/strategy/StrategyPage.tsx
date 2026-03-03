"use client";

import { useStrategy } from "@/lib/hooks/useStrategy";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { useUserVaultPositions } from "@/lib/hooks/useUserVaultPositions";
import ActivePositions from "./ActivePositions";
import CollateralSelector from "./CollateralSelector";
import LoanAssetPicker from "./LoanAssetPicker";
import BorrowSection from "./BorrowSection";
import BorrowSimulation from "./BorrowSimulation";
import DeploySection from "./DeploySection";
import WithdrawSection from "./WithdrawSection";
import StrategySummary from "./StrategySummary";
import TransactionBundle from "./TransactionBundle";
import SectionConnector from "./SectionConnector";

export default function StrategyPage() {
  const {
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
  } = useStrategy();

  // Fetch all user positions (borrows, supplies, vaults)
  const {
    marketPositions: userMarketPositions,
    vaultPositions: userVaultPositions,
    loading: positionsLoading,
    error: positionsError,
  } = useUserPositions();

  // Fetch user's existing vault positions for withdraw section
  const { positions: withdrawablePositions, isLoading: withdrawLoading } =
    useUserVaultPositions(vaults);

  const showLoanPicker = selectedAssets.length > 0;
  const showBorrow = selectedLoanAsset !== null;
  const showSimulation = selectedMarkets.length > 0;
  const showDeploy = selectedMarkets.length > 0;
  const showSummary = selectedMarkets.length > 0 || selectedVaults.length > 0;
  const showBundle = showSummary && simulation.borrowAmount > 0;

  // Vaults the user has positions in and has entered a withdraw amount for
  const withdrawVaults = vaults.filter(
    (v) =>
      withdrawAmounts[v.address] && parseFloat(withdrawAmounts[v.address]) > 0
  );

  const loanSymbol = selectedLoanAsset?.symbol ?? "—";

  return (
    <div className="space-y-0">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">
          Strategy Builder
        </h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Compose yield strategies: deposit collateral, borrow at negative
          rates, and deploy into vaults.
        </p>
      </div>

      {/* Active Positions */}
      <ActivePositions
        marketPositions={userMarketPositions}
        vaultPositions={userVaultPositions}
        loading={positionsLoading}
        error={positionsError}
      />

      {/* Step 1: Collateral */}
      <CollateralSelector
        assets={allAssets}
        assetsWithBalances={assetsWithBalances}
        selectedAssets={selectedAssets}
        onToggle={toggleAsset}
      />

      <SectionConnector active={showLoanPicker} />

      {/* Step 2: Loan Asset Picker */}
      <div
        className={`transition-all duration-500 ${
          showLoanPicker
            ? "opacity-100 translate-y-0"
            : "opacity-40 translate-y-2 pointer-events-none"
        }`}
      >
        <LoanAssetPicker
          loanAssets={loanAssets}
          selectedAsset={selectedLoanAsset}
          onSelect={setSelectedLoanAsset}
          loading={loanAssetsLoading}
        />
      </div>

      <SectionConnector active={showBorrow} />

      {/* Step 3: Borrow */}
      <div
        className={`transition-all duration-500 ${
          showBorrow
            ? "opacity-100 translate-y-0"
            : "opacity-40 translate-y-2 pointer-events-none"
        }`}
      >
        <BorrowSection
          loanSymbol={loanSymbol}
          markets={markets}
          selectedMarkets={selectedMarkets}
          onToggle={toggleMarket}
          loading={marketsLoading}
          error={marketsError}
          userPositions={userMarketPositions}
        />
      </div>

      {/* Step 3.5: Borrow Simulation */}
      {showSimulation && selectedLoanAsset && (
        <>
          <SectionConnector active />
          <BorrowSimulation
            selectedMarkets={selectedMarkets}
            selectedAssets={assetsWithBalances.filter((a) =>
              selectedMarkets.some(
                (m) => m.collateralAsset.address.toLowerCase() === a.address.toLowerCase()
              )
            )}
            loanAsset={selectedLoanAsset}
            depositAmounts={simulation.depositAmounts}
            targetLtvs={simulation.targetLtvs}
            simulation={simulation}
            onDepositChange={setDepositAmount}
            onLtvChange={setTargetLtv}
          />
        </>
      )}

      <SectionConnector active={showDeploy} />

      {/* Step 4: Deploy */}
      <div
        className={`transition-all duration-500 ${
          showDeploy
            ? "opacity-100 translate-y-0"
            : "opacity-40 translate-y-2 pointer-events-none"
        }`}
      >
        <DeploySection
          loanSymbol={loanSymbol}
          vaults={vaults}
          selectedVaults={selectedVaults}
          onToggle={toggleVault}
          loading={vaultsLoading}
          error={vaultsError}
          vaultAllocations={vaultAllocations}
          onAllocationChange={setVaultAllocation}
        />
      </div>

      {/* Step 4.5: Withdraw & Redeploy */}
      {showDeploy && withdrawablePositions.length > 0 && (
        <>
          <SectionConnector active />
          <WithdrawSection
            positions={withdrawablePositions}
            isLoading={withdrawLoading}
            withdrawAmounts={withdrawAmounts}
            onWithdrawChange={setWithdrawAmount}
          />
        </>
      )}

      <SectionConnector active={showSummary} />

      {/* Step 5: Summary */}
      <div
        className={`transition-all duration-500 ${
          showSummary
            ? "opacity-100 translate-y-0"
            : "opacity-40 translate-y-2"
        }`}
      >
        <StrategySummary
          loanSymbol={loanSymbol}
          selectedMarkets={selectedMarkets}
          selectedVaults={selectedVaults}
          borrowApy={borrowApy}
          vaultApy={vaultApy}
          combinedApy={combinedApy}
        />
      </div>

      {/* Step 6: Transaction Bundle */}
      {showBundle && selectedLoanAsset && (
        <>
          <SectionConnector active />
          <TransactionBundle
            selectedAssets={selectedAssets}
            depositAmounts={simulation.depositAmounts}
            selectedMarkets={selectedMarkets}
            selectedVaults={selectedVaults}
            selectedLoanAsset={selectedLoanAsset}
            borrowAmount={simulation.borrowAmount}
            totalDepositValueUsd={simulation.totalDepositValueUsd}
            withdrawAmounts={withdrawAmounts}
            withdrawVaults={withdrawVaults}
            vaultAllocations={vaultAllocations}
          />
        </>
      )}
    </div>
  );
}
