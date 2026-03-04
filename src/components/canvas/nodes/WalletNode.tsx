"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Image from "next/image";
import { useAccount } from "wagmi";
import { useChain } from "@/lib/context/ChainContext";
import { useTokenBalances } from "@/lib/hooks/useTokenBalances";
import { COLLATERAL_ASSETS } from "@/lib/constants/assets";
import type { SupportedChainId } from "@/lib/web3/chains";
import type { WalletNodeData } from "@/lib/canvas/types";
import NodeShell from "./NodeShell";

function WalletNodeComponent({ data }: NodeProps) {
  const { address, isConnected } = useAccount();
  const { slug, chainId } = useChain();
  const assets = COLLATERAL_ASSETS[chainId as SupportedChainId] ?? [];
  const { assetsWithBalances, isLoading } = useTokenBalances(assets);

  const displayAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";

  const nonZeroBalances = assetsWithBalances.filter(
    (a) => a.balanceRaw > 0n
  );

  return (
    <NodeShell nodeType="wallet" title="Wallet">
      <div className="space-y-2">
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
          <span className="text-xs text-text-secondary capitalize">
            {slug}
          </span>
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
