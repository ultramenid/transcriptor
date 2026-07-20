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

  useEffect(() => {
    invoke<SettingsType>("get_settings").then(setSettings);
  }, []);

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
      </div>
    </main>
  );
}
