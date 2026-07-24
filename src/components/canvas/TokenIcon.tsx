// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import Image from "next/image";
import ChainIcon from "./ChainIcon";

interface Props {
  /** Token logo URL; falls back to a neutral disc when missing. */
  logoURI?: string | null;
  symbol?: string;
  /** Chain the token lives on — rendered as a small corner badge. */
  chainId?: number;
  size?: number;
  className?: string;
}

/**
 * Token logo with the chain it belongs to badged in the corner.
 *
 * Once a canvas can span several networks, a bare token logo is ambiguous —
 * USDC on Base and USDC on Arbitrum look identical but are not interchangeable.
 * The badge makes the network readable at a glance.
 */
export default function TokenIcon({ logoURI, symbol, chainId, size = 16, className = "" }: Props) {
  const badge = Math.max(8, Math.round(size * 0.5));

  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={symbol}
    >
      {logoURI ? (
        <Image
          src={logoURI}
          alt=""
          width={size}
          height={size}
          className="rounded-full"
          unoptimized
        />
      ) : (
        <span
          className="block rounded-full bg-bg-secondary"
          style={{ width: size, height: size }}
        />
      )}
      {chainId !== undefined && (
        <span
          className="absolute rounded-full ring-1 ring-bg-card"
          style={{ right: -badge * 0.2, bottom: -badge * 0.2, lineHeight: 0 }}
        >
          <ChainIcon chainId={chainId} size={badge} />
        </span>
      )}
    </span>
  );
}
