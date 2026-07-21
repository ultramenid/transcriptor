import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelEntry, Quant, Segment, Work } from "../lib/types";
import { formatDuration, formatTimecode } from "../lib/time";
import Waveform from "../components/Waveform";
import ConfirmDialog from "../components/ConfirmDialog";
import RerunDialog, { type RerunSelection } from "../components/RerunDialog";

const EXPORT_FORMATS = ["txt", "srt", "vtt", "json", "article"] as const;

// Placeholder used only when a RerunDialog is closed — its `initial` prop is
// evaluated on every render, so it must never throw even before models load.
// The dialog resets from `initial` to the real pending selection on open.
const PLACEHOLDER_SELECTION: RerunSelection = { modelId: "", quant: "full", language: "auto" };

const REDUCED_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// whisper hands over a whole 30 s chunk at once, so segments would otherwise
// blink in as finished blocks. Typing the newest one out makes the live pass
// read like the words are being written into the timeline as the playhead
// crosses them. Capped at ~60 ticks so a long segment still lands in ~1 s.
function LiveText({ text }: { text: string }) {
  const [shown, setShown] = useState(REDUCED_MOTION ? text.length : 0);
  useEffect(() => {
    if (REDUCED_MOTION) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(1, Math.ceil(text.length / 60));
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + step;
      });
    }, 16);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, shown)}</>;
}

