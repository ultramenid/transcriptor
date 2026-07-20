// ponytail: placeholder demo. Replace with a real screen recording of the app
// when footage exists — swap this composition for <OffthreadVideo src={...}/>.
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const BG = "#0a0a0a";
const AMBER = "#fafafa";
const INK = "#fafafa";
const MUTED = "#a3a3a3";

const TRANSCRIPT: [string, string][] = [
  ["00:00", "Welcome back to the show. Today we're talking about"],
  ["00:04", "on-device machine learning and why privacy matters."],
  ["00:09", "Everything you record here stays on your own machine —"],
  ["00:13", "nothing is ever uploaded, capped, or truncated."],
  ["00:18", "Even a four-hour recording transcribes end to end."],
  ["00:23", "And the timestamps line up exactly with your video."],
];

const Waveform: React.FC<{ frame: number }> = ({ frame }) => {
  const bars = 64;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 160,
      }}
    >
      {new Array(bars).fill(0).map((_, i) => {
        const h =
          40 +
          Math.abs(Math.sin(i * 0.5 + frame * 0.12)) *
            Math.abs(Math.cos(i * 0.21 + frame * 0.05)) *
            120;
        return (
          <div
            key={i}
            style={{
              width: 8,
              height: h,
              borderRadius: 4,
              background: AMBER,
              opacity: 0.35 + (h / 160) * 0.65,
            }}
          />
        );
      })}
    </div>
  );
};

export const Showcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleIn, [0, 1], [40, 0]);

  const linesShown = Math.min(
    TRANSCRIPT.length,
    Math.floor(interpolate(frame, [40, 300], [0, TRANSCRIPT.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }))
  );

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 120% at 50% 0%, #141414 0%, ${BG} 60%)`,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: 96,
        color: INK,
      }}
    >
      <div
        style={{
          opacity: titleIn,
          transform: `translateY(${titleY}px)`,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: AMBER,
          }}
        />
        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
          Transcriptor
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 22,
            color: MUTED,
            border: `1px solid #262626`,
            padding: "8px 16px",
            borderRadius: 999,
          }}
        >
          100% offline · on-device
        </span>
      </div>

      <div style={{ marginTop: 56, marginBottom: 24 }}>
        <Waveform frame={frame} />
      </div>

      <div
        style={{
          flex: 1,
          background: "#141414",
          border: "1px solid #262626",
          borderRadius: 24,
          padding: 48,
          display: "flex",
          flexDirection: "column",
          gap: 28,
          overflow: "hidden",
        }}
      >
        {TRANSCRIPT.slice(0, linesShown).map(([ts, text], i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 32,
              alignItems: "baseline",
              opacity: interpolate(
                frame,
                [40 + i * 40, 60 + i * 40],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              ),
            }}
          >
            <span
              style={{
                fontSize: 30,
                color: AMBER,
                fontVariantNumeric: "tabular-nums",
                minWidth: 120,
              }}
            >
              {ts}
            </span>
            <span style={{ fontSize: 34, lineHeight: 1.4 }}>{text}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 40,
          fontSize: 24,
          color: MUTED,
          textAlign: "center",
        }}
      >
        Placeholder preview — real app recording coming soon
      </div>
    </AbsoluteFill>
  );
};
