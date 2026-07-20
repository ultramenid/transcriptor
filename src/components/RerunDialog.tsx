import { useEffect, useMemo, useState } from "react";
import type { ModelEntry } from "../lib/types";
import PickerCell from "./Picker";
import LanguageSelect from "./LanguageSelect";

export interface RerunSelection {
  modelId: string;
  language: string;
}

interface Props {
  open: boolean;
  title: string;
  // Context line shown under the title — e.g. the filename, or
  // "Segment 3 · 00:12.40 → 00:15.10".
  context: string;
  // What gets replaced if the user proceeds.
  warning: string;
  models: ModelEntry[];
  // Current settings — used as the initial selection.
  initial: RerunSelection;
  confirmLabel?: string;
  onConfirm: (sel: RerunSelection) => void;
  onCancel: () => void;
}

// Modal for re-running transcription with a chosen model + language.
// Used for both whole-file and per-segment re-run, so the only thing that
// varies is the title/context/warning text.
export default function RerunDialog({
  open,
  title,
  context,
  warning,
  models,
  initial,
  confirmLabel = "Re-run",
  onConfirm,
  onCancel,
}: Props) {
  const [sel, setSel] = useState<RerunSelection>(initial);

  // Reset to the current settings each time the dialog opens so a previous
  // tentative choice doesn't leak into the next invocation.
  useEffect(() => {
    if (open) setSel(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const installed = useMemo(
    () => models.filter((m) => m.variants.some((v) => v.installed)),
    [models],
  );

  function patch(p: Partial<RerunSelection>) {
    setSel((prev) => ({ ...prev, ...p }));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border-subtle bg-panel shadow-2xl"
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">{context}</p>
        </div>

        {installed.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-ink-muted">No model installed. Download one first.</p>
          </div>
        ) : (
          <>
            <div className="border-b border-border-subtle">
              <PickerCell
                label="Model"
                value={sel.modelId}
                onChange={(id) => patch({ modelId: id })}
                options={installed.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
            <div className="border-b border-border-subtle">
              <LanguageSelect value={sel.language} onChange={(l) => patch({ language: l })} />
            </div>
            <p className="px-5 py-3 text-xs leading-relaxed text-ink-faint">{warning}</p>
          </>
        )}

        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:border-ink-faint"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(sel)}
            disabled={installed.length === 0}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-bg hover:bg-accent-bright disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}