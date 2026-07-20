import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Quant } from "./types";

// Key a download by `${modelId}:${quant}` so multiple variants — even of the
// same model — can download concurrently without their progress colliding.
export function downloadKey(modelId: string, quant: Quant) {
  return `${modelId}:${quant}`;
}

export interface Progress {
  downloaded: number;
  total: number;
}

// Owns the model-download lifecycle at the app shell so downloads keep running
// when the user navigates away from the Models page. The progress listener is
// mounted once for the whole session; `download` kicks off a fire-and-forget
// invoke whose promise is tracked but never awaited by the caller.
export function useDownloads() {
  const [models, setModels] = useState<import("./types").ModelEntry[]>([]);
  // Per-variant progress, keyed by `${modelId}:${quant}`.
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // Variant keys currently downloading. Persists across page changes.
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Track in-flight variant keys so a second click on the same variant is a
  // no-op and so we can refresh the model list when one settles.
  const inflight = useRef<Set<string>>(new Set());

  const refreshModels = useCallback(async () => {
    const list = await invoke<import("./types").ModelEntry[]>("list_models");
    setModels(list);
  }, []);

  // Load once on mount so the library picker and Models page both have data
  // without each doing their own fetch.
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  // One progress listener for the whole session — survives page changes.
  useEffect(() => {
    const unlisten = listen<{ modelId: string; quant: string; downloaded: number; total: number }>(
      "model-download-progress",
      (e) => {
        setProgress((prev) => ({
          ...prev,
          [downloadKey(e.payload.modelId, e.payload.quant as Quant)]: {
            downloaded: e.payload.downloaded,
            total: e.payload.total,
          },
        }));
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // After a download finishes, drop its progress bar after a short fade so the
  // row settles back to its idle state.
  useEffect(() => {
    if (Object.keys(progress).length === 0) return;
    const stale = Object.keys(progress).filter((k) => !downloading.has(k));
    if (stale.length === 0) return;
    const t = setTimeout(() => {
      setProgress((prev) => {
        const next = { ...prev };
        for (const k of stale) delete next[k];
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [progress, downloading]);

  const download = useCallback(
    (modelId: string, quant: Quant) => {
      const k = downloadKey(modelId, quant);
      // Already in flight — ignore the repeat click.
      if (inflight.current.has(k)) return;

      inflight.current.add(k);
      setDownloading((prev) => new Set(prev).add(k));
      setErrors((prev) => {
        if (!prev[k]) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      });

      (async () => {
        try {
          await invoke("download_model", { modelId, quant });
          await refreshModels();
        } catch (e) {
          setErrors((prev) => ({ ...prev, [k]: String(e) }));
        } finally {
          inflight.current.delete(k);
          setDownloading((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
        }
      })();
    },
    [refreshModels],
  );

  const remove = useCallback(
    async (modelId: string, quant: Quant) => {
      const k = downloadKey(modelId, quant);
      setDownloading((prev) => new Set(prev).add(k));
      try {
        await invoke("delete_model", { modelId, quant });
        await refreshModels();
      } finally {
        setDownloading((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }
    },
    [refreshModels],
  );

  const addCustom = useCallback(
    async (srcPath: string, label: string, languages: string) => {
      await invoke<string>("add_custom_model", { srcPath, label, languages });
      await refreshModels();
    },
    [refreshModels],
  );

  return {
    models,
    progress,
    downloading,
    errors,
    download,
    remove,
    addCustom,
    refreshModels,
  };
}