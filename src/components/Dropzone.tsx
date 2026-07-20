import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";

// Static waveform silhouette — the idle/drag-over states of the dropzone.
// Deterministic heights (not random) so the layout never jitters on re-render.
const BAR_HEIGHTS = [
  22, 40, 18, 55, 30, 70, 45, 25, 60, 35, 50, 20, 65, 40, 28, 58, 33, 48, 20,
  62, 38, 26, 52, 30, 44, 18, 56, 32,
];

const MEDIA_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "wma",
  "mp4", "mkv", "mov", "avi", "webm", "m4v",
]);

function isMediaFile(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MEDIA_EXTENSIONS.has(ext) : false;
}

export default function Dropzone({ onFiles }: { onFiles: (paths: string[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") {
        setIsDragging(true);
      } else if (e.payload.type === "drop") {
        setIsDragging(false);
        const media = e.payload.paths.filter(isMediaFile);
        if (media.length > 0) onFiles(media);
        else setRejected(true);
      } else {
        setIsDragging(false);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [onFiles]);

  useEffect(() => {
    if (!rejected) return;
    const t = setTimeout(() => setRejected(false), 2500);
    return () => clearTimeout(t);
  }, [rejected]);

  async function browse() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio & video", extensions: Array.from(MEDIA_EXTENSIONS) }],
    });
    if (!selected) return;
    onFiles(Array.isArray(selected) ? selected : [selected]);
  }

  return (
    <div>
      <div
        onClick={browse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") browse();
        }}
        className={`group relative flex cursor-pointer flex-col items-center gap-6 overflow-hidden rounded-2xl border px-6 py-12 text-center transition-colors duration-300 md:px-10 md:py-16 ${
          isDragging ? "border-accent bg-panel-2" : "border-border-subtle bg-panel hover:border-ink-faint"
        }`}
      >
        <div className="pointer-events-none flex h-16 items-end gap-[3px]">
          {BAR_HEIGHTS.map((h, i) => (
            <span
              key={i}
              style={{
                height: `${isDragging ? Math.min(h * 1.35, 100) : h}%`,
                animationDelay: isDragging ? undefined : `${((i * 53) % 100) / 100}s`,
              }}
              className={`w-[3px] origin-bottom rounded-full transition-colors duration-300 ${
                isDragging
                  ? "bg-accent"
                  : "bg-ink-faint/70 animate-[wave_3.2s_ease-in-out_infinite] group-hover:bg-ink-muted motion-reduce:animate-none"
              }`}
            />
          ))}
        </div>

        <div className="pointer-events-none space-y-1.5">
          <p className="text-lg font-medium tracking-tight text-ink">
            {isDragging ? "Release to queue" : "Drop a file to begin"}
          </p>
          <p className="text-sm text-ink-muted">
            or <span className="text-ink">click to browse</span> — audio or video, any length
          </p>
        </div>
      </div>

      {rejected && (
        <p className="mt-3 text-center font-mono text-xs text-ink-muted">
          That doesn’t look like an audio or video file.
        </p>
      )}
    </div>
  );
}
