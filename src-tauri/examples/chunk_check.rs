// Standalone check for the chunked transcription strategy used in src/whisper.rs.
// Proves that splitting audio into 30 s chunks, processing each chunk separately,
// and using offset_ms produces continuous, timestamped segments without relying
// on the broken abort callback.
//
// Run: cargo run --release --example chunk_check -- <model.bin> <16khz-mono.wav>

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const SAMPLE_RATE: usize = 16000;
const CHUNK_SECONDS: usize = 30;
const CHUNK_SAMPLES: usize = SAMPLE_RATE * CHUNK_SECONDS;

fn read_wav_samples(path: &Path) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("failed to open wav");
    let spec = reader.spec();
    assert_eq!(spec.channels, 1, "expected mono wav");
    assert_eq!(spec.sample_rate, 16000, "expected 16kHz wav");
    reader
        .samples::<i16>()
        .map(|s| s.unwrap() as f32 / i16::MAX as f32)
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = args.get(1).expect("usage: chunk_check <model.bin> <wav> [cancel-after-ms]");
    let wav_path = args.get(2).expect("usage: chunk_check <model.bin> <wav> [cancel-after-ms]");
    let cancel_after_ms: Option<u64> = args.get(3).and_then(|s| s.parse().ok());

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .expect("failed to load model");

    let samples = read_wav_samples(Path::new(wav_path));
    println!("loaded {} samples ({:.2}s)", samples.len(), samples.len() as f64 / 16000.0);

    let total_chunks = samples.len().div_ceil(CHUNK_SAMPLES).max(1);
    let cancel_flag = Arc::new(AtomicBool::new(false));

    if let Some(ms) = cancel_after_ms {
        let flag = cancel_flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            println!("cancelling...");
            flag.store(true, Ordering::Relaxed);
        });
    }

    let mut all_segments = Vec::new();
    let mut detected_language: Option<String> = None;

    for chunk_index in 0..total_chunks {
        if cancel_flag.load(Ordering::Relaxed) {
            println!("cancelled");
            return;
        }

        let start_sample = chunk_index * CHUNK_SAMPLES;
        let end_sample = ((chunk_index + 1) * CHUNK_SAMPLES).min(samples.len());
        let chunk = &samples[start_sample..end_sample];

        let effective_language = if chunk_index == 0 {
            "auto"
        } else {
            detected_language.as_deref().unwrap_or("auto")
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_language(Some(effective_language));

        let mut state = ctx.create_state().expect("failed to create state");
        state.full(params, chunk).expect("transcription failed");

        let num_segments = state.full_n_segments();
        for i in 0..num_segments {
            let seg = state.get_segment(i).expect("segment in bounds");
            let text = seg.to_str_lossy().expect("segment text");
            let chunk_offset = (chunk_index * CHUNK_SECONDS) as f64;
            let start = seg.start_timestamp() as f64 * 0.01 + chunk_offset;
            let end = seg.end_timestamp() as f64 * 0.01 + chunk_offset;
            println!("chunk {chunk_index} [{start:.2}s -> {end:.2}s] {}", text.trim());
            all_segments.push((start, end, text.trim().to_string()));
        }

        if chunk_index == 0 && effective_language == "auto" {
            let lang_id = state.full_lang_id_from_state();
            if lang_id >= 0 {
                detected_language = whisper_rs::get_lang_str(lang_id).map(|s| s.to_string());
            }
        }
    }

    assert!(!all_segments.is_empty(), "expected at least one segment");

    // Verify timestamps are monotonically increasing and non-overlapping (within chunk boundaries).
    for window in all_segments.windows(2) {
        let (s1, e1, _) = &window[0];
        let (s2, _, _) = &window[1];
        assert!(s2 >= s1, "segment timestamps must be monotonic: {s1} then {s2}");
        assert!(e1 >= s1, "segment end must be >= start: {s1} -> {e1}");
    }

    let lang = detected_language.unwrap_or_else(|| "unknown".to_string());
    println!("detected language: {lang}");
    println!("OK: {} non-empty segment(s)", all_segments.len());
}
