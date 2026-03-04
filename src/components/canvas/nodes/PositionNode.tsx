"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import {
  formatApy,
  formatUsd,
  formatTokenAmount,
  formatLltv,
} from "@/lib/utils/format";
import type { PositionNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";

function PositionNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PositionNodeData;

  const hfColor = (hf: number | null) => {
    if (hf === null) return "text-text-tertiary";
    if (hf > 2) return "text-success";
    if (hf > 1.2) return "text-yellow-400";
    return "text-error";
  };

  const titleMap: Record<string, string> = {
    borrow: "Borrow Position",
    supply: "Supply Position",
    vault: "Vault Position",
    collateral: "Collateral Position",
  };

  return (
    <NodeShell nodeType="position" title={titleMap[d.positionType] ?? "Position"}>
      <div className="space-y-1.5">
        {/* Market position (borrow/supply/collateral) */}
        {d.marketPosition && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <Image
                  src={d.marketPosition.market.collateralAsset.logoURI}
                  alt={d.marketPosition.market.collateralAsset.symbol}
                  width={16}
                  height={16}
                  className="rounded-full"
                  unoptimized
                />
                <Image
                  src={d.marketPosition.market.loanAsset.logoURI}
                  alt={d.marketPosition.market.loanAsset.symbol}
                  width={16}
                  height={16}
                  className="-ml-1.5 rounded-full ring-1 ring-bg-card"
                  unoptimized
                />
              </div>
              <span className="text-xs font-medium text-text-primary">
                {d.marketPosition.market.collateralAsset.symbol}/
                {d.marketPosition.market.loanAsset.symbol}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-text-tertiary">LLTV</span>
                <span className="text-text-secondary">
                  {formatLltv(d.marketPosition.market.lltv)}
                </span>
              </div>

              {d.positionType === "borrow" && d.marketPosition.state && (
                <>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Collateral</span>
                    <span className="text-text-primary">
                      {d.marketPosition.state.collateralUsd
                        ? formatUsd(d.marketPosition.state.collateralUsd)
                        : formatTokenAmount(
                            d.marketPosition.state.collateral,
                            d.marketPosition.market.collateralAsset.decimals
                          )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Borrowed</span>
                    <span className="text-text-primary">
                      {d.marketPosition.state.borrowAssetsUsd
                        ? formatUsd(d.marketPosition.state.borrowAssetsUsd)
                        : d.marketPosition.state.borrowAssets
                          ? formatTokenAmount(
                              d.marketPosition.state.borrowAssets,
                              d.marketPosition.market.loanAsset.decimals
                            )
                          : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Borrow APY</span>
                    <span
                      className={
                        d.marketPosition.market.state.netBorrowApy < 0
                          ? "text-success"
                          : "text-text-secondary"
                      }
                    >
                      {formatApy(d.marketPosition.market.state.netBorrowApy)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">HF</span>
                    <span
                      className={`font-semibold ${hfColor(d.marketPosition.healthFactor)}`}
                    >
                      {d.marketPosition.healthFactor
                        ? d.marketPosition.healthFactor.toFixed(2)
                        : "—"}
                    </span>
                  </div>
                </>
              )}

              {d.positionType === "supply" && d.marketPosition.state && (
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Supplied</span>
                  <span className="text-text-primary">
                    {d.marketPosition.state.supplyAssetsUsd
                      ? formatUsd(d.marketPosition.state.supplyAssetsUsd)
                      : d.marketPosition.state.supplyAssets
                        ? formatTokenAmount(
                            d.marketPosition.state.supplyAssets,
                            d.marketPosition.market.loanAsset.decimals
                          )
                        : "—"}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Vault position */}
        {d.vaultPosition && (
          <>
            <div className="flex items-center gap-2">
              <Image
                src={d.vaultPosition.vault.asset.logoURI}
                alt={d.vaultPosition.vault.asset.symbol}
                width={16}
                height={16}
                className="rounded-full"
                unoptimized
              />
              <span className="text-xs font-medium text-text-primary">
                {d.vaultPosition.vault.name}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-text-tertiary">Deposited</span>
                <span className="text-text-primary">
                  {d.vaultPosition.state?.assetsUsd
                    ? formatUsd(d.vaultPosition.state.assetsUsd)
                    : d.vaultPosition.state?.assets
                      ? formatTokenAmount(
                          d.vaultPosition.state.assets,
                          d.vaultPosition.vault.asset.decimals
                        )
                      : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">APY</span>
                <span className="text-success">
                  {formatApy(d.vaultPosition.vault.state.netApy)}
                </span>
              </div>
              {d.vaultPosition.vault.state.totalAssetsUsd && (
                <div className="flex justify-between">
                  <span className="text-text-tertiary">TVL</span>
                  <span className="text-text-secondary">
                    {formatUsd(d.vaultPosition.vault.state.totalAssetsUsd)}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Output handle — positions can connect to withdraw/supply/swap */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-text-tertiary !bg-bg-card"
      />
    </NodeShell>
  );
}

export default memo(PositionNodeComponent);
