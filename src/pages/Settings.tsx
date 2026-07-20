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
    <main className="flex-1 px-5 py-10 md:px-12 md:py-14 lg:px-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-ink md:mb-10 md:text-3xl">Settings</h1>

        <div className="space-y-6">
          <div>
            <label className="mb-1 block text-sm text-ink-faint">Output folder</label>
            <div className="flex items-center gap-3">
              <span className="truncate text-sm text-ink-muted">
                {settings.outputDir ?? "Downloads (default)"}
              </span>
              <button
                onClick={chooseOutputDir}
                className="shrink-0 rounded-md border border-border-subtle px-3 py-1.5 text-xs text-ink-muted hover:border-ink-faint"
              >
                Change
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.copySourceIntoLibrary}
              onChange={(e) => save({ ...settings, copySourceIntoLibrary: e.target.checked })}
            />
            <span className="text-sm text-ink">Copy source media into the library</span>
          </label>

          {saved && <p className="text-xs text-accent">Saved.</p>}
        </div>
      </div>
    </main>
  );
}
