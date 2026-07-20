import { useMemo, useRef, useState } from "react";
import type { Segment } from "../lib/types";
import { formatDuration, formatTimecode } from "../lib/time";

// Audacity-ish timeline: a ruler with major/minor ticks + timecodes, segment
// bars laid out at their real time position (height = how much was said), and a
// playhead that sweeps across while transcribing. Doubles as the rich progress
// view — the bars are the actual transcript filling in left to right.

// Ponytail: nice round intervals (1,2,5…3600s). Pick the smallest that yields
// ≤7 major labels so the ruler never crowds, regardless of file length.
const STEP = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function majorStep(duration: number): number {
  for (const s of STEP) if (duration / s <= 7) return s;
  return STEP[STEP.length - 1];
}

// Deterministic per-segment "amplitude": longer utterances = taller bars. Gives
// a real waveform silhouette from the content, no RNG, no jitter on re-render.
function barHeight(seg: Segment): number {
  const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
  // ~2px per word, clamped to a 28–100% band so even single words stay visible
  // and very long segments cap out instead of dominating.
  return Math.min(100, Math.max(28, 24 + words * 2.5));
}

export default function Waveform({
  durationSecs,
  segments,
  progress,
  running,
  currentTime,
  selection,
  onSelect,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  durationSecs: number | null;
  segments: Segment[];
  progress: number; // 0..100, only meaningful when running
  running: boolean;
  currentTime?: number | null; // seconds, from audio playback
  selection: { start: number; end: number } | null;
  onSelect?: (segmentIndex: number) => void;
  onSeek?: (timeSec: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const dur = useMemo(() => {
    if (durationSecs && durationSecs > 0) return durationSecs;
    const lastEnd = segments.length ? segments[segments.length - 1].end : 0;
    return lastEnd > 0 ? lastEnd : 0;
  }, [durationSecs, segments]);

  const ticks = useMemo(() => {
    if (dur <= 0) return { major: [], minor: [] };
    const step = majorStep(dur);
    const major: number[] = [];
    const minor: number[] = [];
    for (let t = 0; t <= dur + 0.001; t += step / 5) {
      const at = Math.round(t * 1000) / 1000;
      const label = Math.abs(at % step) < 0.001 || Math.abs(at % step - step) < 0.001;
      if (label) major.push(at);
      else minor.push(at);
    }
    return { major, minor };
  }, [dur]);

  const playhead = running
    ? Math.min(100, Math.max(0, progress))
    : currentTime != null && dur > 0
      ? Math.min(100, Math.max(0, (currentTime / dur) * 100))
      : null;

  // No duration yet (still probing audio) — show an indeterminate live wave so
  // the panel isn't empty before transcription starts.
  if (dur <= 0) {
    return (
      <div className="flex h-20 items-end gap-[3px] rounded-md border border-border-subtle bg-panel px-3 py-2">
        {Array.from({ length: 48 }).map((_, i) => (
          <span
            key={i}
            style={{ animationDelay: `${((i * 53) % 100) / 100}s` }}
            className="w-[3px] origin-bottom flex-1 rounded-full bg-ink-faint/60 animate-[wave_3.2s_ease-in-out_infinite] motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  const pct = (t: number) => `${(t / dur) * 100}%`;

  // Scrubbing: pointer-down on the track (or the playhead handle) starts a drag
  // that seeks continuously and selects the subtitle under the cursor. Pointer
  // capture keeps the move events flowing even off the track. Disabled while
  // transcribing — there's nothing to scrub against a live progress bar.
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const scrubbing = !running && !!onSeek;

  const timeFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(dur, Math.max(0, ratio * dur));
  };

  const selectAt = (t: number) => {
    if (!onSelect) return;
    let hit = -1;
    for (let i = 0; i < segments.length; i++) {
      if (t >= segments[i].start && t <= segments[i].end) { hit = i; break; }
    }
    if (hit < 0 && segments.length) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < segments.length; i++) {
        const d = Math.abs(segments[i].start - t);
        if (d < bd) { bd = d; best = i; }
      }
      hit = best;
    }
    if (hit >= 0) onSelect(hit);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onScrubStart?.();
    const t = timeFromX(e.clientX);
    onSeek!(t);
    selectAt(t);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const t = timeFromX(e.clientX);
    onSeek!(t);
    selectAt(t);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    onScrubEnd?.();
  };

  return (
    <div className="relative select-none rounded-md border border-border-subtle bg-panel">
      {/* Ruler */}
      <div className="relative h-6 border-b border-border-subtle">
        {ticks.minor.map((t, i) => (
          <span
            key={`mi${i}`}
            style={{ left: pct(t) }}
            className="absolute top-3 h-2 w-px -translate-x-1/2 bg-border-subtle"
          />
        ))}
        {ticks.major.map((t, i) => (
          <span
            key={`ma${i}`}
            style={{ left: pct(t) }}
            className="absolute top-0 h-3 w-px -translate-x-1/2 bg-ink-faint"
          />
        ))}
        {ticks.major.map((t, i) => (
          <span
            key={`lb${i}`}
            style={{ left: pct(t) }}
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap px-1 font-mono text-[9px] tabular-nums text-ink-faint"
          >
            {formatDuration(t)}
          </span>
        ))}
      </div>

      {/* Track — double-clicks as the scrubber when playback is available. */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative h-14 touch-none select-none ${
          scrubbing ? (dragging ? "cursor-grabbing" : "cursor-pointer") : ""
        }`}
      >
        {/* baseline */}
        <div className="absolute inset-x-0 bottom-1/2 top-1/2 h-px bg-border-subtle/60" />

        {/* Played region — subtle tint left of the playhead */}
        {playhead != null && (
          <div className="absolute inset-y-0 left-0 bg-ink/[0.06]" style={{ width: `${playhead}%` }} />
        )}

        {/* Selected subtitle block: translucent fill + bracket edges + timecodes.
           The signature — a subtitle rendered on its waveform, in pure monochrome. */}
        {selection && (
          <>
            <div
              className="absolute inset-y-0 bg-ink/10"
              style={{
                left: `${(selection.start / dur) * 100}%`,
                width: `${Math.max(0.4, ((selection.end - selection.start) / dur) * 100)}%`,
              }}
            />
            {[
              { t: selection.start, align: "left" },
              { t: selection.end, align: "right" },
            ].map((edge, k) => (
              <div
                key={k}
                className="absolute inset-y-0"
                style={{ left: `${(edge.t / dur) * 100}%` }}
              >
                <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-ink" />
                <span
                  className={`absolute top-0.5 whitespace-nowrap bg-bg/70 px-0.5 font-mono text-[9px] tabular-nums text-ink ${
                    edge.align === "left" ? "left-0.5" : "right-0.5"
                  }`}
                >
                  {formatTimecode(edge.t)}
                </span>
              </div>
            ))}
          </>
        )}

        {/* segment bars at real time positions */}
        {segments.map((s, i) => {
          const left = (s.start / dur) * 100;
          const width = Math.max(0.4, ((s.end - s.start) / dur) * 100);
          const isLive = running && i === segments.length - 1;
          const isSelected = selection != null && s.start === selection.start && s.end === selection.end;
          return (
            <span
              key={i}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                height: `${barHeight(s)}%`,
              }}
              className={`absolute bottom-0 -translate-x-px rounded-sm transition-[height,opacity] duration-200 ${
                isLive
                  ? "bg-ink animate-pulse motion-reduce:animate-none"
                  : isSelected
                    ? "bg-ink"
                    : selection && !isSelected
                      ? "bg-ink-faint/50"
                      : "bg-ink-muted"
              }`}
            />
          );
        })}

        {/* Playhead — the line plus a grabbable handle. Dragging routes through
           the track's pointer handlers (the handle is just a visual hit target). */}
        {playhead != null && (
          <div
            className={`absolute inset-y-0 z-10 -translate-x-1/2 ${
              running ? "transition-[left] duration-300 ease-linear" : ""
            }`}
            style={{ left: `${playhead}%` }}
          >
            <div className="absolute inset-y-0 w-px bg-ink" />
            {scrubbing && (
              <div
                className={`absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-bg ${
                  dragging ? "scale-110" : "cursor-grab"
                }`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}