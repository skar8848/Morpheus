// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavTabProps {
  href: string;
  label: string;
  badge?: string;
  external?: boolean;
}

export default function NavTab({ href, label, badge, external }: NavTabProps) {
  const pathname = usePathname();
  const isActive = !external && pathname.startsWith(href);

  const className = `relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "text-text-primary"
      : "text-text-tertiary hover:text-text-secondary"
  }`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="opacity-40">
          <path d="M3.5 8.5l5-5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={className}
    >
      {label}
      {badge && (
        <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
      {isActive && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-brand" />
      )}
    </Link>
  );
}