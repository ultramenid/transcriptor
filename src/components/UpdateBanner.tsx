import { useState } from "react";
import { type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Dismissible top-of-window banner for an available update. The launch check
// itself lives in App (one shared network call); this just renders the result
// and installs on click. Dismissing it leaves the Settings-nav pulse behind as
// a quieter reminder.

export default function UpdateBanner({ update }: { update: Update | null }) {
  const [state, setState] = useState<"idle" | "installing" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

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
