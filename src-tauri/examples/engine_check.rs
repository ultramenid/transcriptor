// Standalone check for the whisper-rs binding, independent of Tauri/AppHandle.
// Run: cargo run --example engine_check -- <model.bin> <16khz-mono.wav>
//
// Exercises the exact same whisper-rs calls as src/whisper.rs (context load,
// state, FullParams, full(), segment readout, language detection) to prove
// the engine produces real, non-empty, timestamped segments before any of
// that logic is wrapped in Tauri commands/events.

use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

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
    let model_path = args.get(1).expect("usage: engine_check <model.bin> <wav>");
    let wav_path = args.get(2).expect("usage: engine_check <model.bin> <wav>");

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .expect("failed to load model");
    let mut state = ctx.create_state().expect("failed to create state");

    let samples = read_wav_samples(Path::new(wav_path));
    println!("loaded {} samples ({:.2}s)", samples.len(), samples.len() as f64 / 16000.0);

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_language(Some("auto"));

    state.full(params, &samples).expect("transcription failed");

    let num_segments = state.full_n_segments();
    assert!(num_segments > 0, "expected at least one segment — engine produced nothing");

    for i in 0..num_segments {
        let seg = state.get_segment(i).expect("segment in bounds");
        let text = seg.to_str_lossy().expect("segment text");
        let t0 = seg.start_timestamp() as f64 * 0.01;
        let t1 = seg.end_timestamp() as f64 * 0.01;
        println!("[{t0:.2}s -> {t1:.2}s] {}", text.trim());
        assert!(!text.trim().is_empty(), "segment {i} produced empty text");
    }

    let lang_id = state.full_lang_id_from_state();
    let lang = if lang_id >= 0 {
        whisper_rs::get_lang_str(lang_id).unwrap_or("unknown")
    } else {
        "unknown"
    };
    println!("detected language: {lang}");

    println!("OK: {num_segments} non-empty segment(s)");
}
