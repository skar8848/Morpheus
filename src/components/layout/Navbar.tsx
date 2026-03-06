"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import NavTab from "./NavTab";
import { useChain } from "@/lib/context/ChainContext";
import { CHAIN_CONFIGS } from "@/lib/web3/chains";

export default function Navbar() {
  const { slug } = useChain();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentChain = CHAIN_CONFIGS.find((c) => c.slug === slug) ?? CHAIN_CONFIGS[0];

  const tabs = [
    { href: `/${slug}/explore`, label: "Explore" },
    { href: `/${slug}/earn`, label: "Earn" },
    { href: `/${slug}/borrow`, label: "Borrow" },
    { href: `/${slug}/migrate`, label: "Migrate" },
    { href: `/${slug}/strategy`, label: "Strategy" },
    { href: `/${slug}/canvas`, label: "Canvas", badge: "NEW" },
    { href: `/${slug}/address`, label: "Address" },
  ];

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <nav className="sticky top-0 z-50 flex h-[var(--nav-height)] items-center border-b border-border bg-bg-primary/80 px-6 backdrop-blur-md">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-8">
        <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" fill="#2973ff" />
          <path
            d="M30 55 L50 35 L70 55 L50 75Z"
            fill="white"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-lg font-semibold text-text-primary">Morpheus</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <NavTab key={tab.href} {...tab} />
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Chain selector + Connect */}
      <div className="flex items-center gap-3">
        {/* Chain selector */}
        <div className="relative">
          <button
            onClick={() => setChainMenuOpen(!chainMenuOpen)}
            className="flex items-center gap-2 rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-card"
          >
            {currentChain.slug === "ethereum" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#627EEA" />
                <path d="M8 2v4.5L11.5 8 8 2z" fill="white" fillOpacity="0.6" />
                <path d="M8 2L4.5 8 8 6.5V2z" fill="white" />
                <path d="M8 10.5v3.5l3.5-5L8 10.5z" fill="white" fillOpacity="0.6" />
                <path d="M8 14v-3.5L4.5 9 8 14z" fill="white" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#0052FF" />
                <text x="8" y="11" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">B</text>
              </svg>
            )}
            {currentChain.label}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {chainMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-xl border border-border bg-bg-secondary py-1 shadow-lg">
              {CHAIN_CONFIGS.map((chain) => (
                <button
                  key={chain.slug}
                  onClick={() => {
                    setChainMenuOpen(false);
                    router.push(`/${chain.slug}/strategy`);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-bg-card ${
                    chain.slug === slug
                      ? "text-brand font-medium"
                      : "text-text-secondary"
                  }`}
                >
                  {chain.label}
                  {chain.slug === slug && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto">
                      <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Wallet */}
        {mounted && isConnected ? (
          <button
            onClick={() => disconnect()}
            className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20"
          >
            {truncatedAddress}
          </button>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
