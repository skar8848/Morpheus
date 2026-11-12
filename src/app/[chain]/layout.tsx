// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import { ChainProvider } from "@/lib/context/ChainContext";
import { CHAIN_CONFIGS } from "@/lib/web3/chains";

export default async function ChainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ chain: string }>;
}) {
  // getChainBySlug falls back to Ethereum, so an unknown slug would otherwise
  // render mainnet data under a URL that names some other chain, with Navbar
  // links and the chain switcher built on the wrong segment.
  const { chain } = await params;
  if (!CHAIN_CONFIGS.some((c) => c.slug === chain)) notFound();

  return (
    <ChainProvider>
      <div className="min-h-screen bg-bg-primary">
        <Navbar />
        {children}
      </div>
    </ChainProvider>
  );
}