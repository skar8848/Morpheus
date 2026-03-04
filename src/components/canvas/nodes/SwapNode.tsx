"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, useReactFlow, useEdges, useNodes, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useChain } from "@/lib/context/ChainContext";
import { useAllAssets } from "@/lib/hooks/useAllAssets";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { useCowQuote } from "@/lib/hooks/useCowQuote";
import type { SwapNodeData } from "@/lib/canvas/types";
import type { Asset } from "@/lib/graphql/types";
import NodeShell from "./NodeShell";
import SearchSelect from "./SearchSelect";

type AssetInfo = { address: string; symbol: string; logoURI: string; decimals: number; name: string };

function SwapNodeComponent({ id, data }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { chainId } = useChain();
  const d = data as unknown as SwapNodeData;
  const edges = useEdges();
  const allNodes = useNodes();
  const { assets, loading: assetsLoading } = useAllAssets();

  const isMainnet = chainId === 1;

  // Detect upstream asset + amount
  const { upstreamAsset, upstreamAmount } = useMemo(() => {
    const incomingEdge = edges.find((e) => e.target === id);
    if (!incomingEdge) return { upstreamAsset: null, upstreamAmount: 0 };
    const sourceNode = allNodes.find((n) => n.id === incomingEdge.source);
    if (!sourceNode) return { upstreamAsset: null, upstreamAmount: 0 };
    const sd = sourceNode.data as Record<string, unknown>;

    if (sd.type === "borrow") {
      const market = sd.market as { loanAsset?: AssetInfo } | null;
      const amt = (sd.borrowAmount as number) ?? 0;
      return { upstreamAsset: market?.loanAsset ?? null, upstreamAmount: amt };
    }
    if (sd.type === "vaultWithdraw") {
      const position = sd.position as { vault: { asset: AssetInfo } } | null;
      const amt = parseFloat((sd.amount as string) || "0");
      return { upstreamAsset: position?.vault.asset ?? null, upstreamAmount: amt };
    }
    return { upstreamAsset: null, upstreamAmount: 0 };
  }, [edges, allNodes, id]);

  // Does tokenIn match the upstream asset?
  const tokenInMatchesUpstream = useMemo(() => {
    if (!upstreamAsset || !d.tokenIn) return false;
    return d.tokenIn.address.toLowerCase() === upstreamAsset.address.toLowerCase();
  }, [upstreamAsset, d.tokenIn]);

  // Auto-set tokenIn when upstream first connects
  const prevUpstreamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!upstreamAsset) {
      prevUpstreamRef.current = null;
      return;
    }
    const addr = upstreamAsset.address.toLowerCase();
    if (addr !== prevUpstreamRef.current) {
      prevUpstreamRef.current = addr;
      const match = assets.find((a) => a.address.toLowerCase() === addr);
      updateNodeData(id, { tokenIn: match ?? upstreamAsset });
    }
  }, [upstreamAsset, assets]);

  // When user changes tokenIn away from upstream, suggest upstream as tokenOut
  const prevTokenInRef = useRef<string | null>(null);
  useEffect(() => {
    if (!upstreamAsset || !d.tokenIn) return;
    const currentAddr = d.tokenIn.address.toLowerCase();
    const upAddr = upstreamAsset.address.toLowerCase();
    // User changed tokenIn away from upstream
    if (prevTokenInRef.current === upAddr && currentAddr !== upAddr && !d.tokenOut) {
      const match = assets.find((a) => a.address.toLowerCase() === upAddr);
      updateNodeData(id, { tokenOut: match ?? upstreamAsset });
    }
    prevTokenInRef.current = currentAddr;
  }, [d.tokenIn, upstreamAsset, assets]);

  // Fetch in-wallet balances for both tokens
  const balanceAssets = useMemo(() => {
    const list: Asset[] = [];
    if (d.tokenIn) list.push(d.tokenIn as Asset);
    if (d.tokenOut && d.tokenOut.address !== d.tokenIn?.address) list.push(d.tokenOut as Asset);
    return list;
  }, [d.tokenIn, d.tokenOut]);
  const { assetsWithBalances } = useTokenBalances(balanceAssets);

  const walletBalanceIn = useMemo(() => {
    if (!d.tokenIn) return 0;
    const found = assetsWithBalances.find((a) => a.address.toLowerCase() === d.tokenIn!.address.toLowerCase());
    return parseFloat(found?.balance ?? "0");
  }, [assetsWithBalances, d.tokenIn]);

  const walletBalanceOut = useMemo(() => {
    if (!d.tokenOut) return 0;
    const found = assetsWithBalances.find((a) => a.address.toLowerCase() === d.tokenOut!.address.toLowerCase());
    return parseFloat(found?.balance ?? "0");
  }, [assetsWithBalances, d.tokenOut]);

  // Available balance for tokenIn: upstream amount if matches, otherwise wallet balance
  const availableIn = tokenInMatchesUpstream ? upstreamAmount : walletBalanceIn;
  const currentAmountIn = parseFloat(d.amountIn || "0");
  const exceedsBalance = availableIn > 0 && currentAmountIn > availableIn;

  // Persist blocked state so downstream edges/nodes can read it
  const prevExceedsRef = useRef(false);
  useEffect(() => {
    if (exceedsBalance !== prevExceedsRef.current) {
      prevExceedsRef.current = exceedsBalance;
      updateNodeData(id, { exceedsBalance });
    }
  }, [exceedsBalance]);

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.address, label: a.symbol, icon: a.logoURI })),
    [assets]
  );

  // CowSwap quote
  const { quote, loading: quoteLoading } = useCowQuote({
    tokenIn: d.tokenIn?.address,
    tokenOut: d.tokenOut?.address,
    amountIn: d.amountIn,
    decimalsIn: d.tokenIn?.decimals ?? 18,
    decimalsOut: d.tokenOut?.decimals ?? 18,
    enabled: isMainnet && !!d.tokenIn && !!d.tokenOut && currentAmountIn > 0,
  });

  // Persist quote to node data so downstream nodes can read it
  const prevQuoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (quote && quote !== prevQuoteRef.current) {
      prevQuoteRef.current = quote;
      updateNodeData(id, { quoteOut: quote });
    } else if (!quote && prevQuoteRef.current) {
      prevQuoteRef.current = null;
      updateNodeData(id, { quoteOut: "" });
    }
  }, [quote]);

  return (
    <NodeShell
      nodeType="swap"
      title="Swap (CowSwap)"
      onDelete={() => deleteElements({ nodes: [{ id }] })}
      invalid={exceedsBalance}
    >
      <div className="space-y-2">
        {!isMainnet && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-[10px] text-yellow-400">
            CowSwap — Ethereum mainnet only
          </div>
        )}

        {/* Token In */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">From</label>
            {d.tokenIn && availableIn > 0 && (
              <span className="text-[9px] text-text-tertiary">
                {tokenInMatchesUpstream ? "Upstream" : "Wallet"}: {availableIn.toFixed(4)}
              </span>
            )}
          </div>
          {assetsLoading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={assetOptions}
              value={d.tokenIn?.address ?? ""}
              onChange={(addr) => {
                const token = assets.find((a) => a.address === addr) ?? null;
                updateNodeData(id, { tokenIn: token });
              }}
              placeholder="Search token..."
            />
          )}
        </div>

        {/* Amount In */}
        <div className="nodrag space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">Amount</label>
            {availableIn > 0 && (
              <button
                type="button"
                onClick={() => updateNodeData(id, { amountIn: availableIn.toFixed(6) })}
                className="text-[9px] text-text-tertiary hover:text-brand transition-colors"
              >
                MAX
              </button>
            )}
          </div>
          <input
            type="number"
            placeholder="0.00"
            className={`w-full rounded-lg border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
              exceedsBalance ? "border-error" : "border-border"
            }`}
            value={d.amountIn}
            onChange={(e) => updateNodeData(id, { amountIn: e.target.value })}
          />
          {exceedsBalance && (
            <p className="text-[10px] text-error">
              Exceeds balance ({availableIn.toFixed(4)} {d.tokenIn?.symbol ?? ""})
            </p>
          )}
          {availableIn > 0 && (
            <>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.min(100, Math.round((currentAmountIn / availableIn) * 100))}
                onChange={(e) => {
                  const p = parseInt(e.target.value);
                  updateNodeData(id, { amountIn: ((availableIn * p) / 100).toFixed(6) });
                }}
                className="w-full accent-yellow-400"
              />
              <div className="flex items-center justify-between rounded-lg bg-bg-primary px-2 py-1">
                <span className="text-[10px] text-text-tertiary">
                  {currentAmountIn.toFixed(4)} {d.tokenIn?.symbol ?? ""}
                </span>
                <span className="text-[10px] text-text-tertiary">
                  of {availableIn.toFixed(4)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M8 13l3-3M8 13l-3-3"
              stroke="var(--text-tertiary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Token Out */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">To</label>
            {d.tokenOut && walletBalanceOut > 0 && (
              <span className="text-[9px] text-text-tertiary">
                Wallet: {walletBalanceOut.toFixed(4)}
              </span>
            )}
          </div>
          {assetsLoading ? (
            <div className="mt-0.5 h-7 animate-pulse rounded-lg bg-bg-secondary" />
          ) : (
            <SearchSelect
              options={assetOptions}
              value={d.tokenOut?.address ?? ""}
              onChange={(addr) => {
                const token = assets.find((a) => a.address === addr) ?? null;
                updateNodeData(id, { tokenOut: token });
              }}
              placeholder="Search token..."
            />
          )}
        </div>

        {/* Quote display */}
        {isMainnet && d.tokenIn && d.tokenOut && currentAmountIn > 0 && (
          <div className="rounded-lg bg-bg-secondary px-2 py-1.5">
            <span className="text-[10px] text-text-tertiary">Estimated output</span>
            {quoteLoading ? (
              <div className="mt-0.5 h-4 animate-pulse rounded bg-bg-primary" />
            ) : quote ? (
              <div className="flex items-center gap-1.5">
                <Image
                  src={d.tokenOut.logoURI}
                  alt={d.tokenOut.symbol}
                  width={14}
                  height={14}
                  className="rounded-full"
                  unoptimized
                />
                <span className="text-xs font-medium text-text-primary">
                  {quote} {d.tokenOut.symbol}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary">No quote available</p>
            )}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-yellow-400 !bg-bg-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-yellow-400 !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(SwapNodeComponent);
