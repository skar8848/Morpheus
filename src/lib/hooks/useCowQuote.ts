"use client";

import { useState, useEffect, useRef } from "react";

interface UseCowQuoteParams {
  tokenIn: string | undefined;
  tokenOut: string | undefined;
  amountIn: string;
  decimalsIn: number;
  decimalsOut: number;
  enabled: boolean;
}

interface UseCowQuoteResult {
  quote: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Debounced CowSwap quote via their order book API.
 * Ethereum mainnet only — caller should gate `enabled` on chainId === 1.
 */
export function useCowQuote({
  tokenIn,
  tokenOut,
  amountIn,
  decimalsIn,
  decimalsOut,
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

    if (!enabled || !tokenIn || !tokenOut || !amountIn || parseFloat(amountIn) <= 0) {
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
        const sellAmountWei = BigInt(
          Math.floor(parseFloat(amountIn) * 10 ** decimalsIn)
        ).toString();

        const res = await fetch("https://api.cow.fi/mainnet/api/v1/quote", {
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
          const formatted = (Number(buyAmount) / 10 ** decimalsOut).toFixed(
            Math.min(decimalsOut, 6)
          );
          setQuote(formatted);
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
  }, [tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut, enabled]);

  return { quote, loading, error };
}
