// Headless check for per-segment re-run: transcribe a file, then re-run one
// segment with the same model and language and compare the text against what
// the full pass produced for that same time range. A correct re-run reproduces
// roughly the original words; a wrong one returns a different range's words, an
// empty string, or whisper's short-clip filler ("Thank you.", "you").
//
// Run: cargo run --release --example segment_rerun_check -- <model.bin> <16khz-mono.wav>

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

use transcriptor_lib::commands::QueueState;
use transcriptor_lib::library::Library;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = args.get(1).expect("usage: segment_rerun_check <model.bin> <wav>");
    let wav = PathBuf::from(args.get(2).expect("need a wav"));

    let app_data_dir =
        std::env::temp_dir().join(format!("transcriptor-segrerun-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&app_data_dir).expect("temp dir");
    let source = app_data_dir.join("source.wav");
    std::fs::copy(&wav, &source).expect("copy wav");

    let app = mock_builder()
        .plugin(tauri_plugin_shell::init())
        .build(mock_context(noop_assets()))
        .expect("mock app");

    // commands.rs resolves the models dir through Tauri's path API.
    let resolved_models = app.path().app_data_dir().expect("app data dir").join("models");
    std::fs::create_dir_all(&resolved_models).expect("models dir");
    std::fs::copy(model_path, resolved_models.join("ggml-tiny.bin")).expect("stage model");

    {
        let conn = transcriptor_lib::library::open(&app_data_dir).expect("open library");
        app.manage(Library(Mutex::new(conn)));
        app.manage(QueueState::default());
    }
    let handle = app.app_handle().clone();

    let ids = transcriptor_lib::commands::enqueue_files_for_test(
        handle.clone(),
        app.state::<Library>(),
        vec![source.to_string_lossy().to_string()],
        "tiny".to_string(),
        transcriptor_lib::models::Quant::Full,
        Some("auto".to_string()),
    )
    .expect("enqueue");
    let id = ids[0].clone();

    transcriptor_lib::commands::run_queue(&handle).await;

    let lib = app.state::<Library>();
    let original = {
        let conn = lib.0.lock().unwrap();
        transcriptor_lib::library::get(&conn, &id).unwrap().unwrap()
    };
    assert_eq!(original.status, "done", "first pass must finish: {:?}", original.error);
    println!("full pass: {} segments", original.segments.len());
    for (i, s) in original.segments.iter().enumerate() {
        println!("  [{i}] {:.2}–{:.2} ({:.2}s) {}", s.start, s.end, s.end - s.start, s.text);
    }

    // Re-run every segment and report the ones whose text changed materially.
    let mut mismatches = 0;
    for (idx, seg) in original.segments.iter().enumerate() {
        transcriptor_lib::commands::rerun_segment_impl(
            handle.clone(),
            app.state::<Library>(),
            id.clone(),
            "tiny".to_string(),
            transcriptor_lib::models::Quant::Full,
            original.language.clone(),
            seg.start,
            seg.end,
            idx as i64,
        )
        .await
        .expect("rerun_segment");

        // Let the status settle before reading back.
        tokio::time::sleep(Duration::from_millis(20)).await;
        let after = {
            let conn = lib.0.lock().unwrap();
            transcriptor_lib::library::get(&conn, &id).unwrap().unwrap()
        };
        let new_text = after.segments[idx].text.clone();
        let same = normalize(&new_text) == normalize(&seg.text);
        if !same {
            mismatches += 1;
        }
        println!(
            "  [{idx}] {:.2}–{:.2} ({:.2}s) {}\n        was: {}\n        now: {}",
            seg.start,
            seg.end,
            seg.end - seg.start,
            if same { "same" } else { "DIFFERENT" },
            seg.text,
            new_text
        );

        // Every other segment must be untouched by a single-segment re-run.
        for (j, other) in original.segments.iter().enumerate() {
            if j != idx {
                assert_eq!(
                    after.segments[j].text, other.text,
                    "re-running segment {idx} changed segment {j}"
                );
            }
        }

        // Restore so each re-run is measured against the original transcript.
        {
            let conn = lib.0.lock().unwrap();
            transcriptor_lib::library::update_transcript_edit(&conn, &id, &original.segments)
                .unwrap();
        }
    }

    println!("\n{mismatches}/{} segments came back different", original.segments.len());
}

fn normalize(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == ' ').collect()
}
