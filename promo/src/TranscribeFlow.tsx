import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// A faithful re-creation of Transcriptor's transcribe flow, straight from the
// app's own design tokens (src/App.css) and the Transcript page layout:
// drop a file → "Reading audio" → the real waveform lands → the playhead
// scrubs across it while subtitles type themselves in → done, exports ready.
// The transcript text is a real output of the engine's test harness.

export const FPS = 30;
export const DURATION_FRAMES = 450; // 15 s

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
  { start: 17.36, end: 19.92, text: "training on your data, or leaking it in a breach." },
  { start: 19.92, end: 24.6, text: "The file you drop is the file that gets transcribed, and the transcript lives only on your" },
  { start: 24.6, end: 31.28, text: "disk. Second, accuracy. Modern speech models transcribe over 99 languages and can auto-detect" },
  { start: 31.28, end: 37.08, text: "the spoken language from the first few seconds of audio. They emit frame accurate time stamps," },
  { start: 37.08, end: 41.68, text: "which means your subtitles stay in sync with the video, second by second, even for a" },
  { start: 41.68, end: 48.0, text: "four hour lecture. Third, reliability. There is no monthly quota, no per minute billing," },
];
const DUR = 48.0;
const FILE = "offline-podcast-ep1.m4a";

// ---- phases (frames) ----
const DROP_OUT = 36; // drop overlay gone
const WAVE_IN = 58; // peaks replace the ambient wave
const T_START = 72; // transcription begins
const T_END = 366; // reaches 100%
const DONE_CARD = 400; // end card fades in

// ---- timecode helpers (src/lib/time.ts) ----
const pad = (n: number, l = 2) => Math.floor(n).toString().padStart(l, "0");
const fmtDur = (t: number) => `${pad((t / 60) % 60)}:${pad(t % 60)}`;
const fmtTC = (t: number) =>
  `${pad(t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)},${pad((t - Math.floor(t)) * 1000, 3)}`;

// ---- the app's waveform texture (components/Waveform.tsx) ----
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

const label: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: C.faint,
};
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

