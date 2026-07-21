import { useState } from "react";
import type { ModelEntry, Quant } from "../lib/types";
import { formatBytes } from "../lib/format";
import { type Progress } from "../lib/useDownloads";
import AddCustomModelDialog from "../components/AddCustomModelDialog";
import ConfirmDialog from "../components/ConfirmDialog";

// The catalog is an ordered spectrum (tiny → large-v3), so speed and accuracy
// render as 5-step level meters — the backend only ships the words.
const SPEED_LEVEL: Record<string, number> = {
  Slowest: 1,
  Slow: 2,
  Fast: 3,
  "Very fast": 4,
  Fastest: 5,
};
const ACCURACY_LEVEL: Record<string, number> = {
  Lowest: 1,
  Low: 2,
  Moderate: 3,
  High: 4,
  "Very high": 4,
  Highest: 5,
};

// Rising-bar meter, kin to the drop strip's waveform. Unknown level (custom
// models) falls back to plain text.
function Meter({ level, label }: { level?: number; label: string }) {
  if (!level) {
    return <span className="font-mono text-[11px] text-ink-faint">{label || "—"}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-[2.5px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{ height: `${3 + i * 2}px` }}
            className={`w-[3px] rounded-full ${i <= level ? "bg-ink" : "bg-border-subtle"}`}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-ink-muted">{label}</span>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-sm border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.15em] text-ink-muted">
      {children}
    </span>
  );
}

interface Props {
  models: ModelEntry[];
  progress: Record<string, Progress>;
  downloading: Set<string>;
  errors: Record<string, string>;
  onDownload: (modelId: string, quant: Quant) => void;
  onRemove: (modelId: string, quant: Quant) => void;
  onAddCustom: (srcPath: string, label: string, languages: string) => void;
}

const GRID = "grid grid-cols-[minmax(0,1fr)_4.5rem_7rem_7.5rem_6rem] items-center gap-x-3";

export default function Models({
  models,
  progress,
  downloading,
  errors,
  onDownload,
  onRemove,
  onAddCustom,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; quant: Quant; label: string } | null>(null);

  const installed = models.filter((m) => m.variants[0]?.installed);
  const diskBytes = installed.reduce((n, m) => n + (m.variants[0]?.sizeBytes ?? 0), 0);

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Models</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Downloaded once, used fully offline. Larger models are slower but more accurate.
            </p>
            {installed.length > 0 && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                {installed.length} installed · {formatBytes(diskBytes)} on disk
              </p>
            )}
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-md border border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
          >
            Add custom model
          </button>
        </div>

        <div className={`${GRID} border-b border-border-subtle pb-1.5`}>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Model</span>
          <span className="text-right font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Size</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Speed</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Accuracy</span>
          <span />
        </div>

        {models.map((m) => {
          // One variant per model now (full precision).
          const v = m.variants[0];
          if (!v) return null;
          const k = `${m.id}:${v.quant}`;
          const isDownloading = downloading.has(k);
          const dl = progress[k];
          const err = errors[k];
          const pct = dl && dl.total > 0 ? Math.min(100, (dl.downloaded / dl.total) * 100) : 0;
          const isCustom = m.id.startsWith("custom-");

          return (
            <section key={m.id} className="border-b border-border-subtle/60 py-3.5">
              <div className={GRID}>
                <div className="flex min-w-0 items-center gap-2">
                  {v.installed && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink" title="Installed" />
                  )}
                  <span className="truncate text-sm font-medium text-ink" title={m.label}>{m.label}</span>
                  {m.id === "large-v3-turbo" && <Tag>Recommended</Tag>}
                  {isCustom && <Tag>Custom</Tag>}
                  {m.languages === "English only" && <Tag>English</Tag>}
                </div>
                <span className="text-right font-mono text-[11px] tabular-nums text-ink-muted">
                  {formatBytes(v.sizeBytes)}
                </span>
                <Meter level={SPEED_LEVEL[m.speed]} label={m.speed} />
                <Meter level={ACCURACY_LEVEL[m.accuracy]} label={m.accuracy} />
                {v.installed ? (
                  <button
                    disabled={isDownloading}
                    onClick={() => setPendingDelete({ id: m.id, quant: v.quant, label: m.label })}
                    className="justify-self-end font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint transition-colors hover:text-ink disabled:opacity-50"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    disabled={isDownloading}
                    onClick={() => onDownload(m.id, v.quant)}
                    className="justify-self-end rounded-md border border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-50"
                  >
                    {isDownloading ? "Downloading…" : "Download"}
                  </button>
                )}
              </div>

              {dl && (
                <div className="mt-2.5">
                  <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                    {formatBytes(dl.downloaded)} / {formatBytes(dl.total)} · {pct.toFixed(0)}%
                  </span>
                  <div className="mt-1 h-px w-full overflow-hidden bg-border-subtle">
                    <div
                      className="h-full bg-ink transition-[width] duration-150 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}

              {err && <p className="mt-1.5 font-mono text-[10px] text-ink-muted">{err}</p>}
            </section>
          );
        })}
      </div>

      <AddCustomModelDialog
        open={addOpen}
        onConfirm={(sel) => {
          onAddCustom(sel.srcPath, sel.label, sel.languages);
          setAddOpen(false);
        }}
        onCancel={() => setAddOpen(false)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete model?"
        message={`“${pendingDelete?.label ?? ""}” will be removed from disk. Transcripts already made with it are kept. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          const p = pendingDelete;
          setPendingDelete(null);
          if (p) onRemove(p.id, p.quant);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
