"use client";

import Image from "next/image";
import { formatUsd } from "@/lib/utils/format";
import { useChain } from "@/lib/context/ChainContext";
import type { MorphoTransaction, TransactionType } from "@/lib/graphql/types";

const EXPLORER_BASE: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
};

interface Props {
  transactions: MorphoTransaction[];
  loadMore: () => void;
  hasMore: boolean;
}

const TX_LABELS: Record<TransactionType, string> = {
  MetaMorphoDeposit: "Vault Deposit",
  MetaMorphoWithdraw: "Vault Withdraw",
  MetaMorphoTransfer: "Vault Transfer",
  MetaMorphoFee: "Vault Fee",
  MarketBorrow: "Borrow",
  MarketLiquidation: "Liquidation",
  MarketRepay: "Repay",
  MarketSupply: "Supply",
  MarketSupplyCollateral: "Supply Collateral",
  MarketWithdraw: "Withdraw",
  MarketWithdrawCollateral: "Withdraw Collateral",
};

const TX_COLORS: Record<string, string> = {
  MetaMorphoDeposit: "bg-purple-500",
  MetaMorphoWithdraw: "bg-orange-400",
  MetaMorphoTransfer: "bg-gray-400",
  MetaMorphoFee: "bg-gray-400",
  MarketBorrow: "bg-teal-500",
  MarketLiquidation: "bg-red-500",
  MarketRepay: "bg-teal-400",
  MarketSupply: "bg-blue-500",
  MarketSupplyCollateral: "bg-blue-500",
  MarketWithdraw: "bg-orange-400",
  MarketWithdrawCollateral: "bg-orange-400",
};

const TX_ICONS: Record<string, string> = {
  MetaMorphoDeposit: "M5 12l5 5 5-5M10 17V3",
  MetaMorphoWithdraw: "M5 8l5-5 5 5M10 3v14",
  MarketBorrow: "M5 8l5-5 5 5M10 3v14",
  MarketRepay: "M5 12l5 5 5-5M10 17V3",
  MarketSupply: "M5 12l5 5 5-5M10 17V3",
  MarketSupplyCollateral: "M5 12l5 5 5-5M10 17V3",
  MarketWithdraw: "M5 8l5-5 5 5M10 3v14",
  MarketWithdrawCollateral: "M5 8l5-5 5 5M10 3v14",
  MarketLiquidation: "M4 4l12 12M16 4L4 16",
};

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

function getTransactionDetails(tx: MorphoTransaction) {
  const { data, type } = tx;

  if (data.__typename === "VaultTransactionData") {
    const decimals = data.vault.asset.decimals;
    const amount = Number(data.assets) / 10 ** decimals;
    return {
      asset: data.vault.asset.symbol,
      icon: data.vault.asset.logoURI,
      amount,
      usd: data.assetsUsd,
      context: data.vault.name,
    };
  }

  if (data.__typename === "MarketCollateralTransferTransactionData") {
    const collat = data.market.collateralAsset;
    const decimals = collat?.decimals ?? 18;
    const amount = Number(data.assets) / 10 ** decimals;
    return {
      asset: collat?.symbol ?? "?",
      icon: collat?.logoURI ?? "",
      amount,
      usd: data.assetsUsd,
      context: `${collat?.symbol ?? "?"}/${data.market.loanAsset.symbol}`,
    };
  }

  if (data.__typename === "MarketLiquidationTransactionData") {
    const collat = data.market.collateralAsset;
    const seizedDecimals = collat?.decimals ?? 18;
    const seizedAmt = Number(data.seizedAssets) / 10 ** seizedDecimals;
    return {
      asset: collat?.symbol ?? "?",
      icon: collat?.logoURI ?? "",
      amount: seizedAmt,
      usd: data.seizedAssetsUsd,
      context: `${collat?.symbol ?? "?"}/${data.market.loanAsset.symbol}`,
    };
  }

  if (data.__typename === "MarketTransferTransactionData") {
    // For borrow/repay/supply/withdraw — the asset is the loan asset
    const isCollateralType =
      type === "MarketSupplyCollateral" || type === "MarketWithdrawCollateral";
    const asset = isCollateralType
      ? data.market.collateralAsset
      : data.market.loanAsset;
    const decimals = asset?.decimals ?? 18;
    const amount = Number(data.assets) / 10 ** decimals;
    return {
      asset: asset?.symbol ?? "?",
      icon: asset?.logoURI ?? "",
      amount,
      usd: data.assetsUsd,
      context: `${data.market.collateralAsset?.symbol ?? "?"}/${data.market.loanAsset.symbol}`,
    };
  }

  return { asset: "?", icon: "", amount: 0, usd: null, context: "" };
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
  const label = TX_LABELS[tx.type] ?? tx.type;
  const dotColor = TX_COLORS[tx.type] ?? "bg-gray-400";
  const iconPath = TX_ICONS[tx.type] ?? "M10 3v14";
  const isLiquidation = tx.type === "MarketLiquidation";
  const isInflow =
    tx.type === "MarketSupply" ||
    tx.type === "MarketSupplyCollateral" ||
    tx.type === "MetaMorphoDeposit" ||
    tx.type === "MarketRepay";

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
          {details.usd != null && details.usd > 0 && (
            <div className="text-[10px] text-text-tertiary">
              {formatUsd(details.usd)}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}
