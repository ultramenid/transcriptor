import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Segment, Work } from "../lib/types";
import { formatDuration, formatTimecode } from "../lib/time";
import Waveform from "../components/Waveform";
import ConfirmDialog from "../components/ConfirmDialog";

const EXPORT_FORMATS = ["txt", "srt", "vtt", "json", "article"] as const;

export default function Transcript({ workId, onDelete }: { workId: string; onDelete: () => void }) {
  const [work, setWork] = useState<Work | null>(null);
  const [liveSegments, setLiveSegments] = useState<Segment[]>([]);
  const [editedSegments, setEditedSegments] = useState<Segment[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState<"timestamped" | "article">("timestamped");
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadWork = useCallback(() => {
    invoke<Work | null>("get_work", { id: workId }).then((w) => {
      if (w) setWork(w);
    });
  }, [workId]);

  useEffect(() => {
    setLiveSegments([]);
    setEditedSegments(null);
    setProgress(0);
    setPlaying(false);
    setCurrentTime(0);
    loadWork();

    const unlistenSeg = listen<{ workId: string; segment: Segment }>("transcribe-segment", (e) => {
      if (e.payload.workId !== workId) return;
      setLiveSegments((prev) => [...prev, e.payload.segment]);
    });
    const unlistenProgress = listen<{ workId: string; progress: number }>("transcribe-progress", (e) => {
      if (e.payload.workId !== workId) return;
      setProgress(e.payload.progress);
    });
    const unlistenQueue = listen("queue-updated", loadWork);
    return () => {
      unlistenSeg.then((f) => f());
      unlistenProgress.then((f) => f());
      unlistenQueue.then((f) => f());
    };
  }, [workId, loadWork]);

  const segments = work?.status === "done" ? editedSegments ?? work.segments : liveSegments;
  const isRunning = work?.status === "running" || work?.status === "queued";

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

  const selIdx = isRunning
    ? segments.length ? liveIdx : -1
    : playing
      ? playingIndex
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

  // Follow the playing subtitle as audio plays.
  useEffect(() => {
    if (!playing || playingIndex < 0) return;
    const el = gridRef.current?.querySelector(`[data-idx="${playingIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [playingIndex, playing]);

  // Spacebar = play/pause, video-editor style. Skipped while transcribing or
  // when there's no audio, and ignored while typing in a field or editing a
  // subtitle so the space reaches the text instead.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== " " && e.code !== "Space") return;
      if (isRunning || !srcUrl) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      togglePlay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRunning, srcUrl, togglePlay]);

  async function doCancel() {
    await invoke("cancel_work", { id: workId });
    loadWork();
  }
  async function doRetry() {
    await invoke("retry_work", { id: workId });
    loadWork();
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

  return (
    <main className="flex-1 px-5 py-10 md:px-12 md:py-14 lg:px-20">
      <div className="mx-auto max-w-5xl">
        <audio
          ref={audioRef}
          src={srcUrl ?? undefined}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink md:text-2xl">
              {work?.sourceFilename ?? "Transcribing…"}
            </h1>
            {work?.durationSecs != null && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">
                {formatDuration(work.durationSecs)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isRunning && (
              <button
                onClick={doCancel}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
              >
                Cancel
              </button>
            )}
            {work?.status === "failed" && (
              <button
                onClick={doRetry}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
              >
                Retry
              </button>
            )}
            <div className="flex gap-1 rounded-md border border-border-subtle bg-panel p-1">
              {(["timestamped", "article"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded px-3 py-1 font-mono text-[11px] uppercase tracking-wide ${
                    view === v ? "bg-ink text-bg" : "text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "timestamped" && (work?.durationSecs != null || segments.length > 0) && (
          <div className="sticky top-0 z-20 mb-6 bg-bg/95 pb-3 pt-1 backdrop-blur">
            <Waveform
              durationSecs={work?.durationSecs ?? null}
              segments={segments}
              progress={progress}
              running={isRunning}
              currentTime={!isRunning ? currentTime : null}
              selection={selection}
              onSelect={(i) => setSelectedIndex(i)}
              onSeek={seekTo}
              onScrubStart={() => audioRef.current?.pause()}
            />
            <div className="mt-2 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint tabular-nums">
              {isRunning ? (
                <>
                  <span>Transcribing</span>
                  <span className="ml-auto flex items-baseline gap-3">
                    <span className="text-ink">{Math.round(progress)}%</span>
                    <span>{segments.length} segments</span>
                    <span>{formatDuration(elapsed)}</span>
                  </span>
                </>
              ) : (
                <>
                  <button
                    onClick={togglePlay}
                    disabled={!srcUrl}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:text-ink disabled:opacity-40"
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
                  <span className="text-ink">{formatTimecode(currentTime)}</span>
                  <span>/ {work?.durationSecs != null ? formatDuration(work.durationSecs) : "—"}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {work?.modelId && (
                      <span>
                        Model <span className="text-ink-muted">
                          {work.modelId}
                          {work?.quant ? ` · ${work.quant}` : ""}
                        </span>
                      </span>
                    )}
                    <span>
                      Lang <span className="text-ink-muted">{work?.language ?? "—"}</span>
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {work?.status === "failed" && (
          <div className="mb-8 rounded-md border border-border-subtle bg-panel px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">Error</p>
            <p className="mt-1 text-sm text-ink">{work.error}</p>
          </div>
        )}

        <div>
          {view === "timestamped" ? (
            <>
              {segments.length > 0 && (
                <div ref={gridRef} className="border-t border-border-subtle">
                  {/* Column header */}
                  <div className="grid grid-cols-[2.5rem_7.5rem_7.5rem_4.5rem_1fr] border-b border-border-subtle bg-bg font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                    <span className="px-2 py-2 text-right">#</span>
                    <span className="px-2 py-2">Start</span>
                    <span className="px-2 py-2">End</span>
                    <span className="px-2 py-2 text-right">Dur</span>
                    <span className="px-3 py-2">Text</span>
                  </div>

                  {segments.map((s, i) => {
                    const isLive = isRunning && i === liveIdx;
                    const isSel = i === selIdx;
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
                        onKeyDown={(e) => {
                          if (isRunning) return;
                          const el = e.currentTarget;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            (el.nextElementSibling as HTMLDivElement | null)?.focus();
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            (el.previousElementSibling as HTMLDivElement | null)?.focus();
                          } else if (e.key === "Enter" && work?.status === "done") {
                            e.preventDefault();
                            el.querySelector<HTMLParagraphElement>("p[contenteditable]")?.focus();
                          }
                        }}
                        className={`grid scroll-mt-36 cursor-pointer grid-cols-[2.5rem_7.5rem_7.5rem_4.5rem_1fr] items-start border-b border-border-subtle/60 outline-none ${
                          isSel ? "bg-panel-2" : "hover:bg-panel"
                        }`}
                      >
                        <span
                          className={`px-2 py-2.5 text-right font-mono text-[11px] tabular-nums border-l-2 ${
                            isSel ? "border-ink text-ink" : "border-transparent text-ink-faint"
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
                        <p
                          className={`px-3 py-2 text-sm leading-snug text-ink outline-none ${
                            isLive ? "animate-pulse motion-reduce:animate-none" : ""
                          }`}
                          contentEditable={work?.status === "done"}
                          suppressContentEditableWarning
                          onBlur={(e) => editSegment(i, e.currentTarget.textContent ?? "")}
                        >
                          {s.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Status bar */}
              {segments.length > 0 && (
                <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-ink-faint tabular-nums">
                  <span>{segments.length} subtitles</span>
                  <span>
                    {work?.durationSecs != null ? `${formatDuration(work.durationSecs)} total` : ""}
                    {selIdx >= 0 ? ` · sel ${selIdx + 1}` : ""}
                  </span>
                </div>
              )}

              {segments.length === 0 && !isRunning && (
                <p className="font-mono text-xs text-ink-faint">
                  No transcript was produced for this session.
                </p>
              )}
            </>
          ) : (
            <div className="mx-auto max-w-3xl">
              <p className="whitespace-pre-wrap leading-relaxed text-ink">
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

        {work?.status === "done" && (
          <div className="mt-10 border-t border-border-subtle pt-6">
            <div className="flex flex-wrap items-center gap-2">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f}
                  onClick={() => doExport(f)}
                  className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
                >
                  {f}
                </button>
              ))}
              <button
                onClick={copyToClipboard}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
              >
                Copy
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="ml-auto rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:border-ink-faint hover:text-ink-muted"
              >
                Delete
              </button>
            </div>
            {exportMsg && <p className="mt-2 text-xs text-ink-faint">{exportMsg}</p>}
          </div>
        )}
      </div>
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
