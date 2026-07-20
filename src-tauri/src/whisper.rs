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
}

#[derive(Debug, Clone, Serialize)]
struct ProgressEvent {
    work_id: String,
    progress: i32,
}

#[derive(Debug, Clone, Serialize)]
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
        return Ok(TranscribeResult { segments: Vec::new(), detected_language: None });
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
            let start = seg.start_timestamp() as f64 * 0.01 + chunk_offset;
            let end = seg.end_timestamp() as f64 * 0.01 + chunk_offset;
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

    Ok(TranscribeResult { segments: all_segments, detected_language })
}

/// Transcribes a range that has already been extracted to a WAV (e.g. by
/// `audio::extract_range_to_wav`). `time_offset` (seconds) is added to every
/// emitted segment's timestamps so they map back to the original file's
/// timeline. Otherwise identical to `transcribe`.
pub fn transcribe_range<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    work_id: &str,
    model_path: &Path,
    wav_path: &Path,
    language: Option<&str>,
    cancel_flag: Arc<AtomicBool>,
    time_offset: f64,
) -> Result<TranscribeResult, String> {
    let model_path_str = model_path
        .to_str()
        .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
    let ctx = WhisperContext::new_with_params(model_path_str, WhisperContextParameters::default())
        .map_err(|e| format!("failed to load model: {e}"))?;

    let samples = read_wav_samples(wav_path)?;
    if samples.is_empty() {
        return Ok(TranscribeResult { segments: Vec::new(), detected_language: None });
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

    Ok(TranscribeResult { segments: all_segments, detected_language })
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
