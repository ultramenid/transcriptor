// Only one variant per model now (full precision). Kept as a literal type so
// the persisted schema and IPC shapes stay stable.
export type Quant = "full";

// A staged-but-not-enqueued file. Each carries its own model + language since
// different files may need different settings.
export interface PendingFile {
  path: string;
  model: string;
  quant: Quant;
  language: string;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Work {
  id: string;
  sourceFilename: string;
  sourcePath: string | null;
  durationSecs: number | null;
  language: string | null;
  modelId: string | null;
  quant: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  transcriptText: string;
  segments: Segment[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelVariant {
  quant: Quant;
  sizeBytes: number;
  installed: boolean;
}

export interface ModelEntry {
  id: string;
  label: string;
  speed: string;
  accuracy: string;
  languages: string;
  license: string;
  variants: ModelVariant[];
}

export interface Settings {
  defaultModelId: string | null;
  defaultQuant: string | null;
  defaultLanguage: string;
  outputDir: string | null;
  copySourceIntoLibrary: boolean;
}
