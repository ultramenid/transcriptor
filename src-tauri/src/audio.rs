// ffmpeg sidecar: probe + extract audio track to 16kHz mono WAV (temp, deleted after).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

async fn has_audio_stream<R: tauri::Runtime>(app: &tauri::AppHandle<R>, input: &Path) -> Result<bool, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("ffprobe sidecar unavailable: {e}"))?
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(input.to_string_lossy().to_string())
        .output()
        .await
        .map_err(|e| format!("ffprobe failed to run: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

/// Extracts the default audio track of `input` into a fresh 16kHz mono WAV
/// under the OS temp dir. Caller owns the returned path and must delete it
/// when done — on success, on failure, and on cancel. `cancel_flag` is
/// polled every 150ms; when set, the ffmpeg child is killed and the partial
/// WAV removed so a cancelled 4-hour extraction doesn't hang the queue.
pub async fn extract_to_wav<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    input: &Path,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    if !has_audio_stream(app, input).await? {
        return Err("this file has no audio track".to_string());
    }

    let out_path = std::env::temp_dir().join(format!("transcriptor-{}.wav", uuid::Uuid::new_v4()));

    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar unavailable: {e}"))?
        .args(["-y", "-i"])
        .arg(input.to_string_lossy().to_string())
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "wav"])
        .arg(out_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("ffmpeg failed to start: {e}"))?;

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
                    None => break,
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(150)) => {
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = child.kill();
                    let _ = std::fs::remove_file(&out_path);
                    return Err("cancelled".to_string());
                }
            }
        }
    }

    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&out_path);
        return Err(format!(
            "ffmpeg exited with {exit_code:?}: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }

    Ok(out_path)
}
