// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "What's the safest yield strategy for 10k USDC on Base?",
  "How do I leverage my wstETH on Ethereum?",
  "Explain the looped wstETH template",
  "Quels markets sur Morpho ont un APY négatif au borrow ?",
];

/**
 * Render a chat assistant reply with very basic markdown:
 * - **bold**
 * - `code` (inline)
 * - URLs as clickable links
 * - line breaks preserved
 */
function renderAssistantText(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {renderInline(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

function renderInline(line: string): React.ReactNode[] {
  // Combined regex for bold, inline code, and URLs
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)|(https?:\/\/[^\s)]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      parts.push(line.slice(lastIdx, match.index));
    }
    if (match[1]) {
      parts.push(
        <strong key={key++} className="font-semibold text-text-primary">
          {match[1].slice(2, -2)}
        </strong>
      );
    } else if (match[2]) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-bg-secondary px-1 py-0.5 font-mono text-[10px] text-brand"
        >
          {match[2].slice(1, -1)}
        </code>
      );
    } else if (match[3]) {
      parts.push(
        <a
          key={key++}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline transition-colors hover:text-brand-hover"
        >
          {match[3]}
        </a>
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
  return parts;
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setError(null);
      const newMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      setMessages(newMessages);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: newMessages }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || `Request failed (${res.status})`);
          return;
        }
        setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Network error: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-bg-card text-text-secondary shadow-lg backdrop-blur-sm transition-all hover:border-brand/40 hover:text-brand ${
          open ? "rotate-90" : ""
        }`}
        title={open ? "Close AI Assistant" : "Open AI Assistant"}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 3v-3H4a2 2 0 01-2-2V4z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Sliding panel */}
      <div
        className={`fixed right-0 top-[var(--nav-height)] z-20 flex h-[calc(100vh-var(--nav-height))] w-[380px] flex-col border-l border-border bg-bg-primary/95 backdrop-blur-sm transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1v3M8 12v3M3.5 3.5l2 2M10.5 10.5l2 2M1 8h3M12 8h3M3.5 12.5l2-2M10.5 5.5l2-2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Strategy Assistant</p>
              <p className="text-[10px] text-text-tertiary">Powered by Claude</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              className="rounded-md px-2 py-1 text-[10px] text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
              Clear
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-text-tertiary">
                Describe a strategy goal in natural language. The assistant
                will suggest nodes, markets, and warn about risk.
              </p>
              <div className="space-y-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Suggested
                </p>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="block w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-left text-[11px] leading-snug text-text-secondary transition-colors hover:border-brand/30 hover:text-brand"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`mb-3 ${m.role === "user" ? "ml-6" : "mr-2"}`}
            >
              <div
                className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-brand/10 text-text-primary"
                    : "border border-border bg-bg-card text-text-secondary"
                }`}
              >
                {m.role === "assistant" ? renderAssistantText(m.content) : m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="mr-2 mb-3 flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 text-xs text-text-tertiary">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                className="animate-spin"
              >
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
                <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Thinking…
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-[11px] text-error">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={onSubmit} className="border-t border-border p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your strategy goal…"
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand focus:ring-1 focus:ring-brand/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p className="mt-1.5 text-[9px] leading-snug text-text-tertiary">
            The assistant only suggests strategies. You always confirm and sign every transaction yourself.
          </p>
        </form>
      </div>
    </>
  );
}
