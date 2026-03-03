"use client";

import { createContext, useContext } from "react";
import { useParams } from "next/navigation";
import { getChainBySlug, type ChainConfig } from "@/lib/web3/chains";

const ChainContext = createContext<ChainConfig | null>(null);

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const chain = getChainBySlug(params.chain as string);

  return (
    <ChainContext.Provider value={chain}>{children}</ChainContext.Provider>
  );
}

export function useChain(): ChainConfig {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used within ChainProvider");
  return ctx;
}
