import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M13 9.2A5.3 5.3 0 0 1 6.8 3 5.3 5.3 0 1 0 13 9.2Z" fill="currentColor" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.5"
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

// The window is undecorated everywhere, so this file draws the whole title bar:
// a 28px strip holding the window controls, then the app's nav row. macOS keeps
// its real traffic lights (inset from Rust); the rest get the buttons below.
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

function WindowControls() {
  const win = getCurrentWindow();
  const buttons = [
    { label: "Minimize", act: () => win.minimize(), path: "M2 6h8", danger: false },
    { label: "Maximize", act: () => win.toggleMaximize(), path: "M2.5 2.5h7v7h-7z", danger: false },
    { label: "Close", act: () => win.close(), path: "M2.5 2.5l7 7M9.5 2.5l-7 7", danger: true },
  ];
  return (
    <div className="flex h-full">
      {buttons.map(({ label, act, path, danger }) => (
        <button
          key={label}
          onClick={act}
          aria-label={label}
          className={`flex h-full w-[44px] items-center justify-center text-ink-muted transition-colors ${
            danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-panel hover:text-ink"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d={path} stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      ))}
    </div>
  );
}

const CRUMB: Record<Exclude<View, "library">, string> = {
  transcript: "Transcript",
  models: "Models",
  settings: "Settings",
};

export default function Header({ view, onGo, onBack }: Props) {
  return (
    <>
      {/* Window controls get their own strip so the nav row below can start on
          the same left margin as the page content. */}
      <div data-tauri-drag-region className="flex h-7 shrink-0 justify-end">
        {!isMac && <WindowControls />}
      </div>
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4"
      >
      <nav className="flex items-center gap-2" aria-label="Breadcrumb">
        <button onClick={onBack} className="flex items-center gap-2.5" aria-label="Library">
          {/* App mark — waveform becoming text lines, same as the product icon. */}
          <svg viewBox="229 262 566 500" className="h-4 w-auto text-ink" fill="currentColor" aria-hidden>
            <rect x="229" y="412" width="52" height="200" rx="26" />
            <rect x="313" y="302" width="52" height="420" rx="26" />
            <rect x="397" y="357" width="52" height="310" rx="26" />
            <rect x="481" y="262" width="52" height="500" rx="26" />
            <rect x="583" y="386" width="212" height="52" rx="26" />
            <rect x="583" y="486" width="148" height="52" rx="26" />
            <rect x="583" y="586" width="184" height="52" rx="26" />
          </svg>
          <span
            className={`font-mono text-[11px] font-medium uppercase tracking-[0.25em] transition-colors ${
              view === "library" ? "text-ink" : "text-ink-faint hover:text-ink"
            }`}
          >
            {view === "library" ? "Transcriptor" : "Library"}
          </span>
        </button>
        {view !== "library" && (
          <>
            <span className="text-ink-faint" aria-hidden>
              /
            </span>
            <span
              className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-ink"
              aria-current="page"
            >
              {CRUMB[view]}
            </span>
          </>
        )}
      </nav>

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
    </>
  );
}
