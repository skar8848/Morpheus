// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { memo, useMemo } from "react";
import { Handle, Position, useEdges, useNodes, useReactFlow, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { COLLATERAL_ASSETS } from "@/lib/constants/assets";
import type { SupportedChainId } from "@/lib/web3/chains";
import type { WalletNodeData } from "@/lib/canvas/types";
import { isAddress } from "viem";
import { saveImportedStrategy } from "@/lib/canvas/importStrategy";
import { safeAppDeepLink, SAFE_CHAIN_PREFIX } from "@/lib/web3/safeBatch";
import type { CanvasNode } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";

function WalletNodeComponent({ id, data }: NodeProps) {
  const { address, isConnected } = useAccount();
  const { updateNodeData } = useReactFlow();
  const edges = useEdges();
  const allNodes = useNodes();
  const isUsed = useMemo(() => edges.some((e) => e.source === id), [edges, id]);
  const { slug, chainId } = useChain();
  const assets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];

  const d = data as unknown as WalletNodeData;
  const safeMode = !!d.safeMode;
  const safeAddress = (d.safeAddress ?? "").trim();
  const safeValid = isAddress(safeAddress);

  // In Safe mode the funds are the Safe's, so the whole strategy — balances
  // included — must be read against that address, not the connected signer.
  const { assetsWithBalances, isLoading } = useTokenBalances(
    assets,
    safeMode && safeValid ? (safeAddress as `0x${string}`) : undefined
  );

  const activeAddress = safeMode && safeValid ? safeAddress : address;
  const displayAddress = activeAddress
    ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}`
    : "Not connected";

  /**
   * Hand the finished strategy to the Safe interface: Morpheus opens there as a
   * Safe App with the graph preloaded, so the batch is prepared rather than
   * rebuilt by hand in the transaction builder.
   */
  const openInSafe = () => {
    if (!safeValid) return;
    const prefix = SAFE_CHAIN_PREFIX[chainId];
    if (!prefix) return;

    // Hand the strategy over through localStorage, NOT the URL. Safe nests our
    // appUrl inside its own link, and a base64 strategy pushed the request past
    // the 8 KB header limit — S3 answered RequestHeaderSectionTooLarge. Inside
    // the Safe iframe Morpheus still runs on this origin, so it reads the very
    // same localStorage the canvas wrote here.
    saveImportedStrategy({
      nodes: allNodes as CanvasNode[],
      edges,
      sourceAddress: safeAddress,
    });

    const appUrl = `${window.location.origin}/${slug}/canvas`;
    window.open(safeAppDeepLink({ safeAddress, chainPrefix: prefix, appUrl }), "_blank", "noopener");
  };

  const nonZeroBalances = assetsWithBalances.filter(
    (a) => a.balanceRaw > 0n
  );

  return (
    <NodeShell nodeType="wallet" title="Wallet" dimmed={!isUsed} loading={isLoading}>
      <div className="space-y-2">
        {/* Safe mode — build for a Safe instead of the connected signer */}
        <div className="nodrag rounded-lg border border-border bg-bg-secondary px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">Safe</span>
            <button
              type="button"
              onClick={() => updateNodeData(id, { safeMode: !safeMode })}
              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                safeMode ? "bg-brand/15 text-brand" : "bg-bg-card text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {safeMode ? "On" : "Off"}
            </button>
          </div>

          {safeMode && (
            <div className="mt-1.5 space-y-1">
              <input
                type="text"
                spellCheck={false}
                value={d.safeAddress ?? ""}
                placeholder="Safe address (0x…)"
                onChange={(e) => updateNodeData(id, { safeAddress: e.target.value })}
                className="w-full rounded bg-bg-card px-1.5 py-1 font-mono text-[10px] text-text-primary outline-none placeholder:text-text-tertiary"
              />
              {safeAddress && !safeValid && (
                <p className="text-[9px] text-error">Not a valid address</p>
              )}
              {safeValid && !SAFE_CHAIN_PREFIX[chainId] && (
                <p className="text-[9px] text-yellow-400">
                  Safe isn&apos;t available on this chain
                </p>
              )}
              <button
                type="button"
                onClick={openInSafe}
                disabled={!safeValid || !SAFE_CHAIN_PREFIX[chainId]}
                className="w-full rounded bg-brand/15 px-2 py-1 text-[10px] font-semibold text-brand transition-colors hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Open in Safe →
              </button>
              <p className="text-[9px] text-text-tertiary">
                Opens Morpheus inside the Safe with this strategy loaded, ready to queue as one
                batched transaction.
              </p>
            </div>
          )}
        </div>

        {/* Address */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Address</span>
          <span className="font-mono text-xs text-text-primary">
            {displayAddress}
          </span>
        </div>

        {/* Chain */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Chain</span>
          <div className="flex items-center gap-1.5">
            {chainId === 1 ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#627EEA" />
                <path d="M8 2v4.5L11.5 8 8 2z" fill="white" fillOpacity="0.6" />
                <path d="M8 2L4.5 8 8 6.5V2z" fill="white" />
                <path d="M8 10.5v3.5l3.5-5L8 10.5z" fill="white" fillOpacity="0.6" />
                <path d="M8 14v-3.5L4.5 9 8 14z" fill="white" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#0052FF" />
                <text x="8" y="11" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">B</text>
              </svg>
            )}
            <span className="text-xs text-text-secondary capitalize">
              {slug}
            </span>
          </div>
        </div>

        {/* Balances */}
        {isConnected && (
          <div className="mt-2 border-t border-border pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Balances
            </span>
            {isLoading ? (
              <div className="mt-1 space-y-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-5 animate-pulse rounded bg-bg-secondary"
                  />
                ))}
              </div>
            ) : nonZeroBalances.length > 0 ? (
              <div className="mt-1 space-y-1">
                {nonZeroBalances.map((asset) => (
                  <div
                    key={asset.address}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1.5">
                      <Image
                        src={asset.logoURI}
                        alt={asset.symbol}
                        width={14}
                        height={14}
                        className="rounded-full"
                        unoptimized
                      />
                      <span className="text-xs text-text-secondary">
                        {asset.symbol}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-text-primary">
                      {asset.balance}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-text-tertiary">
                No balances found
              </p>
            )}
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-brand !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(WalletNodeComponent);