import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Dropzone from "../components/Dropzone";
import LanguageSelect from "../components/LanguageSelect";
import type { ModelEntry, Quant } from "../lib/types";

const QUANT_LABEL: Record<Quant, string> = {
  compact: "Compact",
  balanced: "Balanced",
  full: "Full",
};

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-border-subtle bg-bg px-2.5 py-1.5 text-ink outline-none transition-colors hover:border-ink-faint focus:border-ink-faint disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface HomeProps {
  onOpen: (workId: string) => void;
  onGoModels: () => void;
}

export default function Home({ onOpen, onGoModels }: HomeProps) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState("");
  const [quant, setQuant] = useState<Quant>("compact");
  const [language, setLanguage] = useState("auto");

  useEffect(() => {
    invoke<ModelEntry[]>("list_models").then(setModels);
  }, []);

  // The picker only ever offers what's actually on disk — installed models and,
  // for the chosen model, its installed quants. Nothing to silently fall back
  // from, so what you see is exactly what runs.
  const installed = models.filter((m) => m.variants.some((v) => v.installed));
  const installedQuants = (model ? models.find((m) => m.id === model)?.variants.filter((v) => v.installed) : []) ?? [];

  // Once the model list loads, pin the selection to a real installed model+quant.
  // Default to the recommended large-v3-turbo if it's installed, else the first
  // installed; keeps the picker honest on first paint.
  useEffect(() => {
    if (installed.length === 0) return;
    if (!installed.some((m) => m.id === model)) {
      const pick = installed.find((m) => m.id === "large-v3-turbo") ?? installed[0];
      setModel(pick.id);
      setQuant(pick.variants.find((v) => v.installed)!.quant);
    } else if (!installedQuants.some((q) => q.quant === quant)) {
      setQuant(installedQuants[0].quant);
    }
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFiles(paths: string[]) {
    // Selection is already constrained to installed variants, so there's no
    // fallback path. If somehow nothing is installed, route to the Models page
    // instead of enqueueing a job that can't run.
    if (!model || installedQuants.length === 0) {
      onGoModels();
      return;
    }
    const ids = await invoke<string[]>("enqueue_files", {
      paths,
      modelId: model,
      quant,
      language,
    });
    if (ids.length > 0) onOpen(ids[0]);
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10 md:px-12 md:py-14 lg:px-20">
      <div className="w-full max-w-2xl">
        <div className="mb-10 space-y-2 text-center md:mb-12">
          <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
            Private, offline transcription
          </h1>
          <p className="text-ink-muted">Drop in any audio or video file. Nothing leaves your machine.</p>
        </div>

        {installed.length === 0 && models.length > 0 && (
          <div className="mb-4 rounded-lg border border-border-subtle px-4 py-3 text-center">
            <p className="text-sm text-ink">
              No model installed yet.{" "}
              <button onClick={onGoModels} className="font-medium text-ink underline">
                Pick and download one
              </button>{" "}
              before transcribing.
            </p>
          </div>
        )}

        <Dropzone onFiles={handleFiles} />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-lg border border-border-subtle bg-panel px-4 py-3">
          <Select
            label="Model"
            value={model}
            disabled={installed.length === 0}
            onChange={(v) => {
              setModel(v);
              const quants = models.find((m) => m.id === v)?.variants.filter((q) => q.installed) ?? [];
              if (quants.length && !quants.some((q) => q.quant === quant)) setQuant(quants[0].quant);
            }}
            options={installed.map((m) => ({ value: m.id, label: m.label }))}
          />
          {installedQuants.length > 1 && (
            <Select
              label="Quality"
              value={quant}
              onChange={(v) => setQuant(v)}
              options={installedQuants.map((v) => ({ value: v.quant, label: QUANT_LABEL[v.quant] }))}
            />
          )}
          <LanguageSelect value={language} onChange={setLanguage} disabled={installed.length === 0} />
        </div>
      </div>
    </main>
  );
}