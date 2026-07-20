# Acceptance test status (T1–T20, per PROMPT.md)

## Demonstrated in this environment (macOS, no display access, single machine)

- **T2, T3, T6, T11** — real engine test: generated speech → ffmpeg extracted
  16 kHz mono audio (from both audio and video containers) → whisper-rs (Metal)
  auto-detected language and produced accurate, timestamped segments.
- **T3, T18** — synthetic video with a known duration: audio-track probe
  correctly detects/rejects tracks (silent video → clean error, not a crash);
  exported SRT is well-formed, monotonic, and timestamps align to the video
  timeline (start of extracted audio = start of video, by construction).
- **T4 (cancellation path)** — chunked transcription checks the cancel flag
  between 30 s chunks; cancelling mid-run stops cleanly and does not hang
  inside `whisper_full_with_state`. A literal 4-hour wall-clock run is still
  environment-gated (see below).
- **T5, T19** — model catalog sizes/sha256 pulled live from HuggingFace's API
  and verified against actual downloaded bytes.
- **T7** — unit tests for TXT / SRT / VTT / JSON / Article export rendering pass
  (`cargo test --lib`): timecodes are well-formed, SRT indices and timing are
  correct, VTT has the required header, Article reflows on >2s pauses.
- **T10, T15–T17** — SQLite persistence layer unit tests pass: create work,
  update status, save transcript, edit segments, delete, and FTS5 search all
  behave correctly; timestamps now use millisecond precision so rapid inserts
  stay ordered.
- **T9** — offline-only network use confirmed by inspection: `reqwest` is
  imported only in `models.rs`, nowhere in the transcribe path.
- **T13** — marketing site build inspected directly: both settled FAQ answers
  present verbatim in the built HTML, video asset present in `dist/`; only two
  small inline theme scripts (flash-prevention + toggle), no external JS
  bundles — effectively near-zero runtime JS.
- **T14 (macOS only)** — `pnpm tauri build` produces a real `Transcriptor.app`
  and `.dmg` with the ffmpeg/ffprobe sidecars correctly bundled inside.
- Rust backend (`cargo build`) and frontend (`tsc`, `vite build`) both compile
  clean with no errors or warnings.

## Critical production bug found and worked around

- `whisper-rs` 0.14 and 0.16 break every transcription when `set_abort_callback_safe`
  is registered: `state.full()` returns error code `-6` (`failed to encode`) even
  when the abort flag is never set to `true`.
- Confirmed with `examples/abort_isolate.rs`:
  - baseline (no callbacks) → OK
  - progress callback only → OK
  - abort callback only → FAILED -6
  - abort + progress callbacks → FAILED -6
- **Fix:** replaced the abort callback with Rust-level chunking. Audio is split
  into 30 s chunks; each chunk is fed to a fresh whisper state; the cancel flag
  is checked between chunks. `set_abort_callback_safe` is no longer used.
- Verified with `examples/chunk_check.rs` on 5 s and 65 s audio: timestamps are
  monotonic and correctly offset by chunk start time; cancellation stops the run
  cleanly.

## Requires you, or CI on real hardware — not closeable from here

- **T1** — visually confirm the window: run `pnpm tauri dev` (or open the
  built `.app`) yourself and eyeball the home screen. I opened the built
  `.app` and confirmed the process launches and stays alive with no crash,
  but couldn't screenshot it — `screencapture`/Accessibility both failed with
  a macOS TCC permission error (Screen Recording / Accessibility not granted
  to this shell). Grant that permission if you want me to capture screenshots
  in a future session, or just look yourself.
- **T4 (full 4-hour run)** — a real multi-hour file, watched for freezing/OOM/
  deadlock, plus a real mid-run cancel. The cancellation wiring is now verified
  by example; the long wall-clock run itself needs a real file and time.
- **T8 (full queue)** — multi-file queue logic is in place, but a live 5-file
  drag/drop + cancel + retry run needs the UI or an integration harness.
- **T10, T15–T17** — persistence and search are implemented, but surviving a
  real quit/relaunch cycle and FTS5 search need the UI or a DB-level test run.
- **T11 (Windows/Linux GPU), T12 (Windows/Linux native chrome)** — need those
  OSes. `.github/workflows/build.yml` is written (builds + bundles on all
  three OSes) but not pushed — no git remote exists yet.
- **T14 (Windows .msi/.exe, Linux .AppImage/.deb)** — same CI workflow closes
  this once pushed.
- **T18 (real player)** — open an exported SRT alongside the source video in
  VLC/any player and confirm subtitles land in sync.

## To close the remaining gaps

1. Say the word and I'll set up a git remote + push, so `.github/workflows/build.yml`
   actually runs and produces Windows/Linux installers.
2. Grant Screen Recording/Accessibility to this shell if you want automated
   screenshots, or just run the app yourself for T1.
3. Drop a long (multi-hour) file through the app once for T4.
4. Play an exported SRT against its source video for T18.
5. Run a 5-file queue + cancel + retry through the UI for T8.
