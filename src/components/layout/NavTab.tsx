"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavTabProps {
  href: string;
  label: string;
  badge?: string;
}

export default function NavTab({ href, label, badge }: NavTabProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? "text-text-primary"
          : "text-text-tertiary hover:text-text-secondary"
      }`}
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
