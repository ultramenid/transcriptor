import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// Transcriptor's real flow, start to finish: the home screen → a file dragged
// in and dropped → model + language staged → Run → "Reading audio" → the
// waveform lands and subtitles type themselves in as the playhead scrubs →
// done → and then the part that makes it an editor rather than a converter:
// click a line to seek, play it back, and re-run one line on a bigger model.
//
// Everything is taken from the app: colours are the App.css tokens, the drop
// strip and staging panel mirror Library.tsx, the waveform texture reuses
// Waveform.tsx's density + jitter maths, timecodes use the SRT format from
// time.ts, the re-run dialog mirrors RerunDialog.tsx, and the transcript is
// genuine engine output from the test harness. The one staged detail is the
// word the re-run fixes — the interaction is real, that particular fix is an
// illustration of it.

export const FPS = 30;
export const DURATION_FRAMES = 870; // 29 s

// ---- app design tokens (App.css) ----
const C = {
  bg: "#0c0c0c",
  panel: "#131313",
  panel2: "#1b1b1b",
  border: "#242424",
  borderStrong: "#3a3a3a",
  ink: "#f4f4f4",
  muted: "#9d9d9d",
  faint: "#626262",
};
const MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, "Cascadia Code", "Roboto Mono", monospace';
const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ---- the transcript (real harness output, shifted to t=0) ----
const SEGS = [
  { start: 0.0, end: 3.84, text: "Welcome to the offline transcription podcast, Episode 1." },
  { start: 3.84, end: 9.16, text: "In this episode we explore what it means to run a speech model entirely on your own hardware." },
  { start: 9.16, end: 11.76, text: "First, let us talk about privacy." },
  { start: 11.76, end: 17.36, text: "When audio never leaves your machine, there is no risk of a cloud provider retaining your recordings," },
  { start: 17.36, end: 19.92, text: "training on your data, or leaking it in a breech." },
  { start: 19.92, end: 24.6, text: "The file you drop is the file that gets transcribed, and the transcript lives only on your" },
  { start: 24.6, end: 31.28, text: "disk. Second, accuracy. Modern speech models transcribe over 99 languages and can auto-detect" },
  { start: 31.28, end: 37.08, text: "the spoken language from the first few seconds of audio. They emit frame accurate time stamps," },
  { start: 37.08, end: 41.68, text: "which means your subtitles stay in sync with the video, second by second, even for a" },
  { start: 41.68, end: 48.0, text: "four hour lecture. Third, reliability. There is no monthly quota, no per minute billing," },
];
const DUR = 48.0;
const FILE = "offline-podcast-ep1.m4a";

// The line the review act re-runs, and the homophone a bigger model gets right.
const RR_IDX = 4;
const RR_FIXED = "training on your data, or leaking it in a breach.";

// ---- beats (frames) ----
const DRAG_IN = 18; // file enters, cursor carries it
const DROP_AT = 62; // released over the window
const STAGED = 74; // pending row appears
const CURSOR_RUN = 96; // cursor arrives at the Run button
const CLICK = 116; // Run pressed
const TO_APP = 128; // transcript page
const WAVE_IN = 158; // peaks replace the ambient wave
const T_START = 168;
const T_END = 462;

// ---- review act: the page is an editor, not a receipt ----
const REVIEW = 476; // cursor comes back
const ROW_CLICK = 506; // click a line → it is selected and the audio seeks there
const PLAY_CLICK = 530; // play from that line
const PAUSE_AT = 602; // …and pause
const RR_CLICK = 640; // the row's Re-run button
const CONFIRM = 706; // confirm in the dialog
const RR_DONE = 762; // one line comes back from a bigger model
const PLAY_FROM = 17.36; // start of the clicked line

const DONE_CARD = 810;

// ---- timecode helpers (src/lib/time.ts) ----
const pad = (n: number, l = 2) => Math.floor(n).toString().padStart(l, "0");
const fmtDur = (t: number) => `${pad((t / 60) % 60)}:${pad(t % 60)}`;
const fmtTC = (t: number) =>
  `${pad(t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)},${pad((t - Math.floor(t)) * 1000, 3)}`;

