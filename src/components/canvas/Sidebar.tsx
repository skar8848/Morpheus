"use client";

import { useState, type DragEvent } from "react";
import Image from "next/image";
import { useUserPositions } from "@/lib/hooks/useUserPositions";
import { formatUsd, formatApy, formatTokenAmount } from "@/lib/utils/format";
import { DRAGGABLE_NODE_TYPES, NODE_COLORS } from "@/lib/canvas/types";

interface SidebarProps {
  onAddPosition: (positionId: string) => void;
}

export default function Sidebar({ onAddPosition }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { marketPositions, vaultPositions, loading } = useUserPositions();

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const borrowPositions = marketPositions.filter(
    (p) => p.state && p.state.borrowAssets && BigInt(p.state.borrowAssets) > 0n
  );
  const vaultPos = vaultPositions.filter(
    (p) => p.state && BigInt(p.state.shares) > 0n
  );

  return (
    <div
      className={`absolute left-0 top-0 z-20 flex h-full flex-col border-r border-border bg-bg-primary/95 backdrop-blur-sm transition-all ${
        collapsed ? "w-12" : "w-64"
      }`}
    >
      {/* Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-10 items-center justify-center border-b border-border text-text-tertiary transition-colors hover:text-text-primary"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
        >
          <path
            d="M10 4L6 8l4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3">
          {/* Node types */}
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Add Nodes
            </p>
            <div className="space-y-1.5">
              {DRAGGABLE_NODE_TYPES.map(({ type, label, icon }) => (
                <div
                  key={type}
                  draggable
                  onDragStart={(e) => onDragStart(e, type)}
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary transition-colors hover:border-brand/30 hover:bg-bg-secondary active:cursor-grabbing"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{ backgroundColor: NODE_COLORS[type] }}
                  >
                    {icon}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Existing positions */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Positions
            </p>

            {loading ? (
              <div className="space-y-1.5">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-bg-secondary"
                  />
                ))}
              </div>
            ) : borrowPositions.length === 0 && vaultPos.length === 0 ? (
              <p className="text-[10px] text-text-tertiary">
                Connect wallet to see positions
              </p>
            ) : (
              <div className="space-y-1.5">
                {borrowPositions.map((pos) => (
                  <div
                    key={`borrow-${pos.market.uniqueKey}`}
                    draggable
                    onDragStart={(e) =>
                      onDragStart(e, `position:borrow:${pos.market.uniqueKey}`)
                    }
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs transition-colors hover:border-brand/30 active:cursor-grabbing"
                  >
                    <div className="relative flex items-center">
                      <Image
                        src={pos.market.collateralAsset.logoURI}
                        alt=""
                        width={14}
                        height={14}
                        className="rounded-full"
                        unoptimized
                      />
                      <Image
                        src={pos.market.loanAsset.logoURI}
                        alt=""
                        width={14}
                        height={14}
                        className="-ml-1 rounded-full ring-1 ring-bg-card"
                        unoptimized
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-text-primary">
                        {pos.market.collateralAsset.symbol}/
                        {pos.market.loanAsset.symbol}
                      </p>
                      <p className="text-[10px] text-text-tertiary">
                        {pos.state?.borrowAssetsUsd
                          ? formatUsd(pos.state.borrowAssetsUsd)
                          : "—"}{" "}
                        borrowed
                      </p>
                    </div>
                  </div>
                ))}
                {vaultPos.map((pos) => (
                  <div
                    key={`vault-${pos.vault.address}`}
                    draggable
                    onDragStart={(e) =>
                      onDragStart(e, `position:vault:${pos.vault.address}`)
                    }
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs transition-colors hover:border-brand/30 active:cursor-grabbing"
                  >
                    <Image
                      src={pos.vault.asset.logoURI}
                      alt=""
                      width={14}
                      height={14}
                      className="rounded-full"
                      unoptimized
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-text-primary">
                        {pos.vault.name}
                      </p>
                      <p className="text-[10px] text-text-tertiary">
                        {pos.state?.assetsUsd
                          ? formatUsd(pos.state.assetsUsd)
                          : "—"}{" "}
                        deposited
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Social links */}
      <div className={`flex items-center border-t border-border px-3 py-3 ${collapsed ? "justify-center" : "gap-3"}`}>
        <a
          href="https://x.com/0xhaizeka"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary transition-colors hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a
          href="https://github.com/skar8848"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary transition-colors hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
