// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { getBytecode } from "wagmi/actions";
import { wagmiConfig } from "@/lib/web3/config";

export interface SmartAccountInfo {
  /** True when the connected account is a contract (Safe, or any smart wallet). */
  isSmartAccount: boolean;
  /** True specifically when connected through the Safe App connector. */
  isSafeApp: boolean;
  loading: boolean;
}

/**
 * Detect whether the connected wallet is a smart contract account.
 *
 * This matters beyond curiosity: a contract account signs via EIP-1271 and,
 * for a Safe, through a multi-signature queue — so a submitted transaction can
 * legitimately sit pending instead of landing. Some integrations also refuse
 * contract accounts outright (CoW's cross-chain flow is one), and offering
 * those paths to a Safe user would fail at signing time.
 *
 * Detection is bytecode-based rather than connector-based, so it also catches
 * a Safe reaching us over WalletConnect.
 */
export function useSmartAccount(): SmartAccountInfo {
  const { address, connector, isConnected } = useAccount();
  const [isSmartAccount, setIsSmartAccount] = useState(false);
  const [loading, setLoading] = useState(false);

  const isSafeApp = connector?.id === "safe";

  useEffect(() => {
    if (!isConnected || !address) {
      setIsSmartAccount(false);
      return;
    }
    // The Safe connector is conclusive on its own — no RPC round-trip needed.
    if (isSafeApp) {
      setIsSmartAccount(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getBytecode(wagmiConfig, { address })
      .then((code) => {
        if (!cancelled) setIsSmartAccount(!!code && code !== "0x");
      })
      .catch(() => {
        // Can't tell — assume EOA rather than blocking features on a bad RPC.
        if (!cancelled) setIsSmartAccount(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, isSafeApp]);

  return { isSmartAccount, isSafeApp, loading };
}
