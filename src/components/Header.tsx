import { useState } from "react";
import type { View } from "../App";

function ThemeToggle() {
  const [light, setLight] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("light"),
  );
  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch (e) {}
  }
  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-panel hover:text-ink-muted"
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark" : "Light"}
    >
      {light ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M13 9.2A5.3 5.3 0 0 1 6.8 3 5.3 5.3 0 1 0 13 9.2Z" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

interface Props {
  view: View;
  onGo: (v: View) => void;
  onBack: () => void;
}

export default function Header({ view, onGo, onBack }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
      {view === "transcript" ? (
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Library
        </button>
      ) : (
        <button onClick={onBack} className="flex items-center gap-2.5" aria-label="Library">
          <span className="flex h-4 items-end gap-[2px]" aria-hidden>
            <span className="h-2 w-[3px] rounded-full bg-ink" />
            <span className="h-4 w-[3px] rounded-full bg-ink" />
            <span className="h-2.5 w-[3px] rounded-full bg-ink" />
          </span>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-ink">
            Transcriptor
          </span>
        </button>
      )}

      <div className="flex items-center gap-1">
        {(
          [
            { v: "models" as View, label: "Models" },
            { v: "settings" as View, label: "Settings" },
          ]
        ).map(({ v, label }) => (
          <button
            key={v}
            onClick={() => onGo(v)}
            className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
              view === v ? "bg-panel text-ink" : "text-ink-faint hover:bg-panel hover:text-ink-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <ThemeToggle />
      </div>
    </header>
  );
}