export const TranscribeFlow = () => {
  const frame = useCurrentFrame();
  const sec = frame / FPS;

  // Audio time driven by the video: 48 s of audio over ~10 s of screen time —
  // the "faster than realtime" feel of a local model.
  const t = interpolate(frame, [T_START, T_END], [0, DUR], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pct = (t / DUR) * 100;
  const reading = frame < WAVE_IN;
  const running = frame < T_END;
  const activeIdx = running ? SEGS.findIndex((s) => t >= s.start && t < s.end) : -1;
  const active = activeIdx >= 0 ? SEGS[activeIdx] : null;
  const started = running ? SEGS.filter((s) => t >= s.start).length : SEGS.length;
  const elapsed = Math.max(0, sec - T_START / FPS);
  const waveIn = interpolate(frame, [WAVE_IN, WAVE_IN + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const caretOn = Math.floor(frame / 8) % 2 === 0;

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(90% 90% at 50% 40%, #121212 0%, #060606 100%)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SANS,
      }}
    >
      {/* ---- the app window ---- */}
      <div
        style={{
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

        {/* header */}
        <div style={{ padding: "8px 56px 20px" }}>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: C.ink }}>
            {FILE}
          </div>
          <div style={{ ...label, marginTop: 7 }}>
            large-v3-turbo · full · en{frame > T_START ? ` · ${fmtDur(DUR)}` : ""}
          </div>
        </div>

        {/* waveform panel */}
        <div style={{ margin: "0 56px" }}>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6 }}>
            {/* ruler */}
            <div style={{ position: "relative", height: 30, borderBottom: `1px solid ${C.border}` }}>
              {waveIn > 0 &&
                [0, 10, 20, 30, 40].map((s) => (
                  <React.Fragment key={s}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${(s / DUR) * 100}%`,
                        top: 0,
                        width: 1,
                        height: 14,
                        background: C.faint,
                        opacity: waveIn,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: `${(s / DUR) * 100}%`,
                        top: 2,
                        paddingLeft: 5,
                        fontFamily: MONO,
                        fontSize: 11,
                        color: C.faint,
                        opacity: waveIn,
                      }}
                    >
                      {fmtDur(s)}
                    </div>
                  </React.Fragment>
                ))}
            </div>

            {/* track */}
            <div style={{ position: "relative", height: 128 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: `${C.border}99` }} />

              {reading ? (
                // "Reading audio" — the app's ambient wave
                <>
                  <div style={{ position: "absolute", inset: "10px 12px", display: "flex", alignItems: "center", gap: 3 }}>
                    {Array.from({ length: 48 }).map((_, i) => {
                      const phase = ((i * 53) % 100) / 100;
                      const s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 3.2 + phase)));
                      return (
                        <div key={i} style={{ flex: 1, height: "50%", transform: `scaleY(${s})`, background: `${C.faint}99`, borderRadius: 99 }} />
                      );
                    })}
                  </div>
                  <div style={{ ...label, position: "absolute", top: 10, width: "100%", textAlign: "center" }}>
                    Reading audio
                  </div>
                </>
              ) : (
                <>
                  {/* played tint */}
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${pct}%`, background: "rgba(244,244,244,.06)" }} />

                  {/* live subtitle block — the app's signature */}
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
                          {/* end-edge label only when the block is wide enough
                             for two timecodes — they collide on short segments */}
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

                  {/* the wave — brightens as the pass advances */}
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
                            background:
                              h === 0 ? C.border : pending ? "rgba(98,98,98,.25)" : inSel ? C.ink : C.muted,
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* playhead */}
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pct}%`, zIndex: 10 }}>
                    <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: C.ink, opacity: running ? 0.6 + 0.4 * Math.sin(sec * 6) : 1 }} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* rows */}
        <div style={{ flex: 1, margin: "22px 56px 0", borderTop: `1px solid ${C.border}`, overflow: "hidden" }}>
          {/* column header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "56px 160px 160px 84px 1fr",
              borderBottom: `1px solid ${C.border}`,
              ...label,
              fontSize: 11,
              padding: "0",
            }}
          >
            <span style={{ padding: "10px 10px", textAlign: "right" }}>#</span>
            <span style={{ padding: "10px 10px" }}>Start</span>
            <span style={{ padding: "10px 10px" }}>End</span>
            <span style={{ padding: "10px 10px", textAlign: "right" }}>Dur</span>
            <span style={{ padding: "10px 16px" }}>Text</span>
          </div>

          {SEGS.map((s, i) => {
            if (running && t < s.start) return null;
            const isActive = running ? i === activeIdx : false;
            const isSel = running ? i === (activeIdx >= 0 ? activeIdx : started - 1) : i === SEGS.length - 1;
            const f = isActive ? (t - s.start) / (s.end - s.start) : 1;
            const chars = running && isActive ? Math.floor(s.text.length * Math.min(1, f * 1.08)) : s.text.length;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "56px 160px 160px 84px 1fr",
                  borderBottom: `1px solid ${C.border}66`,
                  borderLeft: `2px solid ${isSel ? C.ink : "transparent"}`,
                  background: isSel ? C.panel2 : "transparent",
                  fontFamily: MONO,
                  fontSize: 13.5,
                }}
              >
                <span style={{ padding: "11px 10px", textAlign: "right", color: isSel ? C.ink : C.faint }}>{i + 1}</span>
                <span style={{ padding: "11px 10px", color: isSel ? C.ink : C.muted }}>{fmtTC(s.start)}</span>
                <span style={{ padding: "11px 10px", color: isSel ? C.ink : C.muted }}>{fmtTC(s.end)}</span>
                <span style={{ padding: "11px 10px", textAlign: "right", color: C.faint }}>{(s.end - s.start).toFixed(2)}</span>
                <span style={{ padding: "10px 16px", fontFamily: SANS, fontSize: 16, lineHeight: 1.45, color: C.ink }}>
                  {s.text.slice(0, chars)}
                  {isActive && caretOn && (
                    <span style={{ display: "inline-block", width: 2.5, height: "0.95em", background: C.ink, verticalAlign: "-0.12em", marginLeft: 3 }} />
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* transport footer */}
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
          {/* progress rail */}
          {running && (
            <div style={{ position: "absolute", left: 0, right: 0, top: -1, height: 3, background: `${C.border}99`, overflow: "hidden" }}>
              {reading ? (
                <div
                  style={{
                    position: "absolute",
                    width: "25%",
                    height: "100%",
                    background: "rgba(244,244,244,.7)",
                    left: `${interpolate((sec % 1.6) / 1.6, [0, 1], [-25, 125])}%`,
                  }}
                />
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
              {!reading && (
                <span style={{ fontFamily: MONO, fontSize: 17, color: C.ink }}>{Math.round(pct)}%</span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>
                {reading ? "" : `${started} segments · ${fmtDur(elapsed)}`}
              </span>
              <span style={{ ...btn, marginLeft: "auto" }}>Cancel</span>
            </>
          ) : (
            <>
              <span style={{ color: C.muted, fontSize: 15 }}>▶</span>
              <span style={{ fontFamily: MONO, fontSize: 17, color: C.ink }}>00:00:00,000</span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>/ {fmtDur(DUR)} · {SEGS.length} subtitles</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {["txt", "srt", "vtt", "json", "article", "copy"].map((f) => (
                  <span key={f} style={btn}>{f}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- drop overlay ---- */}
      <AbsoluteFill
        style={{
          background: "rgba(12,12,12,.93)",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          opacity: interpolate(frame, [DROP_OUT - 12, DROP_OUT], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
          {[38, 62, 30, 80, 48, 95, 60, 36, 84, 52, 70, 32, 90, 56, 42, 76, 46, 66, 34, 88].map((h, i) => {
            const phase = ((i * 53) % 100) / 100;
            const s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 1.4 + phase)));
            return (
              <div key={i} style={{ width: 5, height: `${h}%`, transform: `scaleY(${s})`, transformOrigin: "bottom", background: C.ink, borderRadius: 99 }} />
            );
          })}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 17,
            color: C.ink,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 8,
            padding: "12px 26px",
            background: C.panel,
            transform: `translateY(${interpolate(frame, [0, 18], [-26, 0], { extrapolateRight: "clamp" })}px)`,
          }}
        >
          {FILE}
        </div>
        <div style={{ ...label, fontSize: 15 }}>Drop to transcribe</div>
      </AbsoluteFill>

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
