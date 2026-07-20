import { useEffect, useMemo, useRef, useState } from "react";
import { AUTO, LANGUAGES } from "../lib/languages";

// Searchable language menu, command-palette style: a borderless filter box over
// a compact list. Name left, ISO code right, check on the selected row.
// Arrow keys move the highlight, Enter selects, Escape closes, click-away
// closes via a fixed backdrop.
export default function LanguageSelect({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = value === AUTO.value ? AUTO : LANGUAGES.find((l) => l.value === value) ?? AUTO;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) => l.label.toLowerCase().includes(q) || l.value.includes(q),
    );
  }, [query]);

  // With an active filter, Auto-detect still leads the list so it's reachable
  // even when the query narrows to nothing.
  const rows = query.trim() ? filtered : [AUTO, ...filtered];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // Land the highlight on the current selection if it's visible, else Auto.
    setActive(rows.findIndex((l) => l.value === value));
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row visible while arrowing.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows[active]) choose(rows[active].value); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        // Type any letter while focused on the trigger to open + seed the search.
        onKeyDown={(e) => {
          if (!open && /^[a-z]$/i.test(e.key)) {
            setOpen(true);
            setQuery(e.key);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className={`flex w-full items-center gap-1.5 text-left outline-none transition-colors enabled:hover:bg-panel-2 disabled:cursor-default ${
          compact ? "px-2 py-1" : "gap-3 px-4 py-2.5"
        }`}
      >
        {compact ? (
          <>
            <span className={`min-w-0 flex-1 truncate text-xs ${disabled ? "opacity-50" : "text-ink"}`}>
              {current.label}
            </span>
            {!disabled && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden
                className={`shrink-0 text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
                Language
              </span>
              <span className={`mt-0.5 flex items-baseline gap-2 ${disabled ? "opacity-50" : ""}`}>
                <span className="truncate text-sm text-ink">{current.label}</span>
                {current.value !== AUTO.value && (
                  <span className="shrink-0 font-mono text-[10px] uppercase text-ink-faint">{current.value}</span>
                )}
              </span>
            </span>
            {!disabled && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden
                className={`shrink-0 text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </>
        )}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border border-border-subtle bg-panel shadow-lg shadow-black/40">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search languages…"
              className="w-full border-b border-border-subtle bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
            />

            <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {rows.map((l, i) => {
                const selected = l.value === value;
                return (
                  <button
                    key={l.value}
                    data-i={i}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(l.value)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] transition-colors ${
                      i === active ? "bg-panel-2" : ""
                    } ${selected || i === active ? "text-ink" : "text-ink-muted"} ${
                      !query.trim() && l.value === AUTO.value ? "border-b border-border-subtle/60 pb-2 mb-1" : ""
                    }`}
                  >
                    <span className="truncate">{l.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {selected && (
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="text-ink">
                          <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {l.value !== AUTO.value && (
                        <span className="font-mono text-[10px] uppercase text-ink-faint">{l.value}</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {rows.length === 0 && (
                <p className="px-3 py-3 text-xs text-ink-faint">No language matches “{query}”.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
