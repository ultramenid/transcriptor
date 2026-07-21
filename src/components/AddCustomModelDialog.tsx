import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { basename } from "../lib/format";

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

// "ggml-my-fine-tuned-small.bin" → "my fine tuned small"
function labelFromPath(path: string): string {
  return basename(path)
    .replace(/\.bin$/i, "")
    .replace(/^ggml-/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

// Modal for importing a custom ggml model into the library. Mirrors the
// RerunDialog shell (overlay, panel, escape, click-away).
export default function AddCustomModelDialog({ open, onConfirm, onCancel }: Props) {
  const [srcPath, setSrcPath] = useState("");
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [languages, setLanguages] = useState("Multilingual");

  // Reset to a fresh state each time the dialog opens so a previous tentative
  // choice doesn't leak into the next invocation.
  useEffect(() => {
    if (open) {
      setSrcPath("");
      setLabel("");
      setLabelTouched(false);
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
    if (typeof picked === "string") {
      setSrcPath(picked);
      // Prefill the name from the filename unless the user already typed one.
      if (!labelTouched) setLabel(labelFromPath(picked));
    }
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
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Any Whisper-compatible <span className="font-mono">ggml</span> file works — the same{" "}
            <span className="font-mono">.bin</span> format the built-in models use.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* File well — kin to the library's drop strip. */}
          <button
            type="button"
            onClick={chooseFile}
            className="w-full rounded-md border border-dashed border-border-strong px-4 py-5 text-center transition-colors hover:border-ink-faint"
          >
            {srcPath ? (
              <>
                <p className="truncate text-sm font-medium text-ink">{basename(srcPath)}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-ink-faint" title={srcPath}>
                  {srcPath}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                  Choose a different file
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink">Choose a .bin model file</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Find models at{" "}
                  <span className="font-mono text-ink-faint">huggingface.co/ggerganov/whisper.cpp</span>
                </p>
              </>
            )}
          </button>

          <div className="space-y-1.5">
            <label
              htmlFor="custom-model-name"
              className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint"
            >
              Name
            </label>
            <input
              id="custom-model-name"
              type="text"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setLabelTouched(true);
              }}
              placeholder="e.g. My fine-tuned small"
              className="w-full rounded-md border border-border-subtle bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-ink-faint"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
              Languages
            </span>
            <div className="flex gap-1 rounded-md border border-border-subtle p-1" role="group" aria-label="Languages">
              {["Multilingual", "English only"].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={languages === opt}
                  onClick={() => setLanguages(opt)}
                  className={`flex-1 rounded px-3 py-1.5 text-xs transition-colors ${
                    languages === opt
                      ? "bg-ink font-medium text-bg"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            The file is copied into your library and works like any other model. Delete it from the
            Models page when you're done.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4">
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
            Add model
          </button>
        </div>
      </div>
    </div>
  );
}
