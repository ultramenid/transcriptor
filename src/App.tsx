import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "./App.css";
import Header from "./components/Header";
import ErrorBoundary from "./components/ErrorBoundary";
import UpdateBanner from "./components/UpdateBanner";
import Library from "./pages/Library";
import Transcript from "./pages/Transcript";
import Models from "./pages/Models";
import Settings from "./pages/Settings";
import type { PendingFile } from "./lib/types";
import { useDownloads } from "./lib/useDownloads";

export type View = "library" | "transcript" | "models" | "settings";

const MEDIA_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "wma",
  "mp4", "mkv", "mov", "avi", "webm", "m4v",
]);

function isMediaFile(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MEDIA_EXTENSIONS.has(ext) : false;
}

export { MEDIA_EXTENSIONS };

function App() {
  const [view, setView] = useState<View>("library");
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);

  // Enqueue configuration lives at the shell so a drop works from any view,
  // not just the library. The pickers on the library page edit this state.
  // Downloads also live at the shell so they keep running when the user
  // navigates away from the Models page.
  const {
    models,
    progress: downloadProgress,
    downloading,
    errors: downloadErrors,
    download,
    remove: removeModel,
    addCustom,
  } = useDownloads();
  const [model, setModel] = useState("");
  const [language] = useState("auto");

  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);

  const installed = models.filter((m) => m.variants.some((v) => v.installed));

  // Pin the selection to a real installed model. Default to the recommended
  // large-v3-turbo if installed, else the first installed.
  useEffect(() => {
    if (installed.length === 0) return;
    if (!installed.some((m) => m.id === model)) {
      const pick = installed.find((m) => m.id === "large-v3-turbo") ?? installed[0];
      setModel(pick.id);
    }
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide the default webview context menu app-wide; the library ships its own
  // right-click menu where it matters.
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // Global drag-and-drop: dropping a media file anywhere in the app enqueues
  // it. The overlay below is the only drop feedback any view needs.
  const handleFilesRef = useRef<(paths: string[]) => void>(() => {});
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") {
        setDragging(true);
      } else if (e.payload.type === "drop") {
        setDragging(false);
        const media = e.payload.paths.filter(isMediaFile);
        if (media.length > 0) handleFilesRef.current(media);
        else setRejected(true);
      } else {
        setDragging(false);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!rejected) return;
    const t = setTimeout(() => setRejected(false), 2500);
    return () => clearTimeout(t);
  }, [rejected]);

  // Dropped/browsed files stage into a pending list first — the user reviews
  // the batch, picks model + language per file, then hits Run. Nothing
  // enqueues early.
  const [pending, setPending] = useState<PendingFile[]>([]);

  function handleFiles(paths: string[]) {
    setPending((prev) => {
      // Default new files to the current shared selection, which itself pins to
      // an installed model (see the effect above).
      const existing = new Set(prev.map((p) => p.path));
      const next: PendingFile[] = [];
      for (const path of paths) {
        if (existing.has(path)) continue;
        existing.add(path);
        next.push({ path, model, quant: "full", language });
      }
      return [...prev, ...next];
    });
    setView("library");
  }
  handleFilesRef.current = handleFiles;

  async function runPending() {
    if (pending.length === 0) return;
    // Validate: every file must have an installed model. Skip otherwise
    // (shouldn't happen since pickers only offer installed models).
    const ready = pending.filter((p) =>
      models.some((m) => m.id === p.model && m.variants.some((v) => v.installed)),
    );
    if (ready.length === 0) return;
    const firstIds: string[] = [];
    for (const p of ready) {
      const ids = await invoke<string[]>("enqueue_files", {
        paths: [p.path],
        modelId: p.model,
        quant: "full",
        language: p.language === "auto" ? null : p.language,
      });
      if (ids.length) firstIds.push(ids[0]);
    }
    setPending([]);
    if (firstIds.length > 0) openWork(firstIds[0]);
  }

  function openWork(id: string) {
    setActiveWorkId(id);
    setView("transcript");
  }

  function goLibrary() {
    setActiveWorkId(null);
    setView("library");
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-ink antialiased">
      <Header view={view} onGo={setView} onBack={goLibrary} />
      <UpdateBanner />

      <div className="min-h-0 flex-1">
        {/* Keyed on the view+work so a caught error clears when you navigate. */}
        <ErrorBoundary key={`${view}:${activeWorkId ?? ""}`} onReset={goLibrary}>
        {view === "library" && (
          <Library
            models={models}
            onFiles={handleFiles}
            pending={pending}
            onPendingChange={(index, patch) =>
              setPending((prev) =>
                prev.map((p, j) => (j === index ? { ...p, ...patch } : p)),
              )
            }
            onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
            onClearPending={() => setPending([])}
            onRun={runPending}
            onOpen={openWork}
            onGoModels={() => setView("models")}
            rejected={rejected}
          />
        )}
        {view === "transcript" && activeWorkId && (
          <Transcript workId={activeWorkId} onDelete={goLibrary} />
        )}
        {view === "models" && (
          <Models
            models={models}
            progress={downloadProgress}
            downloading={downloading}
            errors={downloadErrors}
            onDownload={download}
            onRemove={removeModel}
            onAddCustom={addCustom}
          />
        )}
        {view === "settings" && <Settings />}
        </ErrorBoundary>
      </div>

      {/* Full-window drop overlay — the one drop target for the whole app. */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-bg/95 backdrop-blur-sm">
          <div className="flex h-20 items-end gap-[3px]" aria-hidden>
            {[38, 62, 30, 80, 48, 95, 60, 36, 84, 52, 70, 32, 90, 56, 42, 76, 46, 66, 34, 88].map(
              (h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%`, animationDelay: `${((i * 53) % 100) / 100}s` }}
                  className="w-1 origin-bottom rounded-full bg-ink animate-[wave_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
                />
              ),
            )}
          </div>
          <div className="space-y-2 text-center">
            <p className="text-2xl font-semibold tracking-tight text-ink">Release to transcribe</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
              Audio · Video — processed on this machine
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
