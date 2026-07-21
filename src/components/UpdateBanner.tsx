import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../lib/types";

// The one automatic network call this app makes: on launch, ask GitHub whether
// a newer release exists. It sends nothing but the request itself — no id, no
// usage data — and Settings can turn it off. Everything else stays offline.
//
// Failures are deliberately silent here: a launch check that can't reach GitHub
// (offline, which is the normal case for this app) must not nag. The manual
// button in Settings reports errors, because there a user asked.

export default function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<"idle" | "installing" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await invoke<Settings>("get_settings");
        if (!settings.autoCheckUpdates) return;
        const found = await check();
        if (!cancelled && found?.available) setUpdate(found);
      } catch {
        // Offline, GitHub down, no release yet — none of it is worth a banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (!update) return;
    setState("installing");
    setError(null);
    try {
      await update.downloadAndInstall();
      setState("done");
      await relaunch();
    } catch (e) {
      setState("failed");
      setError(String(e));
    }
  }

  if (!update || dismissed) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-panel px-4 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Update</span>
      <p className="min-w-0 flex-1 truncate text-sm text-ink">
        Version {update.version} is available.
        {state === "installing" && " Downloading…"}
        {state === "done" && " Restarting…"}
        {state === "failed" && ` ${error}`}
      </p>
      <button
        onClick={install}
        disabled={state === "installing" || state === "done"}
        className="rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-40"
      >
        {state === "failed" ? "Retry" : "Install and restart"}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
      >
        Later
      </button>
    </div>
  );
}