// ---- waveform texture (components/Waveform.tsx) ----
const SLOTS = 200;
const jitter = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const slots = Array.from({ length: SLOTS }, (_, i) => {
  const t = ((i + 0.5) / SLOTS) * DUR;
  const seg = SEGS.find((s) => s.start <= t && s.end >= t);
  if (!seg) return 0;
  const words = seg.text.split(/\s+/).length;
  const density = Math.min(1, words / Math.max(0.5, seg.end - seg.start) / 4);
  return Math.min(100, 30 + density * 45 + jitter(i) * 30);
});

// Drop strip silhouette (Library.tsx BAR_HEIGHTS)
const BAR_HEIGHTS = [
  22, 40, 18, 55, 30, 70, 45, 25, 60, 35, 50, 20, 65, 40, 28, 58, 33, 48, 20,
  62, 38, 26, 52, 30, 44, 18, 56, 32,
];

const label: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: C.faint,
};
// Row grid: #, start, end, dur, text, per-row actions (Transcript.tsx).
const GRID = "56px 160px 160px 84px 1fr 120px";
// Measured off a render, so the review-act cursor lands on real controls.
const ROW_Y = 403; // top of row 1 inside the window
const ROW_H = 44;
const PLAY_X = 37; // transport play button
const PLAY_Y = 922;
const btn: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 12,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: C.muted,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "5px 12px",
};

