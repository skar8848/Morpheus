"use client";

import type { ReactNode } from "react";
import { NODE_COLORS } from "@/lib/canvas/types";

interface NodeShellProps {
  nodeType: string;
  title: string;
  children: ReactNode;
  onDelete?: () => void;
  invalid?: boolean;
}

export default function NodeShell({
  nodeType,
  title,
  children,
  onDelete,
  invalid,
}: NodeShellProps) {
  const accent = NODE_COLORS[nodeType] ?? "#6b7079";

  return (
    <div
      className="min-w-[240px] max-w-[280px] rounded-xl border bg-bg-card shadow-lg"
      style={{
        borderColor: invalid ? "var(--error)" : `${accent}33`,
        boxShadow: invalid
          ? "0 0 12px rgba(199, 62, 89, 0.3)"
          : `0 0 12px ${accent}15`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between rounded-t-xl px-3 py-2"
        style={{ backgroundColor: `${accent}18` }}
      >
        <span className="text-xs font-semibold" style={{ color: accent }}>
          {title}
        </span>
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-error"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-3">{children}</div>
    </div>
  );
}
