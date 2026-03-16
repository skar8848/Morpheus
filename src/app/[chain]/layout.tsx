// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import Navbar from "@/components/layout/Navbar";
import { ChainProvider } from "@/lib/context/ChainContext";

export default function ChainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChainProvider>
      <div className="min-h-screen bg-bg-primary">
        <Navbar />
        {children}
      </div>
    </ChainProvider>
  );
}