// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import {
  classifyDestination,
  explorerContractUrl,
  OWNER_LABELS,
  type ContractOwner,
} from "@/lib/canvas/contractRegistry";
import type { SupportedChainId } from "@/lib/web3/chains";

interface Props {
  /** Every address this execution will send a transaction to. */
  destinations: string[];
  /** Tokens the strategy uses, so approval targets are recognised. */
  strategyTokens?: { address: string; symbol: string }[];
  /** Vaults the bundle calls, as the Morpho API returned them for their addresses. */
  strategyVaults?: { address: string; name: string; listed: boolean }[];
  chainId: SupportedChainId | number;
}

const ownerTone: Record<ContractOwner, string> = {
  morpho: "text-brand",
  cowswap: "text-amber-400",
  lifi: "text-purple-400",
  circle: "text-success",
  safe: "text-success",
  token: "text-text-secondary",
  vault: "text-brand",
};

/**
 * Shows exactly which contracts a strategy will touch, and lets the user check
 * each one on a block explorer before signing.
 *
 * The point isn't to reassure — it's to be checkable. Every address carries its
 * provenance (where we got it) and a link to its verified source, and anything
 * we don't recognise is called out in red rather than glossed over. A claim the
 * user can't test is worth nothing.
 */
export default function ContractVerification({
  destinations,
  strategyTokens = [],
  strategyVaults = [],
  chainId,
}: Props) {
  const unique = Array.from(new Set(destinations.map((d) => d.toLowerCase()))).map(
    (addr) => destinations.find((d) => d.toLowerCase() === addr) ?? addr
  );
  if (unique.length === 0) return null;

  const rows = unique.map((to) => ({ to, verdict: classifyDestination(to, strategyTokens, strategyVaults) }));
  const unknown = rows.filter((r) => !r.verdict.known);

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-secondary/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
          Contracts this will touch
        </span>
        <span className={`text-[9px] font-semibold ${unknown.length === 0 ? "text-success" : "text-error"}`}>
          {unknown.length === 0
            ? `${rows.length} known`
            : `${unknown.length} unrecognised`}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {rows.map(({ to, verdict }) => {
          const c = verdict.contract;
          return (
            <div key={to} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[9px] font-semibold ${
                      c ? ownerTone[c.owner] : "text-error"
                    }`}
                  >
                    {c ? OWNER_LABELS[c.owner] : "UNRECOGNISED"}
                  </span>
                  <span className="truncate text-[9px] text-text-secondary">
                    {c?.role ?? "not in the registry — do not sign unless you know what this is"}
                  </span>
                </div>
                {c && (
                  <p className="truncate text-[8px] text-text-tertiary">source: {c.provenance}</p>
                )}
              </div>
              <a
                href={explorerContractUrl(to, chainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 font-mono text-[9px] text-text-tertiary underline decoration-dotted hover:text-brand"
                title="Open the verified source on the explorer"
              >
                {to.slice(0, 6)}…{to.slice(-4)}
              </a>
            </div>
          );
        })}
      </div>

      {unknown.length > 0 && (
        <p className="mt-1.5 rounded border border-error/30 bg-error/5 px-2 py-1 text-[9px] text-error">
          This strategy targets a contract Morpheus doesn&apos;t recognise. Verify it yourself before
          signing.
        </p>
      )}
    </div>
  );
}
