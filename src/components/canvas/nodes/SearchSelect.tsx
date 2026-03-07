"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

interface Option {
  value: string;
  label: string;
  icon?: string;
}

interface SearchSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  onImportAddress?: (address: string) => void;
  placeholder?: string;
  importLoading?: boolean;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export default function SearchSelect({
  options,
  value,
  onChange,
  onImportAddress,
  placeholder = "Search...",
  importLoading = false,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  // Filter by label or by address (value)
  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.value.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  // Detect if query is a valid address not in the list
  const queryIsAddress = ADDRESS_RE.test(query.trim());
  const addressNotInList =
    queryIsAddress &&
    !options.some(
      (o) => o.value.toLowerCase() === query.trim().toLowerCase()
    );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="nodrag nowheel relative mt-0.5">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none transition-colors hover:border-brand/30"
      >
        {selected?.icon && (
          <Image
            src={selected.icon}
            alt=""
            width={14}
            height={14}
            className="rounded-full shrink-0"
            unoptimized
          />
        )}
        <span className={`flex-1 text-left ${selected ? "text-text-primary" : "text-text-tertiary"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-bg-card shadow-xl">
          {/* Search input */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search or paste address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>

          {/* Options */}
          <div className="max-h-40 overflow-y-auto py-1">
            {/* Import from CA button */}
            {addressNotInList && onImportAddress && (
              <button
                type="button"
                onClick={() => {
                  onImportAddress(query.trim());
                  // Don't close — wait for import to complete
                }}
                disabled={importLoading}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-brand transition-colors hover:bg-bg-secondary"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-brand text-[8px] font-bold">+</span>
                <span className="flex-1 text-left">
                  {importLoading ? "Importing..." : `Import ${query.trim().slice(0, 6)}...${query.trim().slice(-4)}`}
                </span>
              </button>
            )}

            {filtered.length === 0 && !addressNotInList ? (
              <div className="px-2 py-1.5 text-[10px] text-text-tertiary">
                No results — try pasting a contract address
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors hover:bg-bg-secondary ${
                    o.value === value
                      ? "text-brand font-medium"
                      : "text-text-primary"
                  }`}
                >
                  {o.icon && (
                    <Image
                      src={o.icon}
                      alt=""
                      width={14}
                      height={14}
                      className="rounded-full shrink-0"
                      unoptimized
                    />
                  )}
                  <span className="flex-1 text-center">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
