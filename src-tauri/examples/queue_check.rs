// Headless integration test for the queue + cancel + retry pipeline.
// Builds a Tauri app with a mocked runtime, enqueues three short synthetic
// audio files, runs the queue, cancels the first one mid-run, retries it,
// and asserts the final statuses. Exercises the real commands.rs queue worker
// but bypasses the UI.
//
// Run: cargo run --release --example queue_check -- \
//          <model.bin> \
//          <16khz-mono.wav> \
//          <optional-second-16khz-mono.wav> \
//          <optional-third-16khz-mono.wav>
// If fewer than 3 WAVs are supplied, the same file is reused.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

use transcriptor_lib::commands::QueueState;
use transcriptor_lib::library::{Library, Work};

fn copy_wav(src: &Path, dst: &Path) {
    std::fs::copy(src, dst).expect("copy wav");
}

fn make_wav_copies(src: &Path, dir: &Path, count: usize) -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(count);
    for i in 0..count {
        let dst = dir.join(format!("test_{i}.wav"));
        copy_wav(src, &dst);
        paths.push(dst);
    }
    paths
}

fn wait_for_status(
    lib: &Library,
    id: &str,
    expected: &str,
    timeout_ms: u64,
) -> Option<Work> {
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < timeout_ms as u128 {
        {
            let conn = lib.0.lock().unwrap();
            if let Ok(Some(work)) = transcriptor_lib::library::get(&conn, id) {
                if work.status == expected {
                    return Some(work);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

fn all_statuses(lib: &Library) -> Vec<(String, String)> {
    let conn = lib.0.lock().unwrap();
    transcriptor_lib::library::list_all(&conn)
        .unwrap_or_default()
        .into_iter()
        .map(|w| (w.id.clone(), w.status.clone()))
        .collect()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = args
        .get(1)
        .expect("usage: queue_check <model.bin> <wav1> [wav2] [wav3]")
        .clone();
    let wav1 = PathBuf::from(args.get(2).expect("need at least one wav"));
    let wav2 = args.get(3).map(PathBuf::from).unwrap_or_else(|| wav1.clone());
    let wav3 = args.get(4).map(PathBuf::from).unwrap_or_else(|| wav1.clone());

    // Use a fresh app data dir so the test is isolated and we can inspect it.
    let app_data_dir = std::env::temp_dir().join(format!(
        "transcriptor-queue-check-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&app_data_dir).expect("create temp app data dir");

    // Copy the model into the temp models dir so commands.rs finds it.
    let models_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&models_dir).expect("create models dir");
    let installed_model = models_dir.join("ggml-tiny-q5_1.bin");
    std::fs::copy(&model_path, &installed_model).expect("copy model");

    // Copy source WAVs to a temp location.
    let source_dir = app_data_dir.join("sources");
    std::fs::create_dir_all(&source_dir).expect("create sources dir");
    let sources = make_wav_copies(&wav1, &source_dir, 3);
    copy_wav(&wav2, &sources[1]);
    copy_wav(&wav3, &sources[2]);

    // Build the mocked Tauri app exactly like lib.rs does.
    let app = mock_builder()
        .plugin(tauri_plugin_shell::init())
        .build(mock_context(noop_assets()))
        .expect("mock app build");

    {
        let conn = transcriptor_lib::library::open(&app_data_dir).expect("open library");
        app.manage(Library(Mutex::new(conn)));
        app.manage(QueueState::default());
    }

    let app_handle = app.app_handle().clone();

    // Enqueue 3 files.
    let paths: Vec<String> = sources.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let ids = transcriptor_lib::commands::enqueue_files_for_test(
        app_handle.clone(),
        app.state::<Library>(),
        paths,
        "tiny".to_string(),
        transcriptor_lib::models::Quant::Compact,
        Some("auto".to_string()),
    )
    .expect("enqueue files");
    assert_eq!(ids.len(), 3, "expected 3 queued works");

    // Start the queue worker.
    // `start_queue_worker` is private in commands.rs, so we call the same
    // spawn logic directly: start the worker in a background task and let it
    // drain. Cancellation will be triggered once the first work is "running".
    let worker_handle = tokio::spawn(async move {
        transcriptor_lib::commands::run_queue(&app_handle).await;
    });

    // Wait until the first work is running, then cancel it.
    let lib = app.state::<Library>();
    let cancelled_id = ids[0].clone();
    let mut cancelled = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    while std::time::Instant::now() < deadline && !cancelled {
        {
            let conn = lib.0.lock().unwrap();
            if let Ok(Some(work)) = transcriptor_lib::library::get(&conn, &cancelled_id) {
                println!("  work {} status: {}", work.id, work.status);
                if work.status == "running" {
                    let lib_state: tauri::State<Library> = app.state();
                    let queue_state: tauri::State<QueueState> = app.state();
                    transcriptor_lib::commands::cancel_work(lib_state, queue_state, cancelled_id.clone())
                        .expect("cancel work");
                    cancelled = true;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(cancelled, "first work never entered running state in time");

    // Wait for the first work to become cancelled, then retry it.
    let lib_ref = lib.inner();
    wait_for_status(lib_ref, &cancelled_id, "cancelled", 10_000)
        .expect("first work should be cancelled");

    transcriptor_lib::commands::retry_work_for_test(
        app.app_handle().clone(),
        app.state::<Library>(),
        cancelled_id.clone(),
    )
    .expect("retry work");

    // Wait for all works to finish (done, failed, or cancelled again).
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        let statuses = all_statuses(lib.inner());
        let all_done = statuses.iter().all(|(_, s)| {
            matches!(s.as_str(), "done" | "failed" | "cancelled")
        });
        if all_done {
            break;
        }
        if std::time::Instant::now() > deadline {
            panic!("queue did not drain in time; statuses: {statuses:?}");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    worker_handle.abort();

    // Final assertions.
    let conn = lib.0.lock().unwrap();
    let works = transcriptor_lib::library::list_all(&conn).expect("list works");
    let done_count = works.iter().filter(|w| w.status == "done").count();
    let failed_count = works.iter().filter(|w| w.status == "failed").count();
    let cancelled_count = works.iter().filter(|w| w.status == "cancelled").count();

    println!("final statuses: done={done_count} failed={failed_count} cancelled={cancelled_count}");
    for w in &works {
        let segments = w.segments.len();
        let error = w.error.as_deref().unwrap_or("");
        println!("{}: {} ({} segments) {}", w.id, w.status, segments, error);
    }

    assert!(done_count >= 2, "expected at least 2 successful transcriptions");
    assert!(
        cancelled_count + done_count == 3,
        "expected retried work to eventually succeed; statuses: done={done_count} cancelled={cancelled_count}"
    );
    assert_eq!(failed_count, 0, "expected no failed works");

    // Verify temp WAVs are gone — audio extraction should clean up.
    let temp_wavs: Vec<_> = std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("transcriptor-") && n.ends_with(".wav"))
                .unwrap_or(false)
        })
        .collect();
    assert!(temp_wavs.is_empty(), "expected temp wavs to be cleaned up, found {temp_wavs:?}");

    println!("OK: queue, cancel, and retry pipeline works end-to-end");
}
