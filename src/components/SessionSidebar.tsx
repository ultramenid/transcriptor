import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Work } from "../lib/types";
import { formatRelative, groupByDate } from "../lib/time";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { type MenuEntry } from "./ContextMenu";

export type View = "home" | "transcript" | "models" | "settings";

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

function secondaryLine(w: Work): string {
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
  view: View;
  activeWorkId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onGoModels: () => void;
  onGoSettings: () => void;
  open: boolean;
  onClose: () => void;
}

export default function SessionSidebar({
  view,
  activeWorkId,
  onOpen,
  onNew,
  onGoModels,
  onGoSettings,
  open,
  onClose,
}: Props) {
  const [works, setWorks] = useState<Work[]>([]);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Work | null>(null);
  const [menu, setMenu] = useState<{ work: Work; x: number; y: number } | null>(null);

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

  async function cancelSession(w: Work) {
    await invoke("cancel_work", { id: w.id });
    refresh();
  }
  async function retrySession(w: Work) {
    await invoke("retry_work", { id: w.id });
    refresh();
  }
  async function confirmDelete() {
    const w = pendingDelete;
    setPendingDelete(null);
    if (!w) return;
    await invoke("delete_work", { id: w.id });
    if (w.id === activeWorkId) onNew();
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
      items.push({ label: "Cancel", onClick: () => cancelSession(w) });
    if (w.status === "failed") items.push({ label: "Retry", onClick: () => retrySession(w) });
    if (items.length) items.push({ separator: true });
    items.push({ label: "Rename", onClick: () => startRename(w) });
    items.push({ label: "Delete", onClick: () => setPendingDelete(w), danger: true });
    return items;
  }
  async function onAction(e: React.MouseEvent, w: Work) {
    e.stopPropagation();
    if (w.status === "queued" || w.status === "running") await cancelSession(w);
    else if (w.status === "failed") await retrySession(w);
    else setPendingDelete(w);
  }

  const groups = groupByDate(works);

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          aria-hidden
        />
      )}
      <aside
        className={`fixed z-40 flex h-screen w-72 shrink-0 flex-col border-r border-border-subtle bg-bg transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <button onClick={onNew} className="flex items-center gap-2">
            <span className="flex h-4 items-end gap-[2px]" aria-hidden>
              <span className="h-2 w-[3px] rounded-full bg-ink" />
              <span className="h-4 w-[3px] rounded-full bg-ink" />
              <span className="h-2.5 w-[3px] rounded-full bg-ink" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">Transcriptor</span>
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={onNew}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-faint px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-ink hover:bg-panel"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New transcription
          </button>
        </div>

        <div className="px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions"
            className="w-full rounded-md border border-border-subtle bg-bg px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-ink-faint"
          />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groups.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-ink-faint">
              {query.trim() ? "No matches." : "No transcriptions yet."}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map((w) => {
                  const active = w.id === activeWorkId;
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
                      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-md py-2 pl-3 pr-2 outline-none transition-colors ${
                        active ? "bg-panel" : "hover:bg-panel/60"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full ${active ? "bg-ink" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <StatusDot status={w.status} />
                      <div className="min-w-0 flex-1">
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
                        <p className="truncate font-mono text-[11px] tabular-nums text-ink-faint">
                          {secondaryLine(w)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => onAction(e, w)}
                        aria-label={actionLabel(w.status)}
                        title={actionLabel(w.status)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                      >
                        <ActionIcon status={w.status} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between border-t border-border-subtle px-2 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={onGoModels}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                view === "models" ? "bg-panel text-ink" : "text-ink-faint hover:bg-panel hover:text-ink-muted"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2.5 6.5h11M5.5 9.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Models
            </button>
            <button
              onClick={onGoSettings}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                view === "settings" ? "bg-panel text-ink" : "text-ink-faint hover:bg-panel hover:text-ink-muted"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              Settings
            </button>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.work)}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete transcript?"
        message={`“${pendingDelete?.sourceFilename ?? ""}” and its transcript will be removed from your library. This can't be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}