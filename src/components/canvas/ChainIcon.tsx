// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

/**
 * Chain marks.
 *
 * Prefers the real brand asset under /public/chains (see CHAIN_CONFIGS.logo);
 * if the file isn't there, falls back to an inline SVG so the icon always
 * renders — no 404 placeholders, no hard dependency on shipping assets.
 */

import { useState } from "react";
import { chainLogo } from "@/lib/web3/chains";

interface Props {
  chainId: number;
  size?: number;
  className?: string;
}

export default function ChainIcon({ chainId, size = 14, className = "" }: Props) {
  const logo = chainLogo(chainId);
  const [fileFailed, setFileFailed] = useState(false);

  if (logo && !fileFailed) {
    return (
      // Plain <img>: these are static local files and next/image would need
      // per-format config for .ico/.webp. onError swaps in the inline mark.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        onError={() => setFileFailed(true)}
        className={`shrink-0 rounded-full object-contain ${className}`}
      />
    );
  }

  return <InlineChainMark chainId={chainId} size={size} className={className} />;
}

function InlineChainMark({ chainId, size, className }: Required<Omit<Props, "size">> & { size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className: `shrink-0 ${className}`,
    "aria-hidden": true as const,
  };

  switch (chainId) {
    // Ethereum — the diamond
    case 1:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#627EEA" />
          <path d="M12 3.5v6.28l5.31 2.37L12 3.5Z" fill="#fff" fillOpacity=".6" />
          <path d="M12 3.5 6.69 12.15 12 9.78V3.5Z" fill="#fff" />
          <path d="M12 16.48v4.02l5.31-7.35L12 16.48Z" fill="#fff" fillOpacity=".6" />
          <path d="M12 20.5v-4.02l-5.31-3.33L12 20.5Z" fill="#fff" />
          <path d="m12 15.49 5.31-3.34L12 9.79v5.7Z" fill="#fff" fillOpacity=".2" />
          <path d="m6.69 12.15 5.31 3.34v-5.7l-5.31 2.36Z" fill="#fff" fillOpacity=".6" />
        </svg>
      );
    // Base — circle with square notch
    case 8453:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#0052FF" />
          <path
            d="M12 20.4c4.64 0 8.4-3.76 8.4-8.4S16.64 3.6 12 3.6c-4.4 0-8.02 3.39-8.37 7.7h11.1v1.4H3.63c.35 4.31 3.96 7.7 8.37 7.7Z"
            fill="#fff"
          />
        </svg>
      );
    // Arbitrum
    case 42161:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#213147" />
          <path d="m12 5.2 5.9 3.4v6.8L12 18.8 6.1 15.4V8.6L12 5.2Z" fill="#12AAFF" fillOpacity=".25" />
          <path d="M13.4 9.1 17 15.9l-1.9 1.1-3.7-7 2-.9Z" fill="#12AAFF" />
          <path d="m10.6 9.1 1.1 2.2-2.6 5-2 1.1 3.5-8.3Z" fill="#9DCCED" />
        </svg>
      );
    // HyperEVM — Hyperliquid mint
    case 999:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#072723" />
          <path
            d="M5 13.2c1.3-2.9 2.6-3 3.6-1.6.9 1.2 1.7 1.6 2.6.8 1-.9 1.9-2.7 3.1-2.5 1.3.2 1.6 2 2.5 2.7.7.5 1.5.2 2.2-.6v3.4c-1.4 2.5-2.7 2.2-3.6.9-.9-1.3-1.7-1.7-2.7-.8-1 .9-1.9 2.6-3.1 2.4-1.2-.2-1.6-1.9-2.5-2.6-.7-.6-1.4-.3-2.1.5v-2.6Z"
            fill="#97FCE4"
          />
        </svg>
      );
    // Monad
    case 143:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#836EF9" />
          <path
            d="M12 4.6c-2.9 0-7.4 4-7.4 7.4s4.5 7.4 7.4 7.4 7.4-4 7.4-7.4S14.9 4.6 12 4.6Zm0 11.1c-1.1 0-2.9-2.6-2.9-3.7s1.8-3.7 2.9-3.7 2.9 2.6 2.9 3.7-1.8 3.7-2.9 3.7Z"
            fill="#fff"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#6b7079" />
        </svg>
      );
  }
}
