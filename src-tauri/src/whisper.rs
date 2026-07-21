// whisper-rs wrapper: load model, stream segments via events.
//
// whisper.cpp's abort callback is broken in whisper-rs 0.14/0.16: merely
// registering it causes whisper_full_with_state to return -6 on every run,
// even when the abort flag is never set. We therefore split audio into 30 s
// chunks and check the cancel flag between chunks instead of relying on the
// callback.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const SAMPLE_RATE: usize = 16000;
const CHUNK_SECONDS: usize = 30;
const CHUNK_SAMPLES: usize = SAMPLE_RATE * CHUNK_SECONDS; // 480000

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub struct TranscribeResult {
    pub segments: Vec<Segment>,
    pub detected_language: Option<String>,
    pub duration_secs: Option<f64>,
}

/// Number of waveform buckets emitted to the UI. Fixed cost regardless of file
/// length; the UI resamples it to however many bars it draws.
const PEAK_BUCKETS: usize = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioEvent {
    work_id: String,
    duration_secs: f64,
    peaks: Vec<f32>,
}

/// Peak amplitude per bucket, normalized to the loudest bucket, so quiet
/// recordings still draw a full-height wave.
fn peaks(samples: &[f32], buckets: usize) -> Vec<f32> {
    let buckets = buckets.min(samples.len());
    if buckets == 0 {
        return Vec::new();
    }
    let mut out: Vec<f32> = (0..buckets)
        .map(|i| {
            let a = i * samples.len() / buckets;
            let b = ((i + 1) * samples.len() / buckets).max(a + 1);
            samples[a..b].iter().fold(0f32, |m, s| m.max(s.abs()))
        })
        .collect();
    let max = out.iter().copied().fold(0f32, f32::max);
    if max > 0.0 {
        for v in out.iter_mut() {
            *v /= max;
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    work_id: String,
    progress: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentEvent {
    work_id: String,
    segment: Segment,
}

/// Runs synchronously on whatever thread calls it — the caller (commands.rs)
/// is responsible for running this off the async runtime's worker threads.
pub fn transcribe<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    work_id: &str,
    model_path: &Path,
    wav_path: &Path,
    language: Option<&str>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<TranscribeResult, String> {
    let model_path_str = model_path
        .to_str()
        .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
    let ctx = WhisperContext::new_with_params(model_path_str, WhisperContextParameters::default())
        .map_err(|e| format!("failed to load model: {e}"))?;

    let samples = read_wav_samples(wav_path)?;
    if samples.is_empty() {
        return Ok(TranscribeResult { segments: Vec::new(), detected_language: None, duration_secs: Some(0.0) });
    }

    // The waveform lands before the first word does: the UI draws the real
    // audio shape as soon as the WAV is decoded, then fills text in over it.
    let duration_secs = samples.len() as f64 / SAMPLE_RATE as f64;
    let _ = app.emit(
        "transcribe-audio",
        AudioEvent {
            work_id: work_id.to_string(),
            duration_secs,
            peaks: peaks(&samples, PEAK_BUCKETS),
        },
    );

    let requested_language = language.unwrap_or("auto");
    let total_chunks = samples.len().div_ceil(CHUNK_SAMPLES).max(1);
    let mut all_segments: Vec<Segment> = Vec::new();
    let mut detected_language: Option<String> = None;

    emit_progress(app, work_id, 0);

    for chunk_index in 0..total_chunks {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }

        let start_sample = chunk_index * CHUNK_SAMPLES;
        let end_sample = ((chunk_index + 1) * CHUNK_SAMPLES).min(samples.len());
        let chunk = &samples[start_sample..end_sample];

        // Auto-detect language on the first chunk only; force the detected
        // language for the rest so the whole transcript is consistent.
        let effective_language = if chunk_index == 0 {
            requested_language
        } else {
            detected_language.as_deref().unwrap_or(requested_language)
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_language(Some(effective_language));

        let chunk_offset = (chunk_index * CHUNK_SECONDS) as f64;

        // Stream each segment as whisper decodes it. Collecting them after
        // `full()` returns means a whole 30 s chunk's worth of text appears at
        // once — and a file shorter than 30 s shows nothing until it's done.
        // The lossy variant is deliberate: a single bad UTF-8 byte should cost
        // one character on screen, not the live view. (The authoritative
        // segments are still read back from state below, so what's saved never
        // depends on this callback.)
        let app_seg = app.clone();
        let work_id_seg = work_id.to_string();
        params.set_segment_callback_safe_lossy(move |data: whisper_rs::SegmentCallbackData| {
            let _ = app_seg.emit(
                "transcribe-segment",
                SegmentEvent {
                    work_id: work_id_seg.clone(),
                    segment: Segment {
                        start: data.start_timestamp as f64 * 0.01 + chunk_offset,
                        end: data.end_timestamp as f64 * 0.01 + chunk_offset,
                        text: data.text.trim().to_string(),
                    },
                },
            );
        });

        // Progress within the chunk, folded into the overall percentage, so the
        // bar advances continuously instead of jumping one chunk at a time.
        let app_prog = app.clone();
        let work_id_prog = work_id.to_string();
        params.set_progress_callback_safe(move |p: i32| {
            let overall = (chunk_index as i32 * 100 + p.clamp(0, 100)) / total_chunks as i32;
            emit_progress(&app_prog, &work_id_prog, overall.clamp(0, 100));
        });

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("failed to create whisper state: {e}"))?;

        state
            .full(params, chunk)
            .map_err(|e| format!("transcription failed at chunk {}: {}", chunk_index + 1, e))?;

        let num_segments = state.full_n_segments();

        for i in 0..num_segments {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("segment {i} out of bounds"))?;
            let text = seg
                .to_str_lossy()
                .map_err(|e| format!("failed to read segment text: {e}"))?;
            let start = seg.start_timestamp() as f64 * 0.01 + chunk_offset;
            let end = seg.end_timestamp() as f64 * 0.01 + chunk_offset;
            all_segments.push(Segment { start, end, text: text.trim().to_string() });
        }

        if chunk_index == 0 && requested_language == "auto" {
            let lang_id = state.full_lang_id_from_state();
            if lang_id >= 0 {
                detected_language = whisper_rs::get_lang_str(lang_id).map(|s| s.to_string());
            }
        }

        let progress = (((chunk_index + 1) * 100) / total_chunks).min(100) as i32;
        emit_progress(app, work_id, progress);
    }

    Ok(TranscribeResult { segments: all_segments, detected_language, duration_secs: Some(duration_secs) })
}

/// Transcribes a range that has already been extracted to a WAV (e.g. by
/// `audio::extract_range_to_wav`). `time_offset` (seconds) is added to every
/// emitted segment's timestamps so they map back to the original file's
/// timeline. Otherwise identical to `transcribe`.
#[allow(clippy::too_many_arguments)]
pub fn transcribe_range<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    work_id: &str,
    model_path: &Path,
    wav_path: &Path,
    language: Option<&str>,
    cancel_flag: Arc<AtomicBool>,
    time_offset: f64,
    initial_prompt: Option<&str>,
) -> Result<TranscribeResult, String> {
    let model_path_str = model_path
        .to_str()
        .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
    let ctx = WhisperContext::new_with_params(model_path_str, WhisperContextParameters::default())
        .map_err(|e| format!("failed to load model: {e}"))?;

    let samples = read_wav_samples(wav_path)?;
    if samples.is_empty() {
        return Ok(TranscribeResult { segments: Vec::new(), detected_language: None, duration_secs: None });
    }

    let requested_language = language.unwrap_or("auto");
    let total_chunks = samples.len().div_ceil(CHUNK_SAMPLES).max(1);
    let mut all_segments: Vec<Segment> = Vec::new();
    let mut detected_language: Option<String> = None;

    emit_progress(app, work_id, 0);

    for chunk_index in 0..total_chunks {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }

        let start_sample = chunk_index * CHUNK_SAMPLES;
        let end_sample = ((chunk_index + 1) * CHUNK_SAMPLES).min(samples.len());
        let chunk = &samples[start_sample..end_sample];

        let effective_language = if chunk_index == 0 {
            requested_language
        } else {
            detected_language.as_deref().unwrap_or(requested_language)
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_language(Some(effective_language));

        // What was said just before this range, as text. A re-run cuts the
        // audio exactly on the segment boundary, so the model opens mid-
        // sentence with no idea what came before and mis-decodes the first
        // word ("When" heard as "In"). The prompt restores that context
        // without putting a neighbour's audio in the window, which would let
        // their words leak into this row.
        if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            params.set_initial_prompt(prompt);
        }

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("failed to create whisper state: {e}"))?;

        state
            .full(params, chunk)
            .map_err(|e| format!("transcription failed at chunk {}: {}", chunk_index + 1, e))?;

        let num_segments = state.full_n_segments();

        for i in 0..num_segments {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("segment {i} out of bounds"))?;
            let text = seg
                .to_str_lossy()
                .map_err(|e| format!("failed to read segment text: {e}"))?;
            let chunk_offset = (chunk_index * CHUNK_SECONDS) as f64;
            let start = seg.start_timestamp() as f64 * 0.01 + chunk_offset + time_offset;
            let end = seg.end_timestamp() as f64 * 0.01 + chunk_offset + time_offset;
            let segment = Segment { start, end, text: text.trim().to_string() };
            let _ = app.emit(
                "transcribe-segment",
                SegmentEvent { work_id: work_id.to_string(), segment: segment.clone() },
            );
            all_segments.push(segment);
        }

        if chunk_index == 0 && requested_language == "auto" {
            let lang_id = state.full_lang_id_from_state();
            if lang_id >= 0 {
                detected_language = whisper_rs::get_lang_str(lang_id).map(|s| s.to_string());
            }
        }

        let progress = (((chunk_index + 1) * 100) / total_chunks).min(100) as i32;
        emit_progress(app, work_id, progress);
    }

    Ok(TranscribeResult { segments: all_segments, detected_language, duration_secs: None })
}

