export type Quant = "compact" | "balanced" | "full";

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
