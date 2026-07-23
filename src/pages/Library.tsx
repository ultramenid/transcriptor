import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ModelEntry, PendingFile, Work } from "../lib/types";
import { formatDuration, formatRelative, groupByDate } from "../lib/time";
import { MEDIA_EXTENSIONS } from "../App";
import { basename } from "../lib/format";
import LanguageSelect from "../components/LanguageSelect";
import PickerCell from "../components/Picker";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type MenuEntry } from "../components/ContextMenu";

// Static waveform silhouette for the drop strip. Deterministic heights so the
// layout never jitters on re-render.
const BAR_HEIGHTS = [
  22, 40, 18, 55, 30, 70, 45, 25, 60, 35, 50, 20, 65, 40, 28, 58, 33, 48, 20,
  62, 38, 26, 52, 30, 44, 18, 56, 32,
];

function StatusDot({ status }: { status: Work["status"] }) {
  const cls =
    status === "running"
      ? "bg-ink animate-pulse"
      : status === "queued"
        ? "bg-ink-faint"
        : status === "failed"
          ? "border border-ink"
          : status === "cancelled"
            ? "bg-border-subtle"
            : "bg-ink-muted";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full motion-reduce:animate-none ${cls}`} aria-hidden />;
}

function statusLine(w: Work): string {
  switch (w.status) {
    case "running":
      return "Transcribing…";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return formatRelative(Number(w.createdAt));
  }
}

function ActionIcon({ status }: { status: Work["status"] }) {
  if (status === "queued" || status === "running") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M13 8a5 5 0 1 1-2.2-4.14M13 3v2.4h-2.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 9h4.8L11 4M7 7v4M9 7v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function actionLabel(status: Work["status"]): string {
  if (status === "queued" || status === "running") return "Cancel";
  if (status === "failed") return "Retry";
  return "Delete";
}

interface Props {
  models: ModelEntry[];
  onFiles: (paths: string[]) => void;
  pending: PendingFile[];
  onPendingChange: (index: number, patch: Partial<PendingFile>) => void;
  onRemovePending: (index: number) => void;
  onClearPending: () => void;
  onRun: () => void;
  onOpen: (id: string) => void;
  onGoModels: () => void;
  rejected: boolean;
}

export default function Library({
  models,
  onFiles,
  pending,
  onPendingChange,
  onRemovePending,
  onClearPending,
  onRun,
  onOpen,
  onGoModels,
  rejected,
}: Props) {
  const [works, setWorks] = useState<Work[]>([]);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Work | null>(null);
  const [menu, setMenu] = useState<{ work: Work; x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "transcript" | "subtitle">("all");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const installed = models.filter((m) => m.variants.some((v) => v.installed));

  const refresh = useCallback(async () => {
    const list = query.trim()
      ? await invoke<Work[]>("search_library", { query })
      : await invoke<Work[]>("list_library");
    setWorks(list);
  }, [query]);

  useEffect(() => {
    refresh();
    const unlisten = listen("queue-updated", refresh);
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  async function browse() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio & video", extensions: Array.from(MEDIA_EXTENSIONS) }],
    });
    if (!selected) return;
    onFiles(Array.isArray(selected) ? selected : [selected]);
  }

  async function importSubtitle() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const id = await invoke<string>("import_subtitle", { path: picked });
      onOpen(id);
    } catch (e) {
      setImportMsg(String(e));
      setTimeout(() => setImportMsg(null), 4000);
    }
  }

  async function cancelWork(w: Work) {
    await invoke("cancel_work", { id: w.id });
    refresh();
  }
  async function retryWork(w: Work) {
    await invoke("retry_work", { id: w.id });
    refresh();
  }
  async function confirmDelete() {
    const w = pendingDelete;
    setPendingDelete(null);
    if (!w) return;
    await invoke("delete_work", { id: w.id });
    refresh();
  }
  function startRename(w: Work) {
    setRenamingId(w.id);
    setRenameValue(w.sourceFilename);
  }
  async function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (!id || !name || name === works.find((w) => w.id === id)?.sourceFilename) return;
    await invoke("rename_work", { id, name });
    refresh();
  }
  function menuItems(w: Work): MenuEntry[] {
    const items: MenuEntry[] = [];
    if (w.status === "queued" || w.status === "running")
      items.push({ label: "Cancel", onClick: () => cancelWork(w) });
    if (w.status === "failed") items.push({ label: "Retry", onClick: () => retryWork(w) });
    if (items.length) items.push({ separator: true });
    items.push({ label: "Rename", onClick: () => startRename(w) });
    items.push({ label: "Delete", onClick: () => setPendingDelete(w), danger: true });
    return items;
  }
  async function onAction(e: React.MouseEvent, w: Work) {
    e.stopPropagation();
    if (w.status === "queued" || w.status === "running") await cancelWork(w);
    else if (w.status === "failed") await retryWork(w);
    else setPendingDelete(w);
  }

  // Imported subtitles carry kind "subtitle"; everything else is a transcript.
  const subtitleCount = works.filter((w) => w.kind === "subtitle").length;
  const filtered =
    filter === "all" ? works : works.filter((w) => (w.kind ?? "transcript") === filter);
  const groups = groupByDate(filtered);
  const empty = works.length === 0 && !query.trim();

  const filterTab = (v: typeof filter) =>
    `rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
      filter === v ? "bg-ink text-bg" : "text-ink-faint hover:text-ink-muted"
    }`;

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        {/* Drop strip — the instrument's input. Grows into a hero when the
            library is empty; the actual drop target is the whole window. */}
        <div
          onClick={browse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") browse();
          }}
          className={`group flex cursor-pointer flex-col items-center justify-center gap-5 rounded-xl border border-border-subtle bg-panel text-center transition-colors hover:border-border-strong ${
            empty ? "px-8 py-20" : "px-6 py-8"
          }`}
        >
          <div className={`pointer-events-none flex items-end gap-[3px] ${empty ? "h-16" : "h-8"}`}>
            {BAR_HEIGHTS.map((h, i) => (
              <span
                key={i}
                style={{ height: `${h}%`, animationDelay: `${((i * 53) % 100) / 100}s` }}
                className="w-[3px] origin-bottom rounded-full bg-ink-faint/70 animate-[wave_3.2s_ease-in-out_infinite] group-hover:bg-ink-muted motion-reduce:animate-none"
              />
            ))}
          </div>
          <div className="pointer-events-none space-y-1">
            <p className={`font-medium tracking-tight text-ink ${empty ? "text-xl" : "text-base"}`}>
              Drop audio or video anywhere
            </p>
            <p className="text-sm text-ink-muted">
              or <span className="text-ink">click to browse</span> — any length, nothing leaves your machine
            </p>
          </div>
        </div>

        {rejected && (
          <p className="mt-3 text-center font-mono text-xs text-ink-muted">
            That doesn’t look like an audio or video file.
          </p>
        )}

        <p className="mt-3 text-center text-sm text-ink-muted">
          Already have subtitles?{" "}
          <button onClick={importSubtitle} className="text-ink underline underline-offset-2 hover:opacity-80">
            Import an .srt or .vtt
          </button>{" "}
          to edit
        </p>
        {importMsg && (
          <p className="mt-2 text-center font-mono text-xs text-ink-muted">{importMsg}</p>
        )}

        {/* Staged batch — review files, pick model + language, then run. The
            list is the "complete all files" step; nothing enqueues until Run. */}
        {pending.length > 0 && (
          <div className="mt-4 rounded-lg border border-border-subtle bg-panel">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                Ready to transcribe · {pending.length}
              </p>
              <button
                onClick={onClearPending}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
              >
                Clear
              </button>
            </div>

            {installed.length === 0 ? (
              <div className="px-4 py-3 text-center">
                <p className="text-sm text-ink">
                  No model installed yet.{" "}
                  <button onClick={onGoModels} className="font-medium text-ink underline">
                    Pick and download one
                  </button>{" "}
                  before transcribing.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_11rem_10rem_1.5rem] items-center gap-x-3 border-b border-border-subtle/60 px-3 py-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">File</span>
                  <span className="pl-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Model</span>
                  <span className="pl-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">Language</span>
                  <span />
                </div>
                {pending.map((p, i) => {
                  return (
                    <div
                      key={p.path}
                      className="group grid grid-cols-[1.5rem_minmax(0,1fr)_11rem_10rem_1.5rem] items-center gap-x-3 border-b border-border-subtle/60 px-3 py-1.5"
                    >
                      <span className="text-right font-mono text-[10px] tabular-nums text-ink-faint">
                        {i + 1}
                      </span>
                      <p className="min-w-0 truncate text-sm text-ink" title={p.path}>
                        {basename(p.path)}
                      </p>
                      <PickerCell
                        compact
                        label="Model"
                        value={p.model}
                        onChange={(id) => onPendingChange(i, { model: id })}
                        options={installed.map((m) => ({ value: m.id, label: m.label }))}
                      />
                      <LanguageSelect
                        compact
                        value={p.language}
                        onChange={(l) => onPendingChange(i, { language: l })}
                      />
                      <button
                        onClick={() => onRemovePending(i)}
                        aria-label={`Remove ${basename(p.path)}`}
                        title="Remove"
                        className="flex h-5 w-5 items-center justify-center justify-self-end rounded text-ink-faint opacity-0 transition-opacity hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={onRun}
                  className="block w-full rounded-b-lg bg-ink px-4 py-3 text-center text-sm font-medium text-bg transition-opacity hover:opacity-90"
                >
                  Transcribe {pending.length} {pending.length === 1 ? "file" : "files"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Library table */}
        {(works.length > 0 || query.trim()) && (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                  Library · {filtered.length}
                </p>
                {subtitleCount > 0 && (
                  <div className="flex gap-1 rounded-md border border-border-subtle bg-panel p-0.5">
                    {([
                      ["all", "All"],
                      ["transcript", "Transcripts"],
                      ["subtitle", "Subtitles"],
                    ] as const).map(([v, label]) => (
                      <button key={v} onClick={() => setFilter(v)} className={filterTab(v)}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts"
                className="w-56 rounded-md border border-border-subtle bg-bg px-3 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-ink-faint"
              />
            </div>

            {groups.length === 0 && (
              <p className="border-t border-border-subtle py-10 text-center font-mono text-xs text-ink-faint">
                {query.trim() ? `No matches for “${query}”.` : "Nothing here yet."}
              </p>
            )}

            {groups.map((g) => (
              <section key={g.label} className="mb-6">
                <p className="border-b border-border-subtle pb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                  {g.label}
                </p>
                {g.items.map((w) => {
                  const renaming = renamingId === w.id;
                  return (
                    <div
                      key={w.id}
                      role="button"
                      tabIndex={renaming ? -1 : 0}
                      onClick={() => {
                        if (!renaming) onOpen(w.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ work: w, x: e.clientX, y: e.clientY });
                      }}
                      onKeyDown={(e) => {
                        if (renaming) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpen(w.id);
                        }
                      }}
                      className="group grid cursor-pointer grid-cols-[0.75rem_minmax(0,1fr)_5rem_9rem_6.5rem_2rem] items-center gap-x-3 border-b border-border-subtle/60 py-2.5 outline-none transition-colors hover:bg-panel"
                    >
                      <StatusDot status={w.status} />
                      {renaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                          onBlur={commitRename}
                          className="w-full rounded-sm border border-ink-faint bg-bg px-1.5 py-0.5 text-sm text-ink outline-none"
                        />
                      ) : (
                        <p className="truncate text-sm text-ink">{w.sourceFilename}</p>
                      )}
                      <span className="text-right font-mono text-[11px] tabular-nums text-ink-muted">
                        {w.durationSecs != null ? formatDuration(w.durationSecs) : "—"}
                      </span>
                      <span className="truncate font-mono text-[11px] text-ink-faint">
                        {w.modelId ?? (w.kind === "subtitle" ? "SRT" : "—")}
                      </span>
                      <span className="text-right font-mono text-[11px] tabular-nums text-ink-faint">
                        {statusLine(w)}
                      </span>
                      <button
                        onClick={(e) => onAction(e, w)}
                        aria-label={actionLabel(w.status)}
                        title={actionLabel(w.status)}
                        className="flex h-6 w-6 items-center justify-center justify-self-end rounded text-ink-faint opacity-0 transition-opacity hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                      >
                        <ActionIcon status={w.status} />
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.work)} onClose={() => setMenu(null)} />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete transcript?"
        message={`“${pendingDelete?.sourceFilename ?? ""}” and its transcript will be removed from your library. This can't be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
