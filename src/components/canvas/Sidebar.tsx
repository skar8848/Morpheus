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
    </div>
  );
}
