"use client";

import Image from "next/image";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { Vault } from "@/lib/graphql/types";
import { formatApy, formatUsd } from "@/lib/utils/format";

interface DeployVaultCardProps {
  vault: Vault;
  selected: boolean;
  onToggle: () => void;
}

export default function DeployVaultCard({
  vault,
  selected,
  onToggle,
}: DeployVaultCardProps) {
  const fee = vault.state.fee;
  const allocationCount = vault.state.allocation?.length ?? 0;
  const curator = vault.state.curator;
  const curatorTruncated = curator
    ? `${curator.slice(0, 6)}...${curator.slice(-4)}`
    : null;

  return (
    <Card selected={selected} onClick={onToggle} className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image
            src={vault.asset.logoURI || `https://cdn.morpho.org/assets/logos/${vault.asset.symbol.toLowerCase()}.svg`}
            alt={vault.asset.symbol}
            width={36}
            height={36}
            className="rounded-full"
            unoptimized
          />
          <div>
            <p className="text-sm font-medium text-text-primary">
              {vault.name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-text-tertiary">
                {vault.symbol}
              </span>
              {fee > 0 && (
                <Badge>{(fee * 100).toFixed(0)}% fee</Badge>
              )}
              {curatorTruncated && (
                <span className="text-[10px] text-text-tertiary" title={curator ?? ""}>
                  Curator: {curatorTruncated}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="text-lg font-semibold text-success">
            {formatApy(vault.state.netApy)}
          </p>
          <p className="text-[10px] text-text-tertiary">Net APY</p>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="mt-3 flex gap-4 border-t border-border pt-3 text-xs text-text-tertiary">
        <div>
          <span className="text-text-secondary">TVL: </span>
          {vault.state.totalAssetsUsd ? formatUsd(vault.state.totalAssetsUsd) : "—"}
        </div>
        <div>
          <span className="text-text-secondary">Markets: </span>
          {allocationCount}
        </div>
      </div>
    </Card>
  );
}
