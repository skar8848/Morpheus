"use client";

import { useState, useRef, useEffect } from "react";

interface Option {
  value: string;
  label: string;
  icon?: string;
}

interface SearchSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = query
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : options;

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
        className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary outline-none transition-colors hover:border-brand/30"
      >
        <span className={selected ? "text-text-primary" : "text-text-tertiary"}>
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
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>

          {/* Options */}
          <div className="max-h-40 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px] text-text-tertiary">
                No results
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
                  className={`flex w-full items-center justify-center gap-2 px-2 py-1.5 text-xs text-center transition-colors hover:bg-bg-secondary ${
                    o.value === value
                      ? "text-brand font-medium"
                      : "text-text-primary"
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
