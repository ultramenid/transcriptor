# CLAUDE.md

Transcriptor — native, cross-platform (Win/macOS/Linux) desktop app that transcribes audio/video files to timestamped text, **100% offline**, plus a static marketing landing page.

**`PROMPT.md` is the product constitution.** Read it before any product/architecture decision — it has the full detail on the model picker, quantization table, library schema, acceptance tests (T1–T20), and v2 engine notes. This file is the working summary.

## Core loop

Drop a file → pick model + language → transcribe → review → export.

## Priorities (non-negotiable, in order)

1. **Accuracy + reliability** — correct on real-world audio (accents, noise, 4-hour files); never crash or silently drop content.
2. **Native, polished UX** — first-class feel per OS; beautiful home screen; live streaming progress.
3. **Offline/privacy** — everything on-device. No cloud, no accounts, no telemetry, no `.env`, no secrets. Only network use: user-initiated model downloads from HuggingFace.

## Fixed decisions — do not debate or revisit

- **Engine:** whisper.cpp via `whisper-rs` crate, compiled into the Rust binary. Never train/hand-roll ASR. GPU as Cargo features (`metal` on macOS, `cuda`/`vulkan` on Win/Linux) with CPU fallback.
- **Stack:** Tauri 2.x + React + TypeScript + Vite + Tailwind (app); `rusqlite` + SQLite FTS5 (library/search); ffmpeg as Tauri sidecar (`externalBin`, LGPL build) for audio extraction to 16 kHz mono WAV; Astro + Tailwind (marketing site, near-zero JS).
- **Models:** none bundled. First-run picker downloads on demand (resumable, checksummed, never half-written) into `<app_data>/models/`. Range: tiny → large-v3 + distil-large-v3; **default recommendation `large-v3-turbo`**. Quantization shown as **Compact / Balanced / Full** labels (raw quant names stay hidden); only published variants listed — sizes table in PROMPT.md.
- **Video:** ffmpeg probes → extract default audio track to temp WAV → transcribe → **always delete the temp WAV** (done or cancelled). No audio track = clear error, not a crash. SRT/VTT timestamps align to the video timeline by construction.
- **Persistence:** one SQLite table of "works" (`library.db` in the per-OS app data dir); recents, library/history, and queue are three views of it. Transcript text + segments always persisted; exports regenerated on demand, never cached.

## Layout (target)

```
src-tauri/src/   main.rs, commands.rs, whisper.rs, audio.rs, models.rs, config.rs, library.rs
src/             React app: pages/ (Home, Transcript, Queue, Library, Models, Settings), components/, hooks/
marketing/       Astro static site (separate deploy)
package.json     pnpm workspace: app + marketing
```

## Commands

- `pnpm tauri dev` — run the app
- `pnpm tauri build` — build host-OS installers
- `pnpm --filter marketing dev` / `build` — marketing site

## Do NOT build (v1)

Cloud/accounts/telemetry/sync of any kind; bundled model weights; ASR from scratch; speaker diarization; real-time mic transcription; full media player (click-to-time seek is an optional nice-to-have); multi-track audio selection or embedded-subtitle extraction; transcript version history (editor undo only); translation UI; mobile; custom auto-update beyond Tauri's built-in.

## Definition of done

A change is done when the relevant acceptance tests in PROMPT.md (T1–T20) pass. The bar: a messy, hour-long, accented, noisy recording produces an accurate timestamped transcript, exportable in TXT/SRT/VTT/JSON/Article — entirely offline, without freezing the UI.
