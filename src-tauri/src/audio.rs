// ffmpeg audio extraction: bundled sidecar preferred, PATH fallback.
//
// ffmpeg/ffprobe are bundled as Tauri sidecars (tauri.conf.json externalBin
// + src-tauri/binaries, fetched per-platform in CI from eugeneware/ffmpeg-static
// so users don't need to install ffmpeg themselves). If the sidecar is ever
// missing (e.g. a dev running without the binaries staged), we fall back to
// running `ffmpeg`/`ffprobe` on PATH. Both paths produce the same 16kHz mono
// WAV and honor the same cancel flag.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Probes whether `input` has an audio stream. Tries the bundled ffprobe
/// sidecar first; falls back to `ffprobe` on PATH.
async fn has_audio_stream<R: tauri::Runtime>(app: &tauri::AppHandle<R>, input: &Path) -> Result<bool, String> {
    // Sidecar path: select audio streams, output the index list.
    let args = [
        "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0",
    ];
    let input_str = input.to_string_lossy().to_string();

    let (success, code, stdout, stderr) = match app.shell().sidecar("ffprobe") {
        Ok(cmd) => {
            let out = cmd
                .args(args)
                .arg(input_str)
                .output()
                .await
                .map_err(|e| format!("ffprobe failed to run: {e}"))?;
            (out.status.success(), out.status.code(), out.stdout, out.stderr)
        }
        Err(_) => {
            let mut cmd = tokio::process::Command::new("ffprobe");
            cmd.args(args).arg(input).stdout(Stdio::piped()).stderr(Stdio::piped());
            let out = cmd
                .output()
                .await
                .map_err(|e| format!("ffprobe not found on PATH and no sidecar bundled: {e}"))?;
            (out.status.success(), out.status.code(), out.stdout, out.stderr)
        }
    };

    if !success {
        return Err(format!(
            "ffprobe exited with {code:?}: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok(!String::from_utf8_lossy(&stdout).trim().is_empty())
}

/// A spawned ffmpeg that can be killed on cancel. The sidecar and PATH paths
/// each produce a receiver to poll plus a killable handle.
enum FfmpegKill {
    Sidecar(tauri_plugin_shell::process::CommandChild),
    Path(tokio::process::Child),
}

impl FfmpegKill {
    fn kill(self) {
        match self {
            FfmpegKill::Sidecar(child) => {
                let _ = child.kill();
            }
            FfmpegKill::Path(mut child) => {
                let _ = child.start_kill();
            }
        }
    }
}

/// Spawns ffmpeg with the given args (the output path already appended by the
/// caller), preferring the sidecar and falling back to PATH. Returns the kill
/// handle and an event receiver to poll for stderr + termination.
fn spawn_ffmpeg<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<(FfmpegKill, tokio::sync::mpsc::Receiver<CommandEvent>), String> {
    match app.shell().sidecar("ffmpeg") {
        Ok(cmd) => {
            let (rx, child) = cmd
                .args(args)
                .spawn()
                .map_err(|e| format!("ffmpeg failed to start: {e}"))?;
            Ok((FfmpegKill::Sidecar(child), rx))
        }
        Err(_) => {
            let mut cmd = tokio::process::Command::new("ffmpeg");
            cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd
                .spawn()
                .map_err(|e| format!("ffmpeg not found on PATH and no sidecar bundled: {e}"))?;

            let (tx, rx) = tokio::sync::mpsc::channel::<CommandEvent>(64);

            // Forward stderr bytes to the channel. When stderr ends, the
            // sender is dropped; the drain loop's `None` case then waits on
            // the child to collect the real exit code.
            if let Some(stderr) = child.stderr.take() {
                let tx = tx.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncReadExt;
                    let mut buf = vec![0u8; 4096];
                    let mut stderr = stderr;
                    loop {
                        match stderr.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if tx.send(CommandEvent::Stderr(buf[..n].to_vec())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }

            Ok((FfmpegKill::Path(child), rx))
        }
    }
}

/// Polls the ffmpeg event stream until it terminates, collecting stderr.
/// Honors the cancel flag: kills the child and removes the output file.
async fn drain_ffmpeg(
    mut kill: FfmpegKill,
    mut rx: tokio::sync::mpsc::Receiver<CommandEvent>,
    out_path: &Path,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(Vec<u8>, Option<i32>), String> {
    let mut stderr = Vec::new();
    let mut exit_code: Option<i32> = None;
    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Some(CommandEvent::Stderr(bytes)) => stderr.extend(bytes),
                    Some(CommandEvent::Terminated(payload)) => {
                        exit_code = payload.code;
                        break;
                    }
                    Some(_) => {}
                    // Channel closed: for the PATH path this means stderr
                    // ended. Wait on the child to get the real exit code.
                    None => {
                        if let FfmpegKill::Path(child) = &mut kill {
                            if let Ok(status) = child.wait().await {
                                exit_code = status.code();
                            }
                        }
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(150)) => {
                if cancel_flag.load(Ordering::Relaxed) {
                    kill.kill();
                    let _ = std::fs::remove_file(out_path);
                    return Err("cancelled".to_string());
                }
            }
        }
    }
    Ok((stderr, exit_code))
}

/// Extracts the default audio track of `input` into a fresh 16kHz mono WAV
/// under the OS temp dir. Caller owns the returned path and must delete it
/// when done — on success, on failure, and on cancel.
pub async fn extract_to_wav<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    input: &Path,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    if !has_audio_stream(app, input).await? {
        return Err("this file has no audio track".to_string());
    }

    let out_path = std::env::temp_dir().join(format!("transcriptor-{}.wav", uuid::Uuid::new_v4()));
    let out_str = out_path.to_string_lossy().to_string();
    let input_str = input.to_string_lossy().to_string();

    let args = vec![
        "-y".to_string(), "-i".to_string(), input_str,
        "-vn".to_string(), "-ac".to_string(), "1".to_string(),
        "-ar".to_string(), "16000".to_string(), "-f".to_string(), "wav".to_string(),
        out_str,
    ];

    let (kill, rx) = spawn_ffmpeg(app, args)?;
    let (stderr, exit_code) = drain_ffmpeg(kill, rx, &out_path, cancel_flag).await?;

    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&out_path);
        return Err(format!(
            "ffmpeg exited with {exit_code:?}: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok(out_path)
}

/// Same as `extract_to_wav` but only the window `[start, end]` (seconds) of the
/// source. Output seeking (`-ss`/`-to` after `-i`) is used so the cut lands on
/// accurate frame boundaries for most containers.
pub async fn extract_range_to_wav<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    input: &Path,
    start: f64,
    end: f64,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    if !has_audio_stream(app, input).await? {
        return Err("this file has no audio track".to_string());
    }

    let out_path = std::env::temp_dir().join(format!("transcriptor-{}.wav", uuid::Uuid::new_v4()));
    let out_str = out_path.to_string_lossy().to_string();
    let input_str = input.to_string_lossy().to_string();

    let args = vec![
        "-y".to_string(), "-i".to_string(), input_str,
        "-ss".to_string(), format!("{start:.3}"),
        "-to".to_string(), format!("{end:.3}"),
        "-vn".to_string(), "-ac".to_string(), "1".to_string(),
        "-ar".to_string(), "16000".to_string(), "-f".to_string(), "wav".to_string(),
        out_str,
    ];

    let (kill, rx) = spawn_ffmpeg(app, args)?;
    let (stderr, exit_code) = drain_ffmpeg(kill, rx, &out_path, cancel_flag).await?;

    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&out_path);
        return Err(format!(
            "ffmpeg exited with {exit_code:?}: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok(out_path)
}