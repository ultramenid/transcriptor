import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings as SettingsType } from "../lib/types";

const DEFAULT: SettingsType = {
  defaultModelId: null,
  defaultQuant: null,
  defaultLanguage: "auto",
  outputDir: null,
  copySourceIntoLibrary: false,
};

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT);
  const [saved, setSaved] = useState(false);

  // Activity log. Loaded on demand rather than streamed — it's a diagnostic
  // surface, not a live console.
  const [log, setLog] = useState<string | null>(null);
  const [logPath, setLogPath] = useState("");
  const [logErr, setLogErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<SettingsType>("get_settings").then(setSettings);
    invoke<string>("log_path").then(setLogPath).catch(() => {});
  }, []);

  async function loadLog() {
    setLogErr(null);
    try {
      setLog(await invoke<string>("read_log"));
    } catch (e) {
      setLogErr(String(e));
    }
  }

  async function revealLog() {
    setLogErr(null);
    try {
      await invoke("reveal_log");
    } catch (e) {
      setLogErr(String(e));
    }
  }

  async function save(next: SettingsType) {
    setSettings(next);
    await invoke("save_settings", { settings: next });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function chooseOutputDir() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") save({ ...settings, outputDir: dir });
  }

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <h1 className="mb-8 text-xl font-semibold tracking-tight text-ink">Settings</h1>

        <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 border-t border-border-subtle py-4">
          <div className="min-w-0">
            <p className="text-sm text-ink">Output folder</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
              {settings.outputDir ?? "Downloads (default)"}
            </p>
          </div>
          <button
            onClick={chooseOutputDir}
            className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
          >
            Change
          </button>
        </div>

        <label className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-6 border-t border-b border-border-subtle py-4">
          <div>
            <p className="text-sm text-ink">Copy source media into the library</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
              Keeps playback working even if the original file moves.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.copySourceIntoLibrary}
            onChange={(e) => save({ ...settings, copySourceIntoLibrary: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-ink)]"
          />
        </label>

        {saved && (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Saved</p>
        )}

        <section className="mt-10">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 border-t border-border-subtle py-4">
            <div className="min-w-0">
              <p className="text-sm text-ink">Activity log</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint" title={logPath}>
                {logPath || "—"}
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink-faint">
                What ran and what failed. Never contains transcript text.
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={loadLog}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
              >
                {log === null ? "View" : "Refresh"}
              </button>
              <button
                onClick={revealLog}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
              >
                Reveal
              </button>
            </div>
          </div>

          {logErr && <p className="font-mono text-[11px] text-ink-muted">{logErr}</p>}

          {log !== null && (
            <pre className="max-h-80 overflow-auto rounded-md border border-border-subtle bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
              {log.trim() || "The log is empty."}
            </pre>
          )}
        </section>
      </div>
    </main>
  );
}