fn emit_progress<R: tauri::Runtime>(app: &tauri::AppHandle<R>, work_id: &str, progress: i32) {
    let _ = app.emit(
        "transcribe-progress",
        ProgressEvent { work_id: work_id.to_string(), progress },
    );
}

fn read_wav_samples(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("failed to open wav {path:?}: {e}"))?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.sample_rate != 16000 {
        return Err(format!(
            "expected 16kHz mono wav, got {}Hz {}ch",
            spec.sample_rate, spec.channels
        ));
    }
    match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<Result<Vec<f32>, _>>()
            .map_err(|e| format!("failed to decode wav samples: {e}")),
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<f32>, _>>()
            .map_err(|e| format!("failed to decode wav samples: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The frontend filters every event on `payload.workId`. snake_case keys make
    // that undefined, so a casing regression silently kills the live transcript
    // and the progress bar with no error anywhere. Pin the wire contract.
    #[test]
    fn event_payloads_are_camel_case() {
        let seg = serde_json::to_string(&SegmentEvent {
            work_id: "w1".into(),
            segment: Segment { start: 0.0, end: 1.0, text: "hi".into() },
        })
        .unwrap();
        assert!(seg.contains("\"workId\""), "{seg}");
        assert!(!seg.contains("work_id"), "{seg}");

        let prog = serde_json::to_string(&ProgressEvent { work_id: "w1".into(), progress: 42 }).unwrap();
        assert!(prog.contains("\"workId\""), "{prog}");

        let audio =
            serde_json::to_string(&AudioEvent { work_id: "w1".into(), duration_secs: 2.0, peaks: vec![] })
                .unwrap();
        assert!(audio.contains("\"workId\"") && audio.contains("\"durationSecs\""), "{audio}");
    }

    #[test]
    fn peaks_bucket_and_normalize() {
        // Quiet first half, loud second half → normalized to 0.5 / 1.0.
        let mut s = vec![0.05f32; 100];
        s.extend(std::iter::repeat_n(-0.1f32, 100));
        let p = peaks(&s, 4);
        assert_eq!(p.len(), 4);
        assert!((p[0] - 0.5).abs() < 1e-6, "{p:?}");
        assert!((p[3] - 1.0).abs() < 1e-6, "{p:?}");

        // Degenerate inputs must not panic or divide by zero.
        assert!(peaks(&[], 400).is_empty());
        assert_eq!(peaks(&[0.0, 0.0], 400), vec![0.0, 0.0]);
    }
}
