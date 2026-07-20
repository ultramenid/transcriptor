# 🎙️ Transcriptor

**Native, 100% offline audio & video transcription — for macOS, Windows, and Linux.**

Drop a file, pick a model and language, transcribe, review, and export. No cloud, no accounts, no telemetry — your audio never leaves your machine.

Transcriptor wraps [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (via [`whisper-rs`](https://crates.io/crates/whisper-rs)) inside a [Tauri 2](https://tauri.app) + React + TypeScript shell, with [ffmpeg](https://ffmpeg.org) for audio extraction and SQLite for a searchable library.

---

## ⬇️ Download & install

Grab the latest installer from the [releases page](https://github.com/ultramenid/transcriptor/releases/latest). **ffmpeg/ffprobe are bundled** — you don't need to install anything else.

### macOS (Apple Silicon — M1/M2/M3/M4)

1. Download **`Transcriptor_<version>_aarch64.dmg`**.
2. Open the `.dmg` and drag **Transcriptor** into the **Applications** folder.
3. The app is **not code-signed or notarized** (no Apple Developer Program enrollment yet), so the first time you try to open it macOS will show **"Transcriptor is damaged and can't be opened"**. This is Gatekeeper refusing an unsigned binary — the app is fine. Fix it once by running this in **Terminal**:
   ```bash
   xattr -cr /Applications/Transcriptor.app
   ```
4. Double-click **Transcriptor** in Applications (or `open /Applications/Transcriptor.app`) to launch it.

> No Intel Mac build yet — only Apple Silicon. ffmpeg is bundled inside the app.

### Windows (x64 — Windows 10/11)

1. Download **`Transcriptor_<version>_x64-setup.exe`** (NSIS installer) **or** **`Transcriptor_<version>_x64_en-US.msi`** (MSI installer). Either works; pick one.
2. Run the installer. The installer is **unsigned**, so Windows SmartScreen may warn **"Windows protected your PC"**. Click **More info → Run anyway** to proceed.
3. After installation, launch **Transcriptor** from the Start menu.

> ffmpeg is bundled inside the app — no `choco`/`scoop` install needed.

---

## ✨ Features

- **Fully offline.** Everything runs on-device. The only network traffic is an optional, user-initiated model download from HuggingFace.
- **Accurate on real audio.** Powered by Whisper models from `tiny` to `large-v3` (default: `large-v3-turbo`), with GPU acceleration via Metal (macOS) or CUDA/Vulkan (Windows/Linux) and a CPU fallback.
- **Video & audio.** ffmpeg probes your file and extracts the audio track to a 16 kHz mono WAV, then the temp file is always cleaned up — done or cancelled.
- **Per-file model & language.** Set a default, override per file. Re-run individual segments without reprocessing the whole file.
- **Custom models.** Bring your own Whisper-format `.bin` model — add it through the Models screen.
- **Live progress.** Streaming transcription progress so you never stare at a frozen UI.
- **Library & history.** Everything is saved in a local SQLite database (with FTS5 search). Recents, library, and queue are all views of the same store.
- **Exports.** Regenerate on demand into TXT, SRT, VTT, JSON, or Article — never cached, always in sync.
- **Native feel.** First-class polish on each OS, packaged as a real native app.

---

## 🧱 Tech stack

| Layer    | Tech                                                                |
| -------- | ------------------------------------------------------------------ |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4                         |
| Backend  | Rust, Tauri 2.x, `whisper-rs` (whisper.cpp), `rusqlite` (SQLite FTS5) |
| Media    | ffmpeg (bundled as a Tauri sidecar, fetched per-platform in CI)       |
| Marketing | Astro + Tailwind (separate static site in `marketing/`)           |

---

## 📁 Project layout

```
src-tauri/src/   Rust core: commands, whisper, audio, models, config, library
src/             React app: pages (Home, Transcript, Library, Models, Settings), components, hooks
marketing/       Astro marketing site (separate deploy)
samples/         Sample media for testing
package.json     pnpm workspace: app + marketing
```

---

## 🚀 Getting started

### Prerequisites

- **Node.js** 18+ and **[pnpm](https://pnpm.io)**
- **[Rust](https://www.rust-lang.org/tools/install)** (stable toolchain)
- **Tauri 2 system dependencies** — follow the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS:
  - macOS: Xcode Command Line Tools
  - Windows: Microsoft C++ Build Tools & WebView2
  - Linux: `webkit2gtk`, `libgtk-3`, `libayatana-appindicator`, etc.

### Install & run

```bash
# 1. Install JS dependencies
pnpm install

# 2. Run the app in dev mode (starts Vite + the Rust backend)
pnpm tauri dev
```

The first run will compile `whisper-rs` and whisper.cpp — expect a longer build the first time. Subsequent builds are cached.

### Build an installer for your OS

```bash
pnpm tauri build
```

Output installers land in `src-tauri/target/release/bundle/`.

### Marketing site (optional)

```bash
pnpm --filter marketing dev      # local dev
pnpm --filter marketing build    # production build
```

---

## 📖 How to use Transcriptor

1. **Launch the app.** On first run you'll see the model picker.
2. **Download a model.** Start with **`large-v3-turbo` (Balanced)** — it's the recommended default. Models download on demand and are stored in your per-OS app data folder under `models/`. Downloads are resumable and checksummed.
   - *Quantization* is shown as friendly labels: **Compact / Balanced / Full**.
   - You can also add a **custom model** (Whisper `.bin`) from the Models screen.
3. **Drop a file** (or use the open dialog). Any common audio or video format works — ffmpeg handles extraction.
4. **Pick language** (or leave it on auto-detect) and confirm the model.
5. **Watch it transcribe** with live, streaming progress.
6. **Review the transcript.** Need a better take on one segment? Re-run just that segment with a different model or language.
7. **Export** to **TXT, SRT, VTT, JSON, or Article**. SRT/VTT timestamps align to the source media timeline by construction.
8. **Find it later** in the Library — full-text search across all past works.

> Tip: for hour-long, noisy, or heavily accented recordings, use `large-v3` or `large-v3-turbo`. For quick drafts on clean audio, `tiny` or `base` is plenty fast.

---

## 🗂️ Commands reference

| Command                          | What it does                                  |
| -------------------------------- | --------------------------------------------- |
| `pnpm install`                   | Install JS dependencies                        |
| `pnpm dev`                       | Run the Vite frontend only                     |
| `pnpm tauri dev`                 | Run the full native app in dev mode           |
| `pnpm tauri build`               | Build a native installer for the host OS       |
| `pnpm --filter marketing dev`    | Run the marketing site                        |
| `pnpm --filter marketing build`  | Build the marketing site                       |

---

## 🔒 Privacy

Transcriptor is private by design.

- No accounts, no telemetry, no sync.
- No `.env` files or secrets to configure.
- Transcription happens entirely on your device.
- The only outbound network request is a model download **you** trigger from HuggingFace.

---

## 🧭 Roadmap scope (v1)

Built for v1: accurate offline transcription, library/search, multi-format export, per-segment re-run, custom models, native packaging.

**Out of scope for v1:** cloud/accounts/sync, bundled model weights, speaker diarization, real-time mic transcription, a full media player, mobile, and custom auto-update beyond Tauri's built-in.

---

## 📜 License

See the project's license file for details. Whisper models are subject to their own licenses (MIT for Whisper weights).