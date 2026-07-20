// Isolates whether set_abort_callback_safe alone breaks a known-good transcription.
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn read_wav_samples(path: &Path) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("open wav");
    reader.samples::<i16>().map(|s| s.unwrap() as f32 / i16::MAX as f32).collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = &args[1];
    let wav_path = &args[2];
    let use_abort = args.get(3).map(|s| s == "abort").unwrap_or(false);
    let use_progress = args.get(3).map(|s| s == "progress").unwrap_or(false)
        || args.get(4).map(|s| s == "progress").unwrap_or(false);

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default()).unwrap();
    let mut state = ctx.create_state().unwrap();
    let samples = read_wav_samples(Path::new(wav_path));

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_language(Some("auto"));

    if use_abort {
        println!("setting abort_callback");
        let flag = Arc::new(AtomicBool::new(false));
        params.set_abort_callback_safe(move || flag.load(Ordering::Relaxed));
    }
    if use_progress {
        println!("setting progress_callback");
        params.set_progress_callback_safe(move |p| { let _ = p; });
    }

    match state.full(params, &samples) {
        Ok(_) => {
            let n = state.full_n_segments();
            println!("OK: {n} segments");
        }
        Err(e) => println!("FAILED: {e}"),
    }
}
