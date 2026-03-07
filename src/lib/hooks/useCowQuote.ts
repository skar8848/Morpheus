"use client";

import { useState, useEffect, useRef } from "react";

const COW_API_BASE: Record<number, string> = {
  1: "https://api.cow.fi/mainnet/api/v1",
  8453: "https://api.cow.fi/base/api/v1",
};

interface UseCowQuoteParams {
  tokenIn: string | undefined;
  tokenOut: string | undefined;
  amountIn: string;
  decimalsIn: number;
  decimalsOut: number;
  chainId: number;
  enabled: boolean;
}

interface UseCowQuoteResult {
  quote: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Debounced CowSwap quote via their order book API.
 * Supports Ethereum mainnet and Base.
 */
export function useCowQuote({
  tokenIn,
  tokenOut,
  amountIn,
  decimalsIn,
  decimalsOut,
  chainId,
  enabled,
}: UseCowQuoteParams): UseCowQuoteResult {
  const [quote, setQuote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Clear previous
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const apiBase = COW_API_BASE[chainId];
    if (!enabled || !apiBase || !tokenIn || !tokenOut || !amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Debounce 500ms
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // String-based conversion to avoid float precision loss for large amounts
        const sellAmountWei = (() => {
          const parts = amountIn.split(".");
          const intPart = parts[0] || "0";
          const fracPart = (parts[1] || "").slice(0, decimalsIn).padEnd(decimalsIn, "0");
          const raw = BigInt(intPart + fracPart);
          return raw.toString();
        })();

        const res = await fetch(`${apiBase}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sellToken: tokenIn,
            buyToken: tokenOut,
            sellAmountBeforeFee: sellAmountWei,
            kind: "sell",
            from: "0x0000000000000000000000000000000000000000",
            priceQuality: "fast",
          }),
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.description ?? `CowSwap error ${res.status}`);
        }

        const data = await res.json();
        const buyAmount = data.quote?.buyAmount;

        if (buyAmount) {
          try {
            const raw = BigInt(buyAmount);
            const divisor = 10n ** BigInt(decimalsOut);
            const intPart = raw / divisor;
            const fracPart = raw % divisor;
            const fracStr = fracPart
              .toString()
              .padStart(decimalsOut, "0")
              .slice(0, 6);
            setQuote(`${intPart}.${fracStr}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") || "0");
          } catch {
            setQuote(null);
          }
        } else {
          setQuote(null);
        }

        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Quote failed");
        setQuote(null);
        setLoading(false);
      }
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut, chainId, enabled]);

  return { quote, loading, error };
}
