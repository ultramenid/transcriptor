import { useMemo, useRef, useState } from "react";
import type { Segment } from "../lib/types";
import { formatDuration, formatTimecode } from "../lib/time";

// Audio-editor timeline: a ruler with major/minor ticks + timecodes, and a
// mirrored waveform rendered from the transcript itself — speech density
// drives amplitude, silence stays flat. Doubles as the rich progress view
// while transcribing: the wave fills in left to right as segments arrive.

// Ponytail: nice round intervals (1,2,5…3600s). Pick the smallest that yields
// ≤7 major labels so the ruler never crowds, regardless of file length.
const STEP = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function majorStep(duration: number): number {
  for (const s of STEP) if (duration / s <= 7) return s;
  return STEP[STEP.length - 1];
}

// Fixed slot count keeps rendering cost flat regardless of file length or
// segment count; sub-pixel flex widths are fine.
const SLOTS = 200;

// Deterministic per-slot jitter — a real-looking wave texture with no RNG, so
// nothing shimmers on re-render.
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export default function Waveform({
  durationSecs,
  segments,
  peaks,
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
  peaks?: number[] | null; // real per-bucket amplitude 0..1, from the decoded audio
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

  // Amplitude per slot. With real peaks from the decoded audio (emitted the
  // moment the WAV is ready, before the first word arrives) we downsample them;
  // otherwise — old works transcribed before peaks existed — we fall back to
  // the transcript-derived approximation below.
  const slots = useMemo(() => {
    if (dur <= 0) return [];
    if (peaks && peaks.length) {
      return Array.from({ length: SLOTS }, (_, i) => {
        const a = Math.floor((i * peaks.length) / SLOTS);
        const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / SLOTS));
        let m = 0;
        for (let k = a; k < b; k++) m = Math.max(m, peaks[k]);
        return m <= 0.01 ? 0 : Math.max(6, m * 100);
      });
    }
    const out: number[] = [];
    let si = 0;
    for (let i = 0; i < SLOTS; i++) {
      const t = ((i + 0.5) / SLOTS) * dur;
      while (si < segments.length && segments[si].end < t) si++;
      const seg = si < segments.length && segments[si].start <= t ? segments[si] : null;
      if (!seg) {
        out.push(0);
        continue;
      }
      const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
      const density = Math.min(1, words / Math.max(0.5, seg.end - seg.start) / 4); // ~4 wps caps out
      out.push(Math.min(100, 30 + density * 45 + jitter(i) * 30));
    }
    return out;
  }, [segments, dur, peaks]);

  // While running the playhead scrubs the timeline rather than counting chunks:
  // the newest segment's end time is far finer-grained than 30 s chunk progress,
  // so the line glides across the wave (CSS-eased below) as words land. Chunk
  // progress is the floor, so it still advances through long silences.
  const liveHead = segments.length && dur > 0 ? (segments[segments.length - 1].end / dur) * 100 : 0;
  const playhead = running
    ? Math.min(100, Math.max(0, Math.max(progress, liveHead)))
    : currentTime != null && dur > 0
      ? Math.min(100, Math.max(0, (currentTime / dur) * 100))
      : null;

  // Scrubbing: pointer-down on the track (or the playhead handle) starts a drag
  // that seeks continuously and selects the subtitle under the cursor. Pointer
  // capture keeps the move events flowing even off the track. Disabled while
  // transcribing — there's nothing to scrub against a live progress bar.
  //
  // These MUST stay above the `dur <= 0` early return: duration arrives
  // mid-render-lifetime (audio event, or the first segment), so a return that
  // skipped them would change the hook count between renders and React would
  // throw "rendered more hooks than during the previous render" — taking the
  // whole app down with it.
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // No duration yet (still probing audio) — show an indeterminate live wave so
  // the panel isn't empty before transcription starts.
  if (dur <= 0) {
    return (
      <div className="relative flex h-[8.5rem] items-center gap-[3px] rounded-md border border-border-subtle bg-panel px-3 py-2">
        {Array.from({ length: 48 }).map((_, i) => (
          <span
            key={i}
            style={{ animationDelay: `${((i * 53) % 100) / 100}s` }}
            className="h-1/2 w-[3px] flex-1 rounded-full bg-ink-faint/60 animate-[wave_3.2s_ease-in-out_infinite] motion-reduce:animate-none"
          />
        ))}
        {running && (
          <span className="pointer-events-none absolute inset-x-0 top-3 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">
            Reading audio
          </span>
        )}
      </div>
    );
  }

  const pct = (t: number) => `${(t / dur) * 100}%`;

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
    if (draggingRef.current) {
      const t = timeFromX(e.clientX);
      onSeek!(t);
      selectAt(t);
    } else if (scrubbing) {
      setHoverT(timeFromX(e.clientX));
    }
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

      {/* Track — mirrored waveform; doubles as the scrubber when playback is available. */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverT(null)}
        className={`relative h-28 touch-none select-none ${
          scrubbing ? (dragging ? "cursor-grabbing" : "cursor-pointer") : ""
        }`}
      >
        {/* baseline */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-border-subtle/60" />

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

        {/* The wave — mirrored around the baseline, silence stays flat. */}
        <div className="pointer-events-none absolute inset-x-1 inset-y-1.5 flex items-center gap-[1.5px]">
          {slots.map((h, i) => {
            const t = ((i + 0.5) / SLOTS) * dur;
            const inSel = selection != null && t >= selection.start && t <= selection.end;
            // While transcribing, audio the model hasn't reached yet is drawn
            // faint — the wave brightens left-to-right as the pass advances.
            const pending = running && playhead != null && (t / dur) * 100 > playhead;
            return (
              <span
                key={i}
                style={{ height: h > 0 ? `${h}%` : "3px" }}
                className={`min-w-0 flex-1 rounded-full transition-[height,background-color] duration-200 ${
                  h === 0
                    ? "bg-border-subtle"
                    : pending
                      ? "bg-ink-faint/25"
                      : inSel
                        ? "bg-ink"
                        : selection
                          ? "bg-ink-faint/60"
                          : "bg-ink-muted"
                }`}
              />
            );
          })}
        </div>

        {/* Hover hairline + timecode — preview of where a click will seek. */}
        {hoverT != null && !dragging && scrubbing && (
          <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: pct(hoverT) }}>
            <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-ink-faint" />
            <span className="absolute bottom-0.5 left-1 whitespace-nowrap bg-bg/70 px-0.5 font-mono text-[9px] tabular-nums text-ink-muted">
              {formatTimecode(hoverT)}
            </span>
          </div>
        )}

        {/* Playhead — the line plus a grabbable handle. Dragging routes through
           the track's pointer handlers (the handle is just a visual hit target). */}
        {playhead != null && (
          <div
            className={`absolute inset-y-0 z-10 -translate-x-1/2 ${
              running ? "transition-[left] duration-700 ease-out" : ""
            }`}
            style={{ left: `${playhead}%` }}
          >
            <div
              className={`absolute inset-y-0 w-px bg-ink ${
                running ? "animate-pulse motion-reduce:animate-none" : ""
              }`}
            />
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
