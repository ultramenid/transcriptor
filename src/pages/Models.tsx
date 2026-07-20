import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelEntry, Quant } from "../lib/types";

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const QUANT_LABEL: Record<Quant, string> = {
  compact: "Compact",
  balanced: "Balanced",
  full: "Full",
};

export default function Models() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, { downloaded: number; total: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const list = await invoke<ModelEntry[]>("list_models");
    setModels(list);
  }

  useEffect(() => {
    refresh();
    const unlisten = listen<{ modelId: string; downloaded: number; total: number }>(
      "model-download-progress",
      (e) => {
        setProgress((prev) => ({ ...prev, [e.payload.modelId]: e.payload }));
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  async function download(modelId: string, quant: Quant) {
    setError(null);
    setBusy(`${modelId}:${quant}`);
    try {
      await invoke("download_model", { modelId, quant });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }

  async function remove(modelId: string, quant: Quant) {
    setBusy(`${modelId}:${quant}`);
    try {
      await invoke("delete_model", { modelId, quant });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex-1 px-5 py-10 md:px-12 md:py-14 lg:px-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-ink md:text-3xl">Models</h1>
        <p className="mb-10 text-ink-muted">
          Downloaded once, used fully offline. Choosing a quantization trades size for accuracy.
        </p>

        {error && (
          <p className="mb-6 rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {models.map((m) => (
            <div key={m.id} className="rounded-lg border border-border-subtle bg-panel px-5 py-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-medium text-ink">{m.label}</h2>
                <span className="text-xs text-ink-faint">
                  {m.speed} · {m.accuracy} · {m.languages} · {m.license}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {m.variants.map((v) => {
                  const key = `${m.id}:${v.quant}`;
                  const dl = progress[m.id];
                  const isBusy = busy === key;
                  return (
                    <div
                      key={v.quant}
                      className="flex items-center gap-3 rounded-md border border-border-subtle bg-panel-2 px-3 py-2"
                    >
                      <span className="text-sm text-ink">{QUANT_LABEL[v.quant]}</span>
                      <span className="font-mono text-xs text-ink-faint">{formatBytes(v.sizeBytes)}</span>
                      {v.installed ? (
                        <button
                          disabled={isBusy}
                          onClick={() => remove(m.id, v.quant)}
                          className="text-xs text-ink-faint hover:text-accent disabled:opacity-50"
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          disabled={isBusy}
                          onClick={() => download(m.id, v.quant)}
                          className="rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
                        >
                          {isBusy && dl ? `${formatBytes(dl.downloaded)} / ${formatBytes(dl.total)}` : "Download"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
