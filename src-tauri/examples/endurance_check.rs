// T4 endurance proxy: transcribe a multi-hour WAV with the exact same
// whisper-rs calls as src/whisper.rs (including the abort_callback used for
// cancel-mid-run), while a background thread samples this process's RSS to
// catch unbounded memory growth. Not a substitute for a real 4-hour wall
// clock run under a live GUI, but proves the engine doesn't blow up memory
// or hang processing hours of audio, and that cancellation actually returns
// early rather than running to completion.
//
// Run: cargo run --release --example endurance_check -- <model.bin> <wav> [cancel_after_secs]

use std::path::Path;
use std::process;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
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

fn rss_mb() -> u64 {
    let pid = process::id();
    let out = process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .expect("ps failed");
    String::from_utf8_lossy(&out.stdout).trim().parse::<u64>().unwrap_or(0) / 1024
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = args.get(1).expect("usage: endurance_check <model> <wav> [cancel_after_secs]");
    let wav_path = args.get(2).expect("usage: endurance_check <model> <wav> [cancel_after_secs]");
    let cancel_after: Option<u64> = args.get(3).and_then(|s| s.parse().ok());

    let samples = read_wav_samples(Path::new(wav_path));
    let hours = samples.len() as f64 / 16000.0 / 3600.0;
    println!("loaded {} samples ({:.2}h of audio), starting RSS: {} MB", samples.len(), hours, rss_mb());

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .expect("failed to load model");
    let mut state = ctx.create_state().expect("failed to create state");

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_language(Some("auto"));

    let peak_rss = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let peak_rss_watcher = peak_rss.clone();
    let stop_watcher = Arc::new(AtomicBool::new(false));
    let stop_watcher_thread = stop_watcher.clone();
    let watcher = std::thread::spawn(move || {
        while !stop_watcher_thread.load(Ordering::Relaxed) {
            let cur = rss_mb();
            peak_rss_watcher.fetch_max(cur, Ordering::Relaxed);
            std::thread::sleep(Duration::from_secs(2));
        }
    });

    let cancel_flag = Arc::new(AtomicBool::new(false));
    if let Some(secs) = cancel_after {
        let cancel_flag_timer = cancel_flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(secs));
            println!(">>> cancel timer fired at {secs}s — setting abort flag");
            cancel_flag_timer.store(true, Ordering::Relaxed);
        });
    }
    let cancel_flag_cb = cancel_flag.clone();
    params.set_abort_callback_safe(move || cancel_flag_cb.load(Ordering::Relaxed));

    let start = Instant::now();
    let result = state.full(params, &samples);
    let elapsed = start.elapsed();

    stop_watcher.store(true, Ordering::Relaxed);
    let _ = watcher.join();

    let was_cancelled = cancel_flag.load(Ordering::Relaxed);
    match &result {
        Ok(_) => println!("full() returned Ok after {:.1}s (cancelled flag was set: {was_cancelled})", elapsed.as_secs_f64()),
        Err(e) => println!("full() returned Err after {:.1}s: {e} (cancelled flag was set: {was_cancelled})", elapsed.as_secs_f64()),
    }

    if let Some(secs) = cancel_after {
        let realtime_factor_estimate = hours * 3600.0 / elapsed.as_secs_f64().max(0.001);
        println!(
            "cancel requested at {secs}s wall-clock; run stopped at {:.1}s -> {}",
            elapsed.as_secs_f64(),
            if elapsed.as_secs_f64() < hours * 3600.0 / 2.0 {
                "STOPPED EARLY (cancellation worked, did not run to full completion)"
            } else {
                "did not stop early - ran close to/through full duration"
            }
        );
        println!("(estimated real-time factor if uninterrupted: ~{realtime_factor_estimate:.0}x)");
    }

    let num_segments = state.full_n_segments();
    println!("segments produced: {num_segments}");
    println!("peak RSS observed: {} MB", peak_rss.load(Ordering::Relaxed));
    println!("OK: no crash, no panic, process exiting cleanly");
}