const Cursor = ({ x, y }: { x: number; y: number }) => (
  <svg
    width="26"
    height="34"
    viewBox="0 0 26 34"
    style={{ position: "absolute", left: x, top: y, zIndex: 60, filter: "drop-shadow(0 3px 6px rgba(0,0,0,.6))" }}
  >
    <path d="M2 2l0 24 6-6 4 9 5-2-4-9 8 0z" fill="#fff" stroke="#0c0c0c" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const TranscribeFlow = () => {
  const frame = useCurrentFrame();
  const sec = frame / FPS;

  const inApp = frame >= TO_APP;

  // Audio time driven by the video: 48 s of audio in ~10 s of screen time —
  // the "faster than realtime" feel of a local model.
  const t = interpolate(frame, [T_START, T_END], [0, DUR], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const reading = frame < WAVE_IN;
  const running = frame < T_END;

  // ---- review act state ----
  // Clicking a row seeks; play advances from there; pausing freezes the head.
  const seeked = frame >= ROW_CLICK;
  const playing = frame >= PLAY_CLICK && frame < PAUSE_AT;
  const curT = seeked
    ? PLAY_FROM + Math.max(0, Math.min(frame, PAUSE_AT) - PLAY_CLICK) / FPS
    : 0;
  const rerunning = frame >= CONFIRM && frame < RR_DONE;
  const dialog = frame >= RR_CLICK && frame < CONFIRM;

  // One playhead and one selection, whichever act is driving them.
  const head = running ? t : curT;
  const pct = (head / DUR) * 100;
  const activeIdx = running ? SEGS.findIndex((s) => t >= s.start && t < s.end) : -1;
  const selIdx = running
    ? activeIdx
    : seeked
      ? SEGS.reduce((acc, s, i) => (s.start <= curT ? i : acc), 0)
      : SEGS.length - 1;
  const active = selIdx >= 0 ? SEGS[selIdx] : null;
  const started = running ? SEGS.filter((s) => t >= s.start).length : SEGS.length;
  const elapsed = Math.max(0, (frame - T_START) / FPS);
  const waveIn = interpolate(frame, [WAVE_IN, WAVE_IN + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const caretOn = Math.floor(frame / 8) % 2 === 0;

  // ---- scene 1: cursor path ----
  // Coordinates are window-local (the cursor lives inside the 1560×950 window),
  // so they must be measured from the window's own top-left, not the canvas:
  // the drop strip centres on x=780, and the Run button sits at y≈463.
  const cx = interpolate(frame, [DRAG_IN, DROP_AT, CURSOR_RUN, CLICK], [1520, 780, 780, 780], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cy = interpolate(frame, [DRAG_IN, DROP_AT, STAGED, CURSOR_RUN], [960, 380, 380, 463], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dragging = frame >= DRAG_IN && frame < DROP_AT;
  const overlay = interpolate(frame, [DRAG_IN + 8, DRAG_IN + 18, DROP_AT, DROP_AT + 8], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pressed = frame >= CLICK && frame < CLICK + 8;
  const staged = frame >= STAGED;

  // ---- scene 3: cursor path (window-local, see ROW_Y/ROW_H) ----
  // row 5's text → the play button in the transport → row 5's Re-run button →
  // the dialog's confirm.
  const rrY = ROW_Y + RR_IDX * ROW_H + ROW_H / 2;
  const rx = interpolate(
    frame,
    [REVIEW, ROW_CLICK, PLAY_CLICK, PAUSE_AT + 12, RR_CLICK, CONFIRM],
    [1180, 700, PLAY_X, PLAY_X, 1452, 978],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const ry = interpolate(
    frame,
    [REVIEW, ROW_CLICK, PLAY_CLICK, PAUSE_AT + 12, RR_CLICK, CONFIRM],
    [790, rrY, PLAY_Y, PLAY_Y, rrY, 600],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(90% 90% at 50% 40%, #121212 0%, #060606 100%)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          position: "relative",
          width: 1560,
          height: 950,
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          boxShadow: "0 40px 120px rgba(0,0,0,.6)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* titlebar */}
        <div style={{ display: "flex", gap: 9, padding: "16px 18px" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
          ))}
        </div>

        {/* nav (Header.tsx) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 44,
            padding: "0 22px",
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, letterSpacing: "0.25em", textTransform: "uppercase", color: C.ink }}>
            {inApp ? "Library / Transcript" : "Transcriptor"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {["Models", "Settings"].map((x) => (
              <span key={x} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.faint, padding: "6px 10px" }}>
                {x}
              </span>
            ))}
          </div>
        </div>

        {inApp ? (
          /* ================= TRANSCRIPT ================= */
          <>
            <div style={{ padding: "22px 56px 20px" }}>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: C.ink }}>{FILE}</div>
              <div style={{ ...label, marginTop: 7 }}>
                large-v3-turbo · full · en{frame > T_START ? ` · ${fmtDur(DUR)}` : ""}
              </div>
            </div>

            {/* waveform panel */}
            <div style={{ margin: "0 56px" }}>
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <div style={{ position: "relative", height: 30, borderBottom: `1px solid ${C.border}` }}>
                  {waveIn > 0 &&
                    [0, 10, 20, 30, 40].map((s) => (
                      <React.Fragment key={s}>
                        <div style={{ position: "absolute", left: `${(s / DUR) * 100}%`, top: 0, width: 1, height: 14, background: C.faint, opacity: waveIn }} />
                        <div style={{ position: "absolute", left: `${(s / DUR) * 100}%`, top: 2, paddingLeft: 5, fontFamily: MONO, fontSize: 11, color: C.faint, opacity: waveIn }}>
                          {fmtDur(s)}
                        </div>
                      </React.Fragment>
                    ))}
                </div>

                <div style={{ position: "relative", height: 128 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: `${C.border}99` }} />
                  {reading ? (
                    <>
                      <div style={{ position: "absolute", inset: "10px 12px", display: "flex", alignItems: "center", gap: 3 }}>
                        {Array.from({ length: 48 }).map((_, i) => {
                          const phase = ((i * 53) % 100) / 100;
                          const s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 3.2 + phase)));
                          return <div key={i} style={{ flex: 1, height: "50%", transform: `scaleY(${s})`, background: `${C.faint}99`, borderRadius: 99 }} />;
                        })}
                      </div>
                      <div style={{ ...label, position: "absolute", top: 10, width: "100%", textAlign: "center" }}>Reading audio</div>
                    </>
                  ) : (
                    <>
                      {running && (
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${pct}%`, background: "rgba(244,244,244,.06)" }} />
                      )}
                      {active && (
                        <>
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: `${(active.start / DUR) * 100}%`,
                              width: `${((active.end - active.start) / DUR) * 100}%`,
                              background: "rgba(244,244,244,.1)",
                            }}
                          />
                          {[active.start, active.end].map((e, k) => (
                            <div key={k} style={{ position: "absolute", top: 0, bottom: 0, left: `${(e / DUR) * 100}%` }}>
                              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, background: C.ink }} />
                              {(k === 0 || (active.end - active.start) / DUR > 0.16) && (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: 3,
                                    [k === 0 ? "left" : "right"]: 3,
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: C.ink,
                                    background: "rgba(12,12,12,.7)",
                                    padding: "0 3px",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {fmtTC(e)}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                      <div style={{ position: "absolute", inset: "8px 6px", display: "flex", alignItems: "center", gap: 1.5 }}>
                        {slots.map((h, i) => {
                          const st = ((i + 0.5) / SLOTS) * DUR;
                          const pending = running && (st / DUR) * 100 > pct;
                          const inSel = active && st >= active.start && st <= active.end;
                          return (
                            <div
                              key={i}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                height: h > 0 ? `${h * waveIn}%` : 3,
                                borderRadius: 99,
                                background: h === 0 ? C.border : pending ? "rgba(98,98,98,.25)" : inSel ? C.ink : C.muted,
                              }}
                            />
                          );
                        })}
                      </div>
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pct}%`, zIndex: 10 }}>
                        <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: C.ink, opacity: running ? 0.6 + 0.4 * Math.sin(sec * 6) : 1 }} />
                        {!running && (
                          <div style={{ position: "absolute", top: -5, left: -4, width: 10, height: 10, borderRadius: 6, background: C.ink }} />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* rows */}
            <div style={{ flex: 1, margin: "22px 56px 0", borderTop: `1px solid ${C.border}`, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID, borderBottom: `1px solid ${C.border}`, ...label, fontSize: 11 }}>
                <span style={{ padding: "10px" , textAlign: "right" }}>#</span>
                <span style={{ padding: "10px" }}>Start</span>
                <span style={{ padding: "10px" }}>End</span>
                <span style={{ padding: "10px", textAlign: "right" }}>Dur</span>
                <span style={{ padding: "10px 16px" }}>Text</span>
                <span />
              </div>
              {SEGS.map((s, i) => {
                if (running && t < s.start) return null;
                const isActive = running ? i === activeIdx : false;
                const isSel = i === (selIdx >= 0 ? selIdx : started - 1);
                const f = isActive ? (t - s.start) / (s.end - s.start) : 1;
                const text = i === RR_IDX && frame >= RR_DONE ? RR_FIXED : s.text;
                const chars = running && isActive ? Math.floor(text.length * Math.min(1, f * 1.08)) : text.length;
                const isRerunning = rerunning && i === RR_IDX;
                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: GRID,
                      borderBottom: `1px solid ${C.border}66`,
                      borderLeft: `2px solid ${isSel ? C.ink : "transparent"}`,
                      background: isSel ? C.panel2 : "transparent",
                      // Brief flash on the line that just came back, so a
                      // one-word fix is visible at video scale.
                      boxShadow:
                        i === RR_IDX && frame >= RR_DONE
                          ? `inset 0 0 0 999px rgba(244,244,244,${interpolate(frame, [RR_DONE, RR_DONE + 26], [0.16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`
                          : undefined,
                      fontFamily: MONO,
                      fontSize: 13.5,
                    }}
                  >
                    <span style={{ padding: "11px 10px", textAlign: "right", color: isSel ? C.ink : C.faint }}>{i + 1}</span>
                    <span style={{ padding: "11px 10px", color: isSel ? C.ink : C.muted }}>{fmtTC(s.start)}</span>
                    <span style={{ padding: "11px 10px", color: isSel ? C.ink : C.muted }}>{fmtTC(s.end)}</span>
                    <span style={{ padding: "11px 10px", textAlign: "right", color: C.faint }}>{(s.end - s.start).toFixed(2)}</span>
                    <span
                      style={{
                        padding: "10px 16px",
                        fontFamily: SANS,
                        fontSize: 16,
                        lineHeight: 1.45,
                        color: C.ink,
                        opacity: isRerunning ? 0.45 + 0.25 * Math.sin(sec * 7) : 1,
                      }}
                    >
                      {text.slice(0, chars)}
                      {isActive && caretOn && (
                        <span style={{ display: "inline-block", width: 2.5, height: "0.95em", background: C.ink, verticalAlign: "-0.12em", marginLeft: 3 }} />
                      )}
                    </span>
                    {/* Per-row re-run: only on the selected row, exactly as the
                        app reveals it on selection/hover. */}
                    <span style={{ display: "flex", justifyContent: "flex-end", padding: "9px 10px 0 0" }}>
                      {isRerunning ? (
                        <span style={{ ...label, fontSize: 10, display: "flex", alignItems: "center", gap: 6, color: C.muted }}>
                          <span style={{ width: 6, height: 6, borderRadius: 4, background: C.ink, opacity: 0.4 + 0.6 * Math.abs(Math.sin(sec * 4)) }} />
                          Re-running
                        </span>
                      ) : !running && isSel && frame >= REVIEW && !dialog ? (
                        <span
                          style={{
                            ...btn,
                            fontSize: 10,
                            padding: "3px 9px",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            borderColor: frame >= RR_CLICK - 22 ? C.borderStrong : C.border,
                            color: frame >= RR_CLICK - 22 ? C.ink : C.muted,
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                            <path d="M13 8a5 5 0 1 1-2.2-4.14M13 3v2.4h-2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Re-run
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* transport */}
            <div
              style={{
                position: "relative",
                height: 56,
                flexShrink: 0,
                borderTop: `1px solid ${C.border}`,
                background: C.panel,
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "0 22px",
              }}
            >
              {running && (
                <div style={{ position: "absolute", left: 0, right: 0, top: -1, height: 3, background: `${C.border}99`, overflow: "hidden" }}>
                  {reading ? (
                    <div style={{ position: "absolute", width: "25%", height: "100%", background: "rgba(244,244,244,.7)", left: `${interpolate((sec % 1.6) / 1.6, [0, 1], [-25, 125])}%` }} />
                  ) : (
                    <div style={{ height: "100%", width: `${Math.max(1, pct)}%`, background: C.ink }} />
                  )}
                </div>
              )}
              {running ? (
                <>
                  <span style={{ ...label, display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: C.ink, opacity: 0.5 + 0.5 * Math.sin(sec * 5) }} />
                    {reading ? "Reading audio" : "Transcribing"}
                  </span>
                  {!reading && <span style={{ fontFamily: MONO, fontSize: 17, color: C.ink }}>{Math.round(pct)}%</span>}
                  <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>
                    {reading ? "" : `${started} segments · ${fmtDur(elapsed)}`}
                  </span>
                  <span style={{ ...btn, marginLeft: "auto" }}>Cancel</span>
                </>
              ) : (
                <>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: frame >= PLAY_CLICK - 14 && frame < PAUSE_AT + 10 ? C.panel2 : "transparent",
                      color: playing ? C.ink : C.muted,
                    }}
                  >
                    {playing ? (
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor">
                        <rect x="2" y="1.5" width="2.5" height="9" rx="0.5" />
                        <rect x="7.5" y="1.5" width="2.5" height="9" rx="0.5" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M3 1.5l7 4.5-7 4.5z" />
                      </svg>
                    )}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 17, color: C.ink }}>{fmtTC(curT)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>/ {fmtDur(DUR)} · {SEGS.length} subtitles</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {["txt", "srt", "vtt", "json", "article", "copy"].map((f) => (
                      <span key={f} style={btn}>{f}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          /* ================= HOME ================= */
          <div style={{ padding: "40px 0", flex: 1 }}>
            <div style={{ width: 960, margin: "0 auto" }}>
              {/* drop strip (Library.tsx) */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 20,
                  borderRadius: 12,
                  border: `1px solid ${dragging ? C.borderStrong : C.border}`,
                  background: C.panel,
                  padding: staged ? "34px 32px" : "78px 32px",
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: staged ? 34 : 64 }}>
                  {BAR_HEIGHTS.map((h, i) => {
                    const phase = ((i * 53) % 100) / 100;
                    const s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 3.2 + phase)));
                    return <div key={i} style={{ width: 3, height: `${h}%`, transform: `scaleY(${s})`, transformOrigin: "bottom", background: `${C.faint}b3`, borderRadius: 99 }} />;
                  })}
                </div>
                <div>
                  <div style={{ fontSize: staged ? 18 : 23, fontWeight: 500, letterSpacing: "-0.02em", color: C.ink }}>
                    Drop audio or video anywhere
                  </div>
                  <div style={{ fontSize: 15, color: C.muted, marginTop: 5 }}>
                    or <span style={{ color: C.ink }}>click to browse</span> — any length, nothing leaves your machine
                  </div>
                </div>
              </div>

              {/* staged batch */}
              {staged && (
                <div
                  style={{
                    marginTop: 18,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    background: C.panel,
                    overflow: "hidden",
                    opacity: interpolate(frame, [STAGED, STAGED + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ ...label, fontSize: 11, letterSpacing: "0.2em" }}>Ready to transcribe · 1</span>
                    <span style={{ ...label, fontSize: 11 }}>Clear</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 190px 170px", gap: 14, padding: "9px 16px", borderBottom: `1px solid ${C.border}99`, ...label, fontSize: 10, letterSpacing: "0.2em" }}>
                    <span />
                    <span>File</span>
                    <span>Model</span>
                    <span>Language</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 190px 170px", gap: 14, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}99` }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint, textAlign: "right" }}>1</span>
                    <span style={{ fontSize: 16, color: C.ink }}>{FILE}</span>
                    <span style={{ ...btn, textTransform: "none", letterSpacing: 0, fontFamily: SANS, fontSize: 14, color: C.ink, padding: "7px 12px" }}>large-v3-turbo</span>
                    <span style={{ ...btn, textTransform: "none", letterSpacing: 0, fontFamily: SANS, fontSize: 14, color: C.ink, padding: "7px 12px" }}>Auto-detect</span>
                  </div>
                  <div
                    style={{
                      background: C.ink,
                      color: C.bg,
                      textAlign: "center",
                      padding: "15px",
                      fontSize: 16,
                      fontWeight: 500,
                      opacity: pressed ? 0.85 : 1,
                    }}
                  >
                    Transcribe 1 file
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- drop overlay (App.tsx) ---- */}
        {overlay > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(12,12,12,.95)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 34,
              opacity: overlay,
              zIndex: 40,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 88 }}>
              {[38, 62, 30, 80, 48, 95, 60, 36, 84, 52, 70, 32, 90, 56, 42, 76, 46, 66, 34, 88].map((h, i) => {
                const phase = ((i * 53) % 100) / 100;
                const s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 1.4 + phase)));
                return <div key={i} style={{ width: 5, height: `${h}%`, transform: `scaleY(${s})`, transformOrigin: "bottom", background: C.ink, borderRadius: 99 }} />;
              })}
            </div>
            <div style={{ ...label, fontSize: 15 }}>Drop to transcribe</div>
          </div>
        )}

        {/* ---- dragged file + cursor ---- */}
        {frame >= DRAG_IN && frame < TO_APP && (
          <>
            {dragging && (
              <div
                style={{
                  position: "absolute",
                  left: cx + 16,
                  top: cy + 18,
                  zIndex: 55,
                  fontFamily: MONO,
                  fontSize: 15,
                  color: C.ink,
                  background: C.panel2,
                  border: `1px solid ${C.borderStrong}`,
                  borderRadius: 8,
                  padding: "10px 16px",
                  boxShadow: "0 12px 30px rgba(0,0,0,.55)",
                  transform: "rotate(-2deg)",
                  whiteSpace: "nowrap",
                }}
              >
                {FILE}
              </div>
            )}
            <Cursor x={cx} y={cy} />
          </>
        )}

        {/* ---- re-run dialog (RerunDialog.tsx) ---- */}
        {dialog && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 45,
              opacity: interpolate(frame, [RR_CLICK, RR_CLICK + 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <div style={{ width: 520, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
              <div style={{ padding: "17px 22px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: C.ink }}>Re-transcribe segment</div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint, marginTop: 5 }}>
                  Segment {RR_IDX + 1} · {fmtTC(SEGS[RR_IDX].start)} → {fmtTC(SEGS[RR_IDX].end)}
                </div>
              </div>
              {[
                ["Model", "Large v3"],
                ["Quantization", "Full"],
                ["Language", "English"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 22px", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ ...label, fontSize: 11 }}>{k}</span>
                  <span style={{ fontSize: 15, color: C.ink }}>{v}</span>
                </div>
              ))}
              <div style={{ padding: "12px 22px", fontSize: 13, lineHeight: 1.5, color: C.faint }}>
                This will re-run just this segment's time range and replace its text.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, padding: "14px 22px 18px" }}>
                <span style={btn}>Cancel</span>
                <span
                  style={{
                    ...btn,
                    background: C.ink,
                    color: C.bg,
                    borderColor: C.ink,
                    opacity: frame >= CONFIRM - 6 ? 0.85 : 1,
                  }}
                >
                  Re-run
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ---- review-act cursor ---- */}
        {frame >= REVIEW && frame < CONFIRM + 12 && <Cursor x={rx} y={ry} />}
      </div>

      {/* ---- end card ---- */}
      <AbsoluteFill
        style={{
          background: "#080808",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          opacity: interpolate(frame, [DONE_CARD, DONE_CARD + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ fontSize: 58, fontWeight: 650, letterSpacing: "-0.03em", color: C.ink }}>Transcriptor</div>
        <div style={{ fontSize: 22, color: C.muted }}>Transcribe anything. 100% offline.</div>
        <div style={{ ...label, marginTop: 10 }}>macOS · Windows · Free</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
