"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useAccount, useSendTransaction } from "wagmi";
import { encodeFunctionData } from "viem";
import type { Asset, Market, Vault } from "@/lib/graphql/types";
import {
  BUNDLER3,
  GENERAL_ADAPTER1,
  bundler3Abi,
  generalAdapterAbi,
} from "@/lib/constants/contracts";
import type { SupportedChainId } from "@/lib/web3/chains";
import { useChain } from "@/lib/context/ChainContext";
import { formatUsd } from "@/lib/utils/format";

interface BundleStep {
  label: string;
  detail: string;
  type: "approve" | "withdraw" | "supply" | "borrow" | "deposit";
  icon: string;
}

interface TransactionBundleProps {
  selectedAssets: Asset[];
  depositAmounts: Record<string, string>;
  selectedMarkets: Market[];
  selectedVaults: Vault[];
  selectedLoanAsset: Asset | null;
  borrowAmount: number;
  totalDepositValueUsd: number;
  withdrawAmounts: Record<string, string>;
  withdrawVaults: Vault[];
  vaultAllocations: Record<string, number>;
}

export default function TransactionBundle({
  selectedAssets,
  depositAmounts,
  selectedMarkets,
  selectedVaults,
  selectedLoanAsset,
  borrowAmount,
  totalDepositValueUsd,
  withdrawAmounts,
  withdrawVaults,
  vaultAllocations,
}: TransactionBundleProps) {
  const { address, isConnected } = useAccount();
  const { chainId } = useChain();
  const { sendTransaction, isPending } = useSendTransaction();
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build the visual steps
  const steps = useMemo(() => {
    const s: BundleStep[] = [];

    // 1. Withdrawals from existing vaults
    for (const vault of withdrawVaults) {
      const amount = withdrawAmounts[vault.address];
      if (!amount || parseFloat(amount) <= 0) continue;
      s.push({
        label: `Withdraw from ${vault.name}`,
        detail: `${parseFloat(amount).toFixed(4)} ${vault.asset.symbol}`,
        type: "withdraw",
        icon: vault.asset.logoURI,
      });
    }

    // 2. Approve collateral tokens
    for (const asset of selectedAssets) {
      const amount = depositAmounts[asset.address];
      if (!amount || parseFloat(amount) <= 0) continue;
      s.push({
        label: `Approve ${asset.symbol}`,
        detail: `${parseFloat(amount).toFixed(4)} ${asset.symbol}`,
        type: "approve",
        icon: asset.logoURI,
      });
    }

    // 3. Supply collateral
    for (const asset of selectedAssets) {
      const amount = depositAmounts[asset.address];
      if (!amount || parseFloat(amount) <= 0) continue;
      const market = selectedMarkets.find(
        (m) =>
          m.collateralAsset.address.toLowerCase() ===
          asset.address.toLowerCase()
      );
      if (!market) continue;
      s.push({
        label: `Supply ${asset.symbol} collateral`,
        detail: `${parseFloat(amount).toFixed(4)} ${asset.symbol} → ${market.collateralAsset.symbol}/${market.loanAsset.symbol}`,
        type: "supply",
        icon: asset.logoURI,
      });
    }

    // 4. Borrow loan asset
    if (borrowAmount > 0 && selectedLoanAsset) {
      s.push({
        label: `Borrow ${selectedLoanAsset.symbol}`,
        detail: `${borrowAmount.toFixed(2)} ${selectedLoanAsset.symbol}`,
        type: "borrow",
        icon: selectedLoanAsset.logoURI,
      });
    }

    // 5. Deposit into vaults using allocations
    if (selectedVaults.length > 0 && borrowAmount > 0 && selectedLoanAsset) {
      const totalAlloc = selectedVaults.reduce(
        (sum, v) => sum + (vaultAllocations[v.address] ?? 0),
        0
      );
      for (const vault of selectedVaults) {
        const pct = vaultAllocations[vault.address] ?? 0;
        const vaultAmount = totalAlloc > 0
          ? (borrowAmount * pct) / totalAlloc
          : borrowAmount / selectedVaults.length;
        if (vaultAmount <= 0) continue;
        s.push({
          label: `Deposit into ${vault.name}`,
          detail: `${vaultAmount.toFixed(2)} ${selectedLoanAsset.symbol} (${totalAlloc > 0 ? Math.round((pct / totalAlloc) * 100) : Math.round(100 / selectedVaults.length)}%)`,
          type: "deposit",
          icon:
            vault.asset.logoURI ||
            `https://cdn.morpho.org/assets/logos/${vault.asset.symbol.toLowerCase()}.svg`,
        });
      }
    }

    return s;
  }, [
    selectedAssets,
    depositAmounts,
    selectedMarkets,
    selectedVaults,
    selectedLoanAsset,
    borrowAmount,
    withdrawAmounts,
    withdrawVaults,
    vaultAllocations,
  ]);

  const handleExecute = () => {
    if (!address || !isConnected) return;
    setError(null);
    setTxHash(null);

    try {
      const adapter = GENERAL_ADAPTER1[chainId as SupportedChainId];
      const bundler = BUNDLER3[chainId as SupportedChainId];
      if (!adapter || !bundler) {
        setError("Chain not supported");
        return;
      }

      const calls: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: bigint;
        skipRevert: boolean;
        callbackHash: `0x${string}`;
      }[] = [];

      const zeroHash =
        "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

      // Encode withdraw calls
      for (const vault of withdrawVaults) {
        const amount = withdrawAmounts[vault.address];
        if (!amount || parseFloat(amount) <= 0) continue;
        const shares = BigInt(
          Math.floor(parseFloat(amount) * 10 ** vault.asset.decimals)
        );
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Redeem",
            args: [
              vault.address as `0x${string}`,
              shares,
              0n,
              address,
              address,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: zeroHash,
        });
      }

      // Encode transfer + supply collateral + borrow for each market
      for (const market of selectedMarkets) {
        const asset = selectedAssets.find(
          (a) =>
            a.address.toLowerCase() ===
            market.collateralAsset.address.toLowerCase()
        );
        if (!asset) continue;
        const amount = depositAmounts[asset.address];
        if (!amount || parseFloat(amount) <= 0) continue;

        const rawAmount = BigInt(
          Math.floor(parseFloat(amount) * 10 ** asset.decimals)
        );

        const marketParams = {
          loanToken: market.loanAsset.address as `0x${string}`,
          collateralToken: market.collateralAsset.address as `0x${string}`,
          oracle: market.oracle.address as `0x${string}`,
          irm: market.irmAddress as `0x${string}`,
          lltv: BigInt(market.lltv),
        };

        // Transfer collateral to adapter
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc20TransferFrom",
            args: [asset.address as `0x${string}`, adapter, rawAmount],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: zeroHash,
        });

        // Supply collateral
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoSupplyCollateral",
            args: [marketParams, rawAmount, address, "0x"],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: zeroHash,
        });
      }

      // Borrow from first selected market
      if (
        borrowAmount > 0 &&
        selectedLoanAsset &&
        selectedMarkets.length > 0
      ) {
        const market = selectedMarkets[0];
        const rawBorrow = BigInt(
          Math.floor(borrowAmount * 10 ** selectedLoanAsset.decimals)
        );
        const marketParams = {
          loanToken: market.loanAsset.address as `0x${string}`,
          collateralToken: market.collateralAsset.address as `0x${string}`,
          oracle: market.oracle.address as `0x${string}`,
          irm: market.irmAddress as `0x${string}`,
          lltv: BigInt(market.lltv),
        };
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [marketParams, rawBorrow, 0n, 0n, address],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: zeroHash,
        });
      }

      // Deposit into vaults using allocations
      if (
        selectedVaults.length > 0 &&
        borrowAmount > 0 &&
        selectedLoanAsset
      ) {
        const totalAlloc = selectedVaults.reduce(
          (sum, v) => sum + (vaultAllocations[v.address] ?? 0),
          0
        );
        for (const vault of selectedVaults) {
          const pct = vaultAllocations[vault.address] ?? 0;
          const vaultAmount = totalAlloc > 0
            ? (borrowAmount * pct) / totalAlloc
            : borrowAmount / selectedVaults.length;
          if (vaultAmount <= 0) continue;
          const rawVaultAmount = BigInt(
            Math.floor(vaultAmount * 10 ** selectedLoanAsset.decimals)
          );
          calls.push({
            to: adapter,
            data: encodeFunctionData({
              abi: generalAdapterAbi,
              functionName: "erc4626Deposit",
              args: [
                vault.address as `0x${string}`,
                rawVaultAmount,
                BigInt("1000000000000000000000000000"),
                address,
              ],
            }),
            value: 0n,
            skipRevert: false,
            callbackHash: zeroHash,
          });
        }
      }

      if (calls.length === 0) {
        setError("No actions to execute");
        return;
      }

      sendTransaction(
        {
          to: bundler,
          data: encodeFunctionData({
            abi: bundler3Abi,
            functionName: "multicall",
            args: [calls],
          }),
          value: 0n,
        },
        {
          onSuccess: (hash) => setTxHash(hash),
          onError: (err) => setError(err.message),
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build bundle");
    }
  };

  if (steps.length === 0) return null;

  const typeColors: Record<string, string> = {
    approve: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
    withdraw: "text-orange-400 border-orange-400/20 bg-orange-400/5",
    supply: "text-brand border-brand/20 bg-brand/5",
    borrow: "text-success border-success/20 bg-success/5",
    deposit: "text-purple-400 border-purple-400/20 bg-purple-400/5",
  };

  const typeLabels: Record<string, string> = {
    approve: "APPROVE",
    withdraw: "WITHDRAW",
    supply: "SUPPLY",
    borrow: "BORROW",
    deposit: "DEPOSIT",
  };

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Transaction Bundle
        </h2>
        <p className="mt-0.5 text-sm text-text-tertiary">
          All steps batched into a single transaction via Morpho Bundler
        </p>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-bg-card p-6">
        {/* Steps timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-gradient-to-b from-brand via-success to-purple-400 opacity-30" />

          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-4 relative">
                {/* Step number circle */}
                <div
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${typeColors[step.type]}`}
                >
                  {i + 1}
                </div>

                {/* Step content */}
                <div className="flex-1 flex items-center justify-between rounded-xl border border-border bg-bg-secondary px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Image
                      src={step.icon}
                      alt=""
                      width={24}
                      height={24}
                      className="rounded-full"
                      unoptimized
                    />
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {step.label}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeColors[step.type]}`}
                  >
                    {typeLabels[step.type]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary bar */}
        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-bg-secondary px-4 py-3">
          <div className="flex items-center gap-4 text-xs text-text-tertiary">
            <span>
              {steps.length} action{steps.length !== 1 ? "s" : ""}
            </span>
            <span>1 transaction</span>
            {totalDepositValueUsd > 0 && (
              <span>Total value: {formatUsd(totalDepositValueUsd)}</span>
            )}
          </div>
        </div>

        {/* Execute button */}
        <div className="mt-4">
          {error && (
            <div className="mb-3 rounded-lg border border-error/20 bg-error/5 px-4 py-2 text-xs text-error">
              {error}
            </div>
          )}
          {txHash && (
            <div className="mb-3 rounded-lg border border-success/20 bg-success/5 px-4 py-2 text-xs text-success">
              Transaction sent:{" "}
              <span className="font-mono">
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </span>
            </div>
          )}
          <button
            onClick={handleExecute}
            disabled={!isConnected || isPending}
            className="w-full rounded-xl bg-brand py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {!isConnected
              ? "Connect Wallet to Execute"
              : isPending
                ? "Confirming..."
                : `Execute Bundle (${steps.length} actions)`}
          </button>
          <p className="mt-2 text-center text-[10px] text-text-tertiary">
            Requires ERC-20 approval to the Bundler adapter before first use
          </p>
        </div>
      </div>
    </section>
  );
}
