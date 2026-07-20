import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface Selection {
  srcPath: string;
  label: string;
  languages: string;
}

interface Props {
  open: boolean;
  onConfirm: (sel: Selection) => void;
  onCancel: () => void;
}

// Modal for importing a custom ggml model into the library. Mirrors the
// RerunDialog shell (overlay, panel, escape, click-away) and the page's
// mono-eyebrow button styling.
export default function AddCustomModelDialog({ open, onConfirm, onCancel }: Props) {
  const [srcPath, setSrcPath] = useState("");
  const [label, setLabel] = useState("");
  const [languages, setLanguages] = useState("Multilingual");

  // Reset to a fresh state each time the dialog opens so a previous tentative
  // choice doesn't leak into the next invocation.
  useEffect(() => {
    if (open) {
      setSrcPath("");
      setLabel("");
      setLanguages("Multilingual");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmedLabel = label.trim();
  const canAdd = srcPath !== "" && trimmedLabel !== "";

  async function chooseFile() {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "ggml model", extensions: ["bin"] }],
    });
    if (typeof picked === "string") setSrcPath(picked);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add custom model"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border-subtle bg-panel shadow-2xl"
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink">Add custom model</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Guide — what counts as a custom model and where to find one. */}
          <div className="rounded-md border border-border-subtle bg-bg/50 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
            <p>
              Bring your own Whisper-compatible <span className="font-mono text-ink-faint">ggml</span> model.
              These are the same <span className="font-mono text-ink-faint">.bin</span> files this app
              downloads for its built-in models.
            </p>
            <p className="mt-1.5">
              Find more at{" "}
              <span className="font-mono text-ink-faint">huggingface.co/ggerganov/whisper.cpp</span>{" "}
              and{" "}
              <span className="font-mono text-ink-faint">distil-whisper</span>{" "}
              — download the <span className="font-mono text-ink-faint">.bin</span> file, then choose it below.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
              Model file
            </label>
            <button
              type="button"
              onClick={chooseFile}
              className="rounded-md border border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              Choose file…
            </button>
            {srcPath ? (
              <p className="truncate font-mono text-[11px] text-ink-faint">{srcPath}</p>
            ) : (
              <p className="font-mono text-[11px] text-ink-faint">No file selected · must be a .bin</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
              Name
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My fine-tuned small"
              className="w-full rounded-md border border-border-subtle bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-ink-faint"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
              Languages
            </label>
            <select
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-bg px-3 py-2 text-sm text-ink outline-none"
            >
              <option value="Multilingual">Multilingual</option>
              <option value="English only">English only</option>
            </select>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            The file is copied into your library and works like any other model. You can delete it from the
            Models page when you're done.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ srcPath, label: trimmedLabel, languages })}
            disabled={!canAdd}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-bg hover:bg-accent-bright disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}