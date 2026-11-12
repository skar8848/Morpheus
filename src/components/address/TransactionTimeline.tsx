// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import type { MarketTransaction, MorphoTransaction, VaultTransaction } from "@/lib/graphql/types";

const EXPLORER_BASE: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
};

interface Props {
  transactions: MorphoTransaction[];
  loadMore: () => void;
  hasMore: boolean;
}

/**
 * Keyed on `surface:type`: the API reuses "Withdraw" for a market withdraw and
 * a vault withdraw, which are labelled differently here.
 */
type TxKey =
  | `market:${MarketTransaction["type"]}`
  | `vault:${VaultTransaction["type"]}`;

const txKey = (tx: MorphoTransaction) => `${tx.surface}:${tx.type}` as TxKey;

const TX_LABELS: Record<TxKey, string> = {
  "vault:Deposit": "Vault Deposit",
  "vault:Withdraw": "Vault Withdraw",
  "vault:Transfer": "Vault Transfer",
  "market:Borrow": "Borrow",
  "market:Liquidation": "Liquidation",
  "market:Repay": "Repay",
  "market:Supply": "Supply",
  "market:SupplyCollateral": "Supply Collateral",
  "market:Withdraw": "Withdraw",
  "market:WithdrawCollateral": "Withdraw Collateral",
};

const TX_COLORS: Record<TxKey, string> = {
  "vault:Deposit": "bg-purple-500",
  "vault:Withdraw": "bg-orange-400",
  "vault:Transfer": "bg-gray-400",
  "market:Borrow": "bg-teal-500",
  "market:Liquidation": "bg-red-500",
  "market:Repay": "bg-teal-400",
  "market:Supply": "bg-blue-500",
  "market:SupplyCollateral": "bg-blue-500",
  "market:Withdraw": "bg-orange-400",
  "market:WithdrawCollateral": "bg-orange-400",
};

const TX_ICONS: Partial<Record<TxKey, string>> = {
  "vault:Deposit": "M5 12l5 5 5-5M10 17V3",
  "vault:Withdraw": "M5 8l5-5 5 5M10 3v14",
  "market:Borrow": "M5 8l5-5 5 5M10 3v14",
  "market:Repay": "M5 12l5 5 5-5M10 17V3",
  "market:Supply": "M5 12l5 5 5-5M10 17V3",
  "market:SupplyCollateral": "M5 12l5 5 5-5M10 17V3",
  "market:Withdraw": "M5 8l5-5 5 5M10 3v14",
  "market:WithdrawCollateral": "M5 8l5-5 5 5M10 3v14",
  "market:Liquidation": "M4 4l12 12M16 4L4 16",
};

const INFLOW: ReadonlySet<TxKey> = new Set<TxKey>([
  "market:Supply",
  "market:SupplyCollateral",
  "market:Repay",
  "vault:Deposit",
]);

function formatTimestamp(ts: string): string {
  const date = new Date(Number(ts) * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** Human amount from a raw BigInt scalar (a JSON number or string). */
function toAmount(raw: string | number | undefined, decimals: number): number {
  return Number(raw ?? 0) / 10 ** decimals;
}

function getTransactionDetails(tx: MorphoTransaction) {
  if (tx.surface === "vault") {
    return {
      asset: tx.vault.asset.symbol,
      icon: tx.vault.asset.logoURI,
      amount: toAmount(tx.assets, tx.vault.asset.decimals),
      context: tx.vault.name,
    };
  }

  const { market, data } = tx;
  const collat = market.collateralAsset;
  const context = `${collat?.symbol ?? "?"}/${market.loanAsset.symbol}`;

  // A liquidation is shown as the collateral it seized; collateral transfers
  // move the collateral asset; every other market event moves the loan asset.
  if (data.__typename === "MarketTransactionLiquidationData") {
    return {
      asset: collat?.symbol ?? "?",
      icon: collat?.logoURI ?? "",
      amount: toAmount(data.seizedAssets, collat?.decimals ?? 18),
      context,
    };
  }

  const asset =
    data.__typename === "MarketTransactionCollateralTransferData" ? collat : market.loanAsset;
  return {
    asset: asset?.symbol ?? "?",
    icon: asset?.logoURI ?? "",
    amount: toAmount(data.assets, asset?.decimals ?? 18),
    context,
  };
}

// Group transactions by date
function groupByDate(txs: MorphoTransaction[]): Map<string, MorphoTransaction[]> {
  const groups = new Map<string, MorphoTransaction[]>();
  for (const tx of txs) {
    const date = new Date(Number(tx.timestamp) * 1000);
    const key = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const arr = groups.get(key) ?? [];
    arr.push(tx);
    groups.set(key, arr);
  }
  return groups;
}

export default function TransactionTimeline({
  transactions,
  loadMore,
  hasMore,
}: Props) {
  const { chainId } = useChain();
  const explorerBase = EXPLORER_BASE[chainId] ?? "https://etherscan.io";
  const grouped = groupByDate(transactions);

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        Transaction History
      </h3>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([date, txs]) => (
          <div key={date}>
            <div className="mb-2 text-[11px] font-medium text-text-tertiary">{date}</div>
            <div className="space-y-1">
              {txs.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} explorerBase={explorerBase} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          className="mt-4 w-full rounded-xl border border-border bg-bg-card py-2.5 text-xs text-text-tertiary transition-colors hover:text-text-primary"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function isValidTxHash(hash: string): boolean {
  return /^0x[a-f0-9]{64}$/i.test(hash);
}

function TransactionRow({ tx, explorerBase }: { tx: MorphoTransaction; explorerBase: string }) {
  const details = getTransactionDetails(tx);
  const key = txKey(tx);
  const label = TX_LABELS[key] ?? tx.type;
  const dotColor = TX_COLORS[key] ?? "bg-gray-400";
  const iconPath = TX_ICONS[key] ?? "M10 3v14";
  const isLiquidation = key === "market:Liquidation";
  const isInflow = INFLOW.has(key);

  const txUrl = isValidTxHash(tx.hash)
    ? `${explorerBase}/tx/${tx.hash}`
    : undefined;

  return (
    <a
      href={txUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-bg-secondary"
    >
      {/* Icon dot */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${dotColor}/10`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          className={dotColor.replace("bg-", "text-")}
        >
          <path
            d={iconPath}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Label + context */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              isLiquidation ? "text-error" : "text-text-primary"
            }`}
          >
            {label}
          </span>
          {details.context && (
            <span className="truncate text-[11px] text-text-tertiary">
              {details.context}
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-tertiary">
          {formatTimestamp(tx.timestamp)}
        </span>
      </div>

      {/* Asset + amount */}
      <div className="flex items-center gap-2">
        {details.icon && (
          <Image
            src={details.icon}
            alt={details.asset}
            width={16}
            height={16}
            className="rounded-full"
            unoptimized
          />
        )}
        <div className="text-right">
          <span
            className={`text-sm font-medium ${
              isLiquidation
                ? "text-error"
                : isInflow
                  ? "text-success"
                  : "text-text-primary"
            }`}
          >
            {isInflow ? "+" : isLiquidation ? "-" : ""}
            {details.amount >= 1000
              ? details.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : details.amount.toFixed(4)}{" "}
            {details.asset}
          </span>
        </div>
      </div>
    </a>
  );
}