import { useState } from "react";

// One cell of the picker bar: a mono eyebrow over the current value, opening a
// monochrome listbox. With a single option the cell renders static — no
// chevron, no popover — so the bar never shifts layout.

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

export function Chevron({ open }: { open?: boolean }) {
  return (
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
  );
}

export default function PickerCell({
  label,
  value,
  options,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const single = options.length <= 1;

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          disabled={disabled || single}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left outline-none transition-colors enabled:hover:bg-panel-2 disabled:cursor-default"
        >
          <span className={`min-w-0 flex-1 truncate text-xs ${disabled ? "opacity-50" : "text-ink"}`}>
            {current?.label ?? "—"}
          </span>
          {current?.hint && (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-faint">
              {current.hint}
            </span>
          )}
          {!single && !disabled && <Chevron open={open} />}
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="listbox"
              className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-md border border-border-subtle bg-panel py-1 shadow-lg shadow-black/40"
            >
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm transition-colors hover:bg-panel-2 ${
                      selected ? "text-ink" : "text-ink-muted"
                    }`}
                  >
                    <span className="whitespace-nowrap">{o.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {selected && (
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="text-ink">
                          <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {o.hint && (
                        <span className="font-mono text-[10px] tabular-nums text-ink-faint">{o.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || single}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors enabled:hover:bg-panel-2 disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
            {label}
          </span>
          <span className={`mt-0.5 flex items-baseline gap-2 ${disabled ? "opacity-50" : ""}`}>
            <span className="truncate text-sm text-ink">{current?.label ?? "—"}</span>
            {current?.hint && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-faint">
                {current.hint}
              </span>
            )}
          </span>
        </span>
        {!single && !disabled && <Chevron open={open} />}
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
          <div
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-md border border-border-subtle bg-panel py-1 shadow-lg shadow-black/40"
          >
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm transition-colors hover:bg-panel-2 ${
                    selected ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="whitespace-nowrap">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {selected && (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="text-ink">
                        <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {o.hint && (
                      <span className="font-mono text-[10px] tabular-nums text-ink-faint">{o.hint}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
