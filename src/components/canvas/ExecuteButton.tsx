"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { Edge } from "@xyflow/react";
import { useAccount, useSendTransaction } from "wagmi";
import { encodeFunctionData } from "viem";
import { useChain } from "@/lib/context/ChainContext";
import { validateGraph } from "@/lib/canvas/validation";
import { formatApy } from "@/lib/utils/format";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/types";
import type { SupportedChainId } from "@/lib/web3/chains";
import {
  BUNDLER3,
  GENERAL_ADAPTER1,
  bundler3Abi,
  generalAdapterAbi,
} from "@/lib/constants/contracts";

interface ExecuteButtonProps {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface BundleStep {
  label: string;
  detail: string;
  type: "approve" | "withdraw" | "supply" | "borrow" | "deposit" | "swap";
  icon: string;
}

const typeColors: Record<string, string> = {
  approve: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
  withdraw: "text-orange-400 border-orange-400/20 bg-orange-400/5",
  supply: "text-brand border-brand/20 bg-brand/5",
  borrow: "text-success border-success/20 bg-success/5",
  deposit: "text-purple-400 border-purple-400/20 bg-purple-400/5",
  swap: "text-amber-400 border-amber-400/20 bg-amber-400/5",
};

const typeLabels: Record<string, string> = {
  approve: "APPROVE",
  withdraw: "WITHDRAW",
  supply: "SUPPLY",
  borrow: "BORROW",
  deposit: "DEPOSIT",
  swap: "SWAP",
};

function topologicalSort(nodes: CanvasNode[], edges: Edge[]): CanvasNode[] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

export default function ExecuteButton({ nodes, edges }: ExecuteButtonProps) {
  const { address, isConnected } = useAccount();
  const { chainId } = useChain();
  const { sendTransaction, isPending } = useSendTransaction();
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Build visual steps from graph (same order as execution)
  const steps = useMemo(() => {
    const sorted = topologicalSort(nodes, edges);
    const s: BundleStep[] = [];

    for (const node of sorted) {
      const d = node.data as CanvasNodeData;

      switch (d.type) {
        case "vaultWithdraw": {
          if (!d.position || !d.amount || parseFloat(d.amount) <= 0) break;
          s.push({
            label: `Withdraw from ${d.position.vault.name}`,
            detail: `${parseFloat(d.amount).toFixed(4)} ${d.position.vault.asset.symbol}`,
            type: "withdraw",
            icon: d.position.vault.asset.logoURI,
          });
          break;
        }
        case "supplyCollateral": {
          if (!d.asset || !d.amount || parseFloat(d.amount) <= 0) break;
          s.push({
            label: `Approve ${d.asset.symbol}`,
            detail: `${parseFloat(d.amount).toFixed(4)} ${d.asset.symbol}`,
            type: "approve",
            icon: d.asset.logoURI,
          });
          s.push({
            label: `Supply ${d.asset.symbol} collateral`,
            detail: `${parseFloat(d.amount).toFixed(4)} ${d.asset.symbol}`,
            type: "supply",
            icon: d.asset.logoURI,
          });
          break;
        }
        case "borrow": {
          if (!d.market || d.borrowAmount <= 0) break;
          s.push({
            label: `Borrow ${d.market.loanAsset.symbol}`,
            detail: `$${d.borrowAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} — ${formatApy(d.market.state.netBorrowApy)}`,
            type: "borrow",
            icon: d.market.loanAsset.logoURI,
          });
          break;
        }
        case "swap": {
          if (!d.tokenIn || !d.tokenOut) break;
          s.push({
            label: `Swap ${d.tokenIn.symbol} → ${d.tokenOut.symbol}`,
            detail: d.amountIn ? `${d.amountIn} ${d.tokenIn.symbol}` : "Pending quote",
            type: "swap",
            icon: d.tokenIn.logoURI,
          });
          break;
        }
        case "vaultDeposit": {
          if (!d.vault || !d.amount || parseFloat(d.amount) <= 0) break;
          s.push({
            label: `Deposit into ${d.vault.name}`,
            detail: `${parseFloat(d.amount).toFixed(4)} ${d.vault.asset.symbol} — ${formatApy(d.vault.state.netApy)}`,
            type: "deposit",
            icon: d.vault.asset.logoURI,
          });
          break;
        }
      }
    }
    return s;
  }, [nodes, edges]);

  // Build and send the bundler transaction
  const handleExecute = () => {
    if (!address || !isConnected) return;
    setError(null);
    setTxHash(null);

    const errors = validateGraph(nodes, edges);
    setValidationErrors(errors);
    if (errors.length > 0) return;

    try {
      const adapter = GENERAL_ADAPTER1[chainId as SupportedChainId];
      const bundler = BUNDLER3[chainId as SupportedChainId];
      if (!adapter || !bundler) {
        setError("Chain not supported");
        return;
      }

      const zeroHash =
        "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

      const calls: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: bigint;
        skipRevert: boolean;
        callbackHash: `0x${string}`;
      }[] = [];

      let hasSwap = false;
      const sorted = topologicalSort(nodes, edges);

      for (const node of sorted) {
        const d = node.data as CanvasNodeData;

        switch (d.type) {
          case "vaultWithdraw": {
            if (!d.position || !d.amount || parseFloat(d.amount) <= 0) break;
            const shares = BigInt(
              Math.floor(parseFloat(d.amount) * 10 ** d.position.vault.asset.decimals)
            );
            calls.push({
              to: adapter,
              data: encodeFunctionData({
                abi: generalAdapterAbi,
                functionName: "erc4626Redeem",
                args: [
                  d.position.vault.address as `0x${string}`,
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
            break;
          }

          case "supplyCollateral": {
            if (!d.asset || !d.amount || parseFloat(d.amount) <= 0) break;
            const rawAmount = BigInt(
              Math.floor(parseFloat(d.amount) * 10 ** d.asset.decimals)
            );
            // Transfer collateral to adapter
            calls.push({
              to: adapter,
              data: encodeFunctionData({
                abi: generalAdapterAbi,
                functionName: "erc20TransferFrom",
                args: [d.asset.address as `0x${string}`, adapter, rawAmount],
              }),
              value: 0n,
              skipRevert: false,
              callbackHash: zeroHash,
            });

            // Find downstream borrow market to supply collateral into
            const downEdge = edges.find((e) => e.source === node.id);
            if (downEdge) {
              const borrowNode = nodes.find((n) => n.id === downEdge.target);
              if (borrowNode) {
                const bd = borrowNode.data as CanvasNodeData;
                if (bd.type === "borrow" && bd.market) {
                  const marketParams = {
                    loanToken: bd.market.loanAsset.address as `0x${string}`,
                    collateralToken: bd.market.collateralAsset.address as `0x${string}`,
                    oracle: bd.market.oracle.address as `0x${string}`,
                    irm: bd.market.irmAddress as `0x${string}`,
                    lltv: BigInt(bd.market.lltv),
                  };
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
              }
            }
            break;
          }

          case "borrow": {
            if (!d.market || d.borrowAmount <= 0) break;
            const rawBorrow = BigInt(
              Math.floor(d.borrowAmount * 10 ** d.market.loanAsset.decimals)
            );
            const marketParams = {
              loanToken: d.market.loanAsset.address as `0x${string}`,
              collateralToken: d.market.collateralAsset.address as `0x${string}`,
              oracle: d.market.oracle.address as `0x${string}`,
              irm: d.market.irmAddress as `0x${string}`,
              lltv: BigInt(d.market.lltv),
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
            break;
          }

          case "vaultDeposit": {
            if (!d.vault || !d.amount || parseFloat(d.amount) <= 0) break;
            const rawDeposit = BigInt(
              Math.floor(parseFloat(d.amount) * 10 ** d.vault.asset.decimals)
            );
            calls.push({
              to: adapter,
              data: encodeFunctionData({
                abi: generalAdapterAbi,
                functionName: "erc4626Deposit",
                args: [
                  d.vault.address as `0x${string}`,
                  rawDeposit,
                  BigInt("1000000000000000000000000000"),
                  address,
                ],
              }),
              value: 0n,
              skipRevert: false,
              callbackHash: zeroHash,
            });
            break;
          }

          case "swap": {
            hasSwap = true;
            break;
          }
        }
      }

      if (calls.length === 0 && !hasSwap) {
        setError("No executable actions in graph");
        return;
      }

      if (hasSwap) {
        setError(
          "Graph contains swap nodes. CowSwap orders will be submitted separately after the bundler tx."
        );
      }

      if (calls.length > 0) {
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build bundle");
    }
  };

  // Count actionable nodes
  const actionCount = nodes.filter((n) => {
    const t = (n.data as { type: string }).type;
    return t !== "wallet" && t !== "position";
  }).length;

  if (actionCount === 0) return null;

  return (
    <div
      className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Collapsed tab — always visible, sticking out from the bottom */}
      <div
        className={`rounded-t-2xl border border-b-0 border-border bg-bg-card/95 shadow-2xl backdrop-blur-md transition-all duration-300 ${
          expanded ? "w-[520px]" : "w-[320px]"
        }`}
      >
        {/* Tab handle */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/15">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary">
              Execute Strategy
            </span>
          </div>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Expandable summary — slides down on hover */}
        <div
          className={`overflow-hidden transition-all duration-300 ${
            expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="border-t border-border px-5 py-4">
            {/* Steps timeline */}
            {steps.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-gradient-to-b from-brand via-success to-purple-400 opacity-30" />

                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div key={i} className="relative flex items-center gap-3">
                      {/* Step number */}
                      <div
                        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${typeColors[step.type]}`}
                      >
                        {i + 1}
                      </div>
                      {/* Step content */}
                      <div className="flex flex-1 items-center justify-between rounded-lg border border-border bg-bg-secondary px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Image
                            src={step.icon}
                            alt=""
                            width={16}
                            height={16}
                            className="rounded-full"
                            unoptimized
                          />
                          <div>
                            <p className="text-xs font-medium text-text-primary">
                              {step.label}
                            </p>
                            <p className="text-[10px] text-text-tertiary">
                              {step.detail}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${typeColors[step.type]}`}
                        >
                          {typeLabels[step.type]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">
                Configure your nodes to see the execution plan
              </p>
            )}

            {/* Errors */}
            {validationErrors.length > 0 && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-[10px] text-error">{err}</p>
                ))}
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-[10px] text-error">
                {error}
              </div>
            )}
            {txHash && (
              <div className="mt-3 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[10px] text-success">
                TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </div>
            )}

            {/* Summary bar */}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[10px] text-text-tertiary">
              <span>{steps.length} action{steps.length !== 1 ? "s" : ""}</span>
              <span>1 bundled transaction</span>
            </div>

            {/* Execute button */}
            <button
              onClick={handleExecute}
              disabled={!isConnected || isPending || steps.length === 0}
              className="mt-3 w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!isConnected
                ? "Connect Wallet"
                : isPending
                  ? "Confirming..."
                  : `Execute Bundle (${steps.length} actions)`}
            </button>
            <p className="mt-1.5 text-center text-[9px] text-text-tertiary">
              Requires ERC-20 approval to Bundler adapter
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
