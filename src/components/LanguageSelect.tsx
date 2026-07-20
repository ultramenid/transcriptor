import { useEffect, useMemo, useRef, useState } from "react";
import { AUTO, LANGUAGES } from "../lib/languages";

// Searchable language combobox — native, no deps. A trigger shows the current
// language; opening reveals a filter box over the full Whisper language set.
// Filtering matches label or code, case-insensitive. Arrow keys move the
// highlight, Enter selects, Escape closes. Click-away closes via a fixed
// backdrop (cheaper than a document listener and immune to portal races).
export default function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
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
    <label className="flex items-center gap-2 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">Language</span>
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
          className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg px-2.5 py-1.5 text-ink outline-none transition-colors hover:border-ink-faint focus:border-ink-faint disabled:opacity-50"
        >
          <span>{current.label}</span>
          <span className="font-mono text-[10px] uppercase text-ink-faint">{current.value}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden
            className={`text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
            <div className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-md border border-border-subtle bg-panel shadow-lg shadow-black/40">
              <div className="flex items-center gap-2 border-b border-border-subtle bg-bg px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden className="shrink-0 text-ink-faint">
                  <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search languages…"
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => { setQuery(""); setActive(0); inputRef.current?.focus(); }}
                    className="shrink-0 text-ink-faint hover:text-ink-muted"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path d="M2 2L9 9M9 2L2 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>

              <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
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
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors ${
                        i === active ? "bg-panel-2 text-ink" : "text-ink-muted"
                      } ${selected ? "text-ink" : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        {l.value === AUTO.value && (
                          <span className="font-mono text-[9px] uppercase tracking-wide text-ink-faint">Auto</span>
                        )}
                        {l.label}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {selected && (
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="text-ink">
                            <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        <span className="font-mono text-[10px] uppercase text-ink-faint">{l.value}</span>
                      </span>
                    </button>
                  );
                })}
                {rows.length === 0 && (
                  <p className="px-3 py-3 text-xs text-ink-faint">
                    No language matches “{query}”.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                <span>{rows.length} of {LANGUAGES.length + 1}</span>
                <span>↑↓ navigate · ↵ select · esc</span>
              </div>
            </div>
          </>
        )}
      </div>
    </label>
  );
}