export default function Transcript({ workId, onDelete }: { workId: string; onDelete: () => void }) {
  const [work, setWork] = useState<Work | null>(null);
  const [liveSegments, setLiveSegments] = useState<Segment[]>([]);
  const [editedSegments, setEditedSegments] = useState<Segment[] | null>(null);
  const [progress, setProgress] = useState(0);
  // Real waveform of the decoded audio, pushed once the WAV is ready — i.e.
  // before any text exists. Live only; a reopened work falls back to the
  // transcript-derived wave.
  const [audio, setAudio] = useState<{ durationSecs: number; peaks: number[] } | null>(null);
  const [view, setView] = useState<"timestamped" | "article">("timestamped");
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-run with a different model + quality + language: both whole-file and
  // per-segment re-run open a dialog. The dialog state carries either nothing
  // (whole-file) or the segment index to replace (per-segment).
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [pendingRerun, setPendingRerun] = useState<RerunSelection | null>(null);
  const [pendingSegRerun, setPendingSegRerun] = useState<{ index: number } & RerunSelection | null>(null);
  const [rerunningIndex, setRerunningIndex] = useState<number | null>(null);

  useEffect(() => {
    invoke<ModelEntry[]>("list_models").then(setModels);
  }, []);

  const canRerun = models.some((m) => m.variants.some((v) => v.installed));

  // Default selection for a re-run dialog: the work's current model/quant,
  // falling back to the first installed model variant if that one isn't installed
  // anymore (e.g. it was deleted after the original run). Language defaults to
  // the stored language, or auto. Returns null if no installed model is available
  // yet (e.g. before the model list has loaded) — callers should only invoke
  // this when they know a re-run is possible.
  function defaultRerunSelection(): RerunSelection | null {
    const installed = models.filter((m) => m.variants.some((v) => v.installed));
    if (work?.modelId && work.quant) {
      const curModel = models.find((m) => m.id === work.modelId);
      const curInstalled = curModel?.variants.some(
        (v) => v.quant === work.quant && v.installed,
      );
      if (curInstalled) {
        return {
          modelId: work.modelId,
          quant: work.quant as Quant,
          language: work?.language ?? "auto",
        };
      }
    }
    const first = installed[0];
    if (!first) return null;
    const firstVariant = first.variants.find((v) => v.installed);
    if (!firstVariant) return null;
    return {
      modelId: first.id,
      quant: firstVariant.quant,
      language: work?.language ?? "auto",
    };
  }

  const loadWork = useCallback(() => {
    invoke<Work | null>("get_work", { id: workId }).then((w) => {
      if (w) setWork(w);
    });
  }, [workId]);

  useEffect(() => {
    setLiveSegments([]);
    setEditedSegments(null);
    setProgress(0);
    setAudio(null);
    setPlaying(false);
    setCurrentTime(0);
    loadWork();

    const unlistenSeg = listen<{ workId: string; segment: Segment }>("transcribe-segment", (e) => {
      if (e.payload.workId !== workId) return;
      setLiveSegments((prev) => [...prev, e.payload.segment]);
    });
    const unlistenAudio = listen<{ workId: string; durationSecs: number; peaks: number[] }>(
      "transcribe-audio",
      (e) => {
        if (e.payload.workId !== workId) return;
        setAudio({ durationSecs: e.payload.durationSecs, peaks: e.payload.peaks });
      },
    );
    const unlistenProgress = listen<{ workId: string; progress: number }>("transcribe-progress", (e) => {
      if (e.payload.workId !== workId) return;
      setProgress(e.payload.progress);
    });
    const unlistenQueue = listen("queue-updated", loadWork);
    return () => {
      unlistenSeg.then((f) => f());
      unlistenAudio.then((f) => f());
      unlistenProgress.then((f) => f());
      unlistenQueue.then((f) => f());
    };
  }, [workId, loadWork]);

  const isRunning = work?.status === "running" || work?.status === "queued";
  // A per-segment re-run flips status to running then back to done, but the
  // rest of the transcript is unchanged — keep showing the finished segments
  // and just pulse the affected row instead of swapping to live sub-segments.
  const isSegRerunning = rerunningIndex !== null;
  const segments =
    work?.status === "done" || isSegRerunning
      ? editedSegments ?? work?.segments ?? []
      : liveSegments;

  // A per-segment re-run sets status to running then back to done; clear the
  // pulsing row indicator once the work is done again.
  useEffect(() => {
    if (work?.status === "done") setRerunningIndex(null);
  }, [work?.status, work?.updatedAt]);

  // Wall-clock time since transcription started. Started the moment work flips
  // to running, frozen when it stops. The interval lives only while running, so
  // it can't leak across the done/idle lifecycle.
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!isRunning) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    if (startedAt.current == null) startedAt.current = Date.now();
    const id = setInterval(() => {
      if (startedAt.current != null) setElapsed((Date.now() - startedAt.current) / 1000);
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Two phases the user can feel: ffmpeg decoding the audio (no percentage to
  // report yet), then whisper working through 30 s chunks.
  const preparing = isRunning && !audio && progress === 0 && segments.length === 0;
  const queued = work?.status === "queued";
  // Rough ETA from the run's own pace. Suppressed early — chunk-granular
  // progress makes the first estimates wildly wrong.
  const remaining = !preparing && progress >= 20 && elapsed > 0
    ? (elapsed / progress) * (100 - progress)
    : null;

  // Subtitle-edit selection. While transcribing, the selection auto-follows
  // the live (last) subtitle so the waveform block tracks progress. When done,
  // the clicked row is selected; clicking the waveform selects the subtitle
  // under the cursor.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const liveRowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const srcUrl = work?.sourcePath ? convertFileSrc(work.sourcePath) : null;

  const liveIdx = segments.length - 1;

  // Active subtitle while audio plays: the last segment that has started.
  const playingIndex = (() => {
    if (!playing || !segments.length) return -1;
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= currentTime) idx = i;
      else break;
    }
    return idx;
  })();

  // One source of truth for the active subtitle: `selectedIndex`. Playback
  // writes into it (below) rather than shadowing it, so pausing leaves the
  // selection on the subtitle that was playing instead of snapping back.
  const selIdx = isRunning && !isSegRerunning
    ? segments.length ? liveIdx : -1
    : segments.length ? Math.min(selectedIndex, segments.length - 1) : -1;
  const selection = selIdx >= 0 ? { start: segments[selIdx].start, end: segments[selIdx].end } : null;

  function togglePlay() {
    const a = audioRef.current;
    if (!a || !srcUrl) return;
    if (a.paused) a.play();
    else a.pause();
  }
  function seekTo(t: number) {
    const a = audioRef.current;
    if (a) a.currentTime = t;
    setCurrentTime(t);
  }

  // Follow the live subtitle like a player follows the playing line.
  useEffect(() => {
    if (isRunning && liveRowRef.current) {
      liveRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [segments.length, isRunning]);

  // Follow the playing subtitle as audio plays: it becomes the selection, and
  // the row scrolls into view.
  useEffect(() => {
    if (!playing || playingIndex < 0) return;
    setSelectedIndex(playingIndex);
    const el = gridRef.current?.querySelector(`[data-idx="${playingIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [playingIndex, playing]);

  // Video-editor keys, global like a timeline: space = play/pause, ArrowUp /
  // ArrowDown = step subtitles — moving the selection AND seeking the audio, so
  // arrows and space always act on the same subtitle (arrows work mid-playback
  // too). Skipped while transcribing and while typing in a field or editing a
  // subtitle so the keys reach the text instead.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSpace = e.key === " " || e.code === "Space";
      const isArrow = e.key === "ArrowDown" || e.key === "ArrowUp";
      if (!isSpace && !isArrow) return;
      if (isRunning) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (isSpace) {
        if (!srcUrl) return;
        e.preventDefault();
        togglePlay();
        return;
      }
      if (segments.length === 0) return;
      e.preventDefault();
      // Step from what the user currently sees as active — which tracks
      // playback too, so arrows work mid-playback without a second code path.
      const base = Math.min(selectedIndex, segments.length - 1);
      const next = Math.max(0, Math.min(segments.length - 1, base + (e.key === "ArrowDown" ? 1 : -1)));
      setSelectedIndex(next);
      if (srcUrl) seekTo(segments[next].start);
      const row = gridRef.current?.querySelector<HTMLDivElement>(`[data-idx="${next}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRunning, srcUrl, togglePlay, segments, selectedIndex]);

  async function doCancel() {
    await invoke("cancel_work", { id: workId });
    loadWork();
  }
  async function doRetry() {
    await invoke("retry_work", { id: workId });
    loadWork();
  }
  async function doRerun(sel: RerunSelection) {
    setLiveSegments([]);
    setEditedSegments(null);
    setProgress(0);
    await invoke("rerun_work", {
      id: workId,
      modelId: sel.modelId,
      quant: sel.quant,
      language: sel.language,
    });
    loadWork();
  }
  function requestRerun() {
    const sel = defaultRerunSelection();
    if (sel) setPendingRerun(sel);
  }
  async function doRerunSegment(index: number, sel: RerunSelection) {
    const seg = segments[index];
    if (!seg || !work?.sourcePath) return;
    setRerunningIndex(index);
    setLiveSegments([]);
    setEditedSegments(null);
    try {
      await invoke("rerun_segment", {
        id: workId,
        modelId: sel.modelId,
        quant: sel.quant,
        language: sel.language,
        start: seg.start,
        end: seg.end,
        index,
      });
    } catch (e) {
      setRerunningIndex(null);
      setExportMsg(String(e));
    }
    loadWork();
  }
  function requestSegRerun(index: number) {
    const sel = defaultRerunSelection();
    if (sel) setPendingSegRerun({ index, ...sel });
  }
  async function doDelete() {
    await invoke("delete_work", { id: workId });
    onDelete();
  }

  async function editSegment(index: number, text: string) {
    const base = editedSegments ?? work?.segments ?? [];
    if (base[index]?.text === text) return;
    const next = base.map((s, i) => (i === index ? { ...s, text } : s));
    setEditedSegments(next);
    await invoke("update_transcript", { id: workId, segments: next });
  }

  // Export feedback is transient — a transport-bar toast, not page state.
  useEffect(() => {
    if (!exportMsg) return;
    const t = setTimeout(() => setExportMsg(null), 4000);
    return () => clearTimeout(t);
  }, [exportMsg]);

  async function doExport(format: string) {
    setExportMsg(null);
    try {
      const path = await invoke<string>("export_transcript", { id: workId, format });
      setExportMsg(`Saved to ${path}`);
    } catch (e) {
      setExportMsg(String(e));
    }
  }

  async function copyToClipboard() {
    const content = await invoke<string>("preview_export", { id: workId, format: "txt" });
    await navigator.clipboard.writeText(content);
    setExportMsg("Copied to clipboard");
  }

  const transportBtn =
    "rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink";

  return (
    <main className="relative flex h-full flex-col">
      <audio
        ref={audioRef}
        src={srcUrl ?? undefined}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      {/* Scrollable document area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-10 md:px-10">
          <div className="flex items-center justify-between gap-4 py-6">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                {work?.sourceFilename ?? "Transcribing…"}
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">
                {work?.modelId ?? "—"}
                {work?.quant ? ` · ${work.quant}` : ""} · {work?.language ?? "—"}
                {work?.durationSecs != null ? ` · ${formatDuration(work.durationSecs)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {work?.sourcePath && canRerun && !isRunning && (
                <button
                  onClick={requestRerun}
                  className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
                >
                  Re-run
                </button>
              )}
              <div className="flex gap-1 rounded-md border border-border-subtle bg-panel p-1">
                {(["timestamped", "article"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      view === v ? "bg-ink text-bg" : "text-ink-faint hover:text-ink-muted"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {view === "timestamped" && (work?.durationSecs != null || segments.length > 0 || isRunning) && (
            <div className="sticky top-0 z-20 -mx-1 bg-bg/95 px-1 pb-3 pt-1 backdrop-blur">
              <Waveform
                durationSecs={audio?.durationSecs ?? work?.durationSecs ?? null}
                segments={segments}
                peaks={audio?.peaks ?? null}
                progress={progress}
                running={isRunning && !isSegRerunning}
                currentTime={!isRunning || isSegRerunning ? currentTime : null}
                selection={selection}
                onSelect={(i) => setSelectedIndex(i)}
                onSeek={seekTo}
                onScrubStart={() => audioRef.current?.pause()}
              />
            </div>
          )}

          {work?.status === "failed" && (
            <div className="mb-8 rounded-md border border-border-subtle bg-panel px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Error</p>
              <p className="mt-1 text-sm text-ink">{work.error}</p>
            </div>
          )}

          {view === "timestamped" ? (
            <>
              {segments.length > 0 && (
                <div ref={gridRef} className="border-t border-border-subtle">
                  {/* Column header */}
                  <div className="grid grid-cols-[2.5rem_7.5rem_7.5rem_4.5rem_1fr_5.5rem] border-b border-border-subtle bg-bg font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                    <span className="px-2 py-2 text-right">#</span>
                    <span className="px-2 py-2">Start</span>
                    <span className="px-2 py-2">End</span>
                    <span className="px-2 py-2 text-right">Dur</span>
                    <span className="px-3 py-2">Text</span>
                    <span />
                  </div>

                  {segments.map((s, i) => {
                    const isLive = isRunning && !isSegRerunning && i === liveIdx;
                    const isSel = i === selIdx;
                    const isRerunning = rerunningIndex === i;
                    const rowCanRerun = canRerun && work?.status === "done" && !!work.sourcePath && !isRunning;
                    return (
                      <div
                        key={i}
                        data-idx={i}
                        ref={isLive ? liveRowRef : undefined}
                        tabIndex={0}
                        onClick={(e) => {
                          setSelectedIndex(i);
                          if (
                            !isRunning &&
                            audioRef.current &&
                            srcUrl &&
                            !(e.target instanceof HTMLElement && e.target.isContentEditable)
                          ) {
                            seekTo(segments[i].start);
                          }
                        }}
                        onFocus={() => setSelectedIndex(i)}
                        // An hour of audio is thousands of rows; skip painting
                        // the off-screen ones. `auto` remembers each row's real
                        // height once measured, so the scrollbar stays honest.
                        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 2.4rem" }}
                        onKeyDown={(e) => {
                          // Arrows are handled globally (selection + seek).
                          if (isRunning) return;
                          if (e.key === "Enter" && work?.status === "done") {
                            e.preventDefault();
                            e.currentTarget.querySelector<HTMLParagraphElement>("p[contenteditable]")?.focus();
                          }
                        }}
                        className={`group grid scroll-mt-32 cursor-pointer grid-cols-[2.5rem_7.5rem_7.5rem_4.5rem_1fr_5.5rem] items-start border-b border-border-subtle/60 border-l-2 outline-none ${
                          isSel ? "border-l-ink bg-panel-2" : "border-l-transparent hover:bg-panel"
                        }`}
                      >
                        <span
                          className={`px-2 py-2.5 text-right font-mono text-[11px] tabular-nums ${
                            isSel ? "text-ink" : "text-ink-faint"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`px-2 py-2.5 font-mono text-[11px] tabular-nums ${
                            isSel ? "text-ink" : "text-ink-muted"
                          }`}
                        >
                          {formatTimecode(s.start)}
                        </span>
                        <span
                          className={`px-2 py-2.5 font-mono text-[11px] tabular-nums ${
                            isSel ? "text-ink" : "text-ink-muted"
                          }`}
                        >
                          {formatTimecode(s.end)}
                        </span>
                        <span className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums text-ink-faint">
                          {(s.end - s.start).toFixed(2)}
                        </span>
                        {/* The caret is a SIBLING of the editable <p>, never a
                           child: a contentEditable element whose children React
                           tracks as an array can throw NotFoundError once the
                           browser rewrites the DOM during editing, which
                           unmounts the tree and blanks the window. One text
                           child keeps React on the crash-proof setTextContent
                           path. */}
                        <div className="flex items-baseline gap-1 px-3 py-2">
                          <p
                            className={`min-w-0 flex-1 text-sm leading-snug text-ink outline-none ${
                              isRerunning ? "animate-pulse motion-reduce:animate-none" : ""
                            }`}
                            contentEditable={work?.status === "done"}
                            suppressContentEditableWarning
                            onBlur={(e) => editSegment(i, e.currentTarget.textContent ?? "")}
                          >
                            {isLive ? <LiveText text={s.text} /> : s.text}
                          </p>
                          {isLive && (
                            <span
                              aria-hidden
                              className="h-[0.9em] w-[2px] shrink-0 self-center bg-ink animate-pulse motion-reduce:animate-none"
                            />
                          )}
                        </div>
                        <div className="relative flex items-start justify-end pr-2 pt-1.5">
                          {isRerunning ? (
                            <span className="flex items-center gap-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-ink animate-pulse motion-reduce:animate-none"
                                aria-hidden
                              />
                              Re-running
                            </span>
                          ) : rowCanRerun ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                requestSegRerun(i);
                              }}
                              aria-label={`Re-run segment ${i + 1}`}
                              title="Re-transcribe just this segment"
                              className={`flex items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted transition-all hover:border-border-strong hover:text-ink focus:opacity-100 group-hover:opacity-100 ${
                                isSel ? "opacity-100" : "opacity-0"
                              }`}
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                                <path
                                  d="M13 8a5 5 0 1 1-2.2-4.14M13 3v2.4h-2.4"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              Re-run
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {segments.length === 0 && !isRunning && (
                <p className="font-mono text-xs text-ink-faint">
                  No transcript was produced for this session.
                </p>
              )}
            </>
          ) : (
            <div className="mx-auto max-w-2xl py-4">
              <p className="whitespace-pre-wrap font-serif text-[17px] leading-[1.8] text-ink">
                {segments.map((s) => s.text).join(" ")}
              </p>
              {segments.length === 0 && !isRunning && (
                <p className="font-mono text-xs text-ink-faint">
                  No transcript was produced for this session.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Export/copy feedback, floated just above the transport bar. */}
      {exportMsg && (
        <p className="pointer-events-none absolute bottom-14 left-1/2 z-30 max-w-[80%] -translate-x-1/2 truncate rounded-md border border-border-subtle bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-muted shadow-lg">
          {exportMsg}
        </p>
      )}

      {/* Transport bar — the one instrument strip for everything operational. */}
      <footer className="relative flex h-12 shrink-0 items-center gap-4 border-t border-border-subtle bg-panel px-4">
        {isRunning && !isSegRerunning && (
          // Progress rail on the footer's top edge: indeterminate sweep while
          // ffmpeg extracts audio, determinate fill once whisper reports chunks.
          <div className="absolute inset-x-0 -top-px h-0.5 overflow-hidden bg-border-subtle/60">
            {preparing ? (
              <div
                className={`h-full w-1/4 bg-ink/70 ${queued ? "opacity-40" : "animate-[sweep_1.6s_ease-in-out_infinite] motion-reduce:animate-none"}`}
              />
            ) : (
              <div
                className="h-full bg-ink transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(1, progress)}%` }}
              />
            )}
          </div>
        )}
        {isRunning && !isSegRerunning ? (
          <>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-ink animate-pulse motion-reduce:animate-none" aria-hidden />
              {queued ? "Queued" : preparing ? "Reading audio" : "Transcribing"}
            </span>
            {!preparing && (
              <span className="font-mono text-sm tabular-nums text-ink">{Math.round(progress)}%</span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              {segments.length} segments · {formatDuration(elapsed)}
              {remaining != null ? ` · ~${formatDuration(remaining)} left` : ""}
            </span>
            <button onClick={doCancel} className={`ml-auto ${transportBtn}`}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={togglePlay}
              disabled={!srcUrl}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
              aria-label={playing ? "Pause" : "Play"}
              title={`${playing ? "Pause" : "Play"} (space)`}
            >
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                  <rect x="2" y="1.5" width="2.5" height="9" rx="0.5" />
                  <rect x="7.5" y="1.5" width="2.5" height="9" rx="0.5" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                  <path d="M3 1.5l7 4.5-7 4.5z" />
                </svg>
              )}
            </button>
            <span className="font-mono text-sm tabular-nums text-ink">{formatTimecode(currentTime)}</span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              / {work?.durationSecs != null ? formatDuration(work.durationSecs) : "—"}
              {segments.length > 0 ? ` · ${segments.length} subtitles` : ""}
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              {work?.status === "failed" && (
                <button onClick={doRetry} className={transportBtn}>
                  Retry
                </button>
              )}
              {work?.status === "done" && (
                <>
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f} onClick={() => doExport(f)} className={transportBtn}>
                      {f}
                    </button>
                  ))}
                  <button onClick={copyToClipboard} className={transportBtn}>
                    Copy
                  </button>
                  <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
                </>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete transcript"
                title="Delete"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 9h4.8L11 4M7 7v4M9 7v4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </>
        )}
      </footer>

      <RerunDialog
        open={pendingRerun !== null}
        title="Re-transcribe"
        context={work?.sourceFilename ?? ""}
        warning="This will run the whole file again and replace the current transcript, including any edits."
        models={models}
        initial={pendingRerun ?? PLACEHOLDER_SELECTION}
        confirmLabel="Re-run"
        onConfirm={(sel) => {
          setPendingRerun(null);
          doRerun(sel);
        }}
        onCancel={() => setPendingRerun(null)}
      />
      <RerunDialog
        open={pendingSegRerun !== null}
        title="Re-transcribe segment"
        context={
          pendingSegRerun
            ? `Segment ${pendingSegRerun.index + 1} · ${formatTimecode(segments[pendingSegRerun.index]?.start ?? 0)} → ${formatTimecode(segments[pendingSegRerun.index]?.end ?? 0)}`
            : ""
        }
        warning="This will re-run just this segment's time range and replace its text."
        models={models}
        initial={
          pendingSegRerun
            ? { modelId: pendingSegRerun.modelId, quant: pendingSegRerun.quant, language: pendingSegRerun.language }
            : PLACEHOLDER_SELECTION
        }
        confirmLabel="Re-run"
        onConfirm={(sel) => {
          const idx = pendingSegRerun?.index;
          setPendingSegRerun(null);
          if (idx != null) doRerunSegment(idx, sel);
        }}
        onCancel={() => setPendingSegRerun(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete transcript?"
        message={`“${work?.sourceFilename ?? ""}” and its transcript will be removed from your library. This can't be undone.`}
        onConfirm={() => {
          setConfirmDelete(false);
          doDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </main>
  );
}
