// Tauri commands: transcribe, cancel, export, models.

use crate::library::{Library, Work};
use crate::models::{self, Quant};
use crate::whisper::Segment;
use crate::{audio, config};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct QueueState {
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    processing: Mutex<bool>,
}

fn app_data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn lib_err(_: std::sync::PoisonError<std::sync::MutexGuard<'_, rusqlite::Connection>>) -> String {
    "library lock poisoned".to_string()
}

// ---- Models ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelVariantWire {
    quant: Quant,
    size_bytes: u64,
    installed: bool,
}

#[derive(Serialize)]
pub struct ModelEntryWire {
    id: String,
    label: String,
    speed: String,
    accuracy: String,
    languages: String,
    license: String,
    variants: Vec<ModelVariantWire>,
}

#[tauri::command]
pub fn list_models(app: AppHandle) -> Result<Vec<ModelEntryWire>, String> {
    let dir = app_data_dir(&app)?;
    Ok(models::all_models(&dir)
        .into_iter()
        .map(|m| ModelEntryWire {
            variants: m
                .variants
                .iter()
                .map(|v| ModelVariantWire {
                    quant: v.quant,
                    size_bytes: v.size_bytes,
                    installed: models::is_installed(&dir, v),
                })
                .collect(),
            id: m.id,
            label: m.label,
            speed: m.speed,
            accuracy: m.accuracy,
            languages: m.languages,
            license: m.license,
        })
        .collect())
}

#[tauri::command]
pub async fn download_model(app: AppHandle, model_id: String, quant: Quant) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    models::download_model(&app, &dir, &model_id, quant).await
}

#[tauri::command]
pub fn delete_model(app: AppHandle, model_id: String, quant: Quant) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    models::delete_model(&dir, &model_id, quant)
}

#[tauri::command]
pub fn add_custom_model(
    app: AppHandle,
    src_path: String,
    label: String,
    languages: String,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    models::add_custom(&dir, &src_path, &label, &languages)
}

// ---- Settings ----

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<config::Settings, String> {
    Ok(config::load(&app_data_dir(&app)?))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: config::Settings) -> Result<(), String> {
    config::save(&app_data_dir(&app)?, &settings)
}

// ---- Library ----

#[tauri::command]
pub fn list_recent(lib_state: State<'_, Library>, limit: i64) -> Result<Vec<Work>, String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::list_recent(&conn, limit)
}

#[tauri::command]
pub fn list_library(lib_state: State<'_, Library>) -> Result<Vec<Work>, String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::list_all(&conn)
}

#[tauri::command]
pub fn search_library(lib_state: State<'_, Library>, query: String) -> Result<Vec<Work>, String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::search(&conn, &query)
}

#[tauri::command]
pub fn get_work(lib_state: State<'_, Library>, id: String) -> Result<Option<Work>, String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::get(&conn, &id)
}

#[tauri::command]
pub fn delete_work(lib_state: State<'_, Library>, id: String) -> Result<(), String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::delete(&conn, &id)
}

#[tauri::command]
pub fn rename_work(app: AppHandle, lib_state: State<'_, Library>, id: String, name: String) -> Result<(), String> {
    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::rename(&conn, &id, &name)?;
    }
    let _ = app.emit("queue-updated", ());
    Ok(())
}

#[tauri::command]
pub fn update_transcript(
    lib_state: State<'_, Library>,
    id: String,
    segments: Vec<Segment>,
) -> Result<(), String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    crate::library::update_transcript_edit(&conn, &id, &segments)
}

// ---- Diagnostics ----

#[tauri::command]
pub fn read_log(app: AppHandle) -> Result<String, String> {
    crate::logs::read(&app_data_dir(&app)?)
}

#[tauri::command]
pub fn log_path(app: AppHandle) -> Result<String, String> {
    Ok(crate::logs::path(&app_data_dir(&app)?).to_string_lossy().to_string())
}

/// Opens the log's folder in Finder/Explorer with the file selected.
#[tauri::command]
pub fn reveal_log(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = crate::logs::path(&app_data_dir(&app)?);
    if !path.is_file() {
        return Err("no log file yet".to_string());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("could not open the log folder: {e}"))
}

/// Frontend crashes land here (see ErrorBoundary) — otherwise a render throw
/// leaves nothing behind once the window is closed.
#[tauri::command]
pub fn log_ui_error(message: String) {
    crate::logs::error(format!("ui: {message}"));
}

// ---- Queue / transcription ----

#[tauri::command]
pub fn enqueue_files(
    app: AppHandle,
    lib_state: State<'_, Library>,
    paths: Vec<String>,
    model_id: String,
    quant: Quant,
    language: Option<String>,
) -> Result<Vec<String>, String> {
    enqueue_files_for_test(app, lib_state, paths, model_id, quant, language)
}

pub fn enqueue_files_for_test<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    lib_state: State<'_, Library>,
    paths: Vec<String>,
    model_id: String,
    quant: Quant,
    language: Option<String>,
) -> Result<Vec<String>, String> {
    let quant_str = serde_json::to_value(quant)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let mut ids = Vec::with_capacity(paths.len());
    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        for path in &paths {
            let filename = std::path::Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let id = crate::library::create_queued(
                &conn,
                &filename,
                Some(path),
                Some(&model_id),
                Some(&quant_str),
                language.as_deref(),
            )?;
            ids.push(id);
        }
    }
    crate::logs::info(format!("queued {} file(s) with model {model_id}", ids.len()));
    let _ = app.emit("queue-updated", ());
    start_queue_worker(app);
    Ok(ids)
}

pub fn retry_work_for_test<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    lib_state: State<'_, Library>,
    id: String,
) -> Result<(), String> {
    retry_work_impl(app, lib_state, id)
}

#[tauri::command]
pub fn retry_work(app: AppHandle, lib_state: State<'_, Library>, id: String) -> Result<(), String> {
    retry_work_impl(app, lib_state, id)
}

fn retry_work_impl<R: tauri::Runtime>(app: tauri::AppHandle<R>, lib_state: State<'_, Library>, id: String) -> Result<(), String> {
    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::requeue(&conn, &id)?;
    }
    let _ = app.emit("queue-updated", ());
    start_queue_worker(app);
    Ok(())
}

#[tauri::command]
pub fn rerun_work(
    app: AppHandle,
    lib_state: State<'_, Library>,
    id: String,
    model_id: String,
    quant: Quant,
    language: Option<String>,
) -> Result<(), String> {
    let quant_str = serde_json::to_value(quant)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    // "auto" means detect — store as NULL so the worker treats it as auto.
    let lang = language.and_then(|l| if l == "auto" { None } else { Some(l) });
    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::requeue_with(&conn, &id, &model_id, &quant_str, lang.as_deref())?;
    }
    let _ = app.emit("queue-updated", ());
    start_queue_worker(app);
    Ok(())
}

/// Re-transcribe a single segment's `[start, end]` window with a different
/// model and replace that segment in place. Runs synchronously on the caller's
/// thread (a single segment is usually <30s); emits the same segment/progress
/// events as a full run so the UI can show live progress.
/// Padding around a re-run range, in seconds. Enough for a clipped syllable,
/// not enough for a neighbouring word — see the comment in `rerun_segment_impl`.
const RERUN_PAD_SECS: f64 = 0.4;

fn join_text<'a>(segments: impl Iterator<Item = &'a Segment>) -> String {
    segments
        .map(|s| s.text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub async fn rerun_segment(
    app: AppHandle,
    lib_state: State<'_, Library>,
    id: String,
    model_id: String,
    quant: Quant,
    language: Option<String>,
    start: f64,
    end: f64,
    index: i64,
) -> Result<(), String> {
    rerun_segment_impl(app, lib_state, id, model_id, quant, language, start, end, index).await
}

/// Generic over the runtime so the headless examples (which use Tauri's mock
/// runtime) can drive the same code the command does.
#[allow(clippy::too_many_arguments)]
pub async fn rerun_segment_impl<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    lib_state: State<'_, Library>,
    id: String,
    model_id: String,
    quant: Quant,
    language: Option<String>,
    start: f64,
    end: f64,
    index: i64,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let cancel_flag = Arc::new(AtomicBool::new(false));

    // Load the work up front so we hold the DB lock as briefly as possible.
    let work = {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::get(&conn, &id)?.ok_or("work not found")?
    };
    let source_path = work.source_path.clone().ok_or("work has no source path")?;

    let variant = models::find_variant_any(&dir, &model_id, quant).ok_or("unknown model/quant")?;
    let model_path = models::installed_path(&dir, &variant);
    if !model_path.is_file() {
        return Err(format!("model \"{model_id}\" is not downloaded yet"));
    }

    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::set_status(&conn, &id, "running", None)?;
    }
    let _ = app.emit("queue-updated", ());

    // Asymmetric on purpose, all three variants measured against a full pass:
    //   * exact cut both ends  → clips the first word's onset, "When" → "In"
    //   * 0.4 s on both ends   → every onset correct, but every row picks up a
    //                            fragment of the next one ("...and come back
    //                            to a field.")
    //   * 0.4 s lead-in only   → onsets correct, no trailing fragment
    // whisper's segment boundaries simply run late: the row's own start sits
    // just after its first syllable, while its end already covers the last
    // word. So pad the front and cut the tail exactly.
    let input = std::path::Path::new(&source_path);
    let ctx_start = (start - RERUN_PAD_SECS).max(0.0);
    let ctx_end = end;
    let wav_path =
        audio::extract_range_to_wav(&app, input, ctx_start, ctx_end, cancel_flag.clone()).await?;

    // The preceding row's text, so the model knows what sentence it is in the
    // middle of. Deliberately NOT this row's own text — priming it with the
    // text we are trying to correct just makes it repeat it.
    let prompt = work
        .segments
        .get((index as usize).wrapping_sub(1))
        .map(|s| s.text.clone())
        .unwrap_or_default();

    // Prefer the language chosen in the dialog; fall back to the work's stored
    // language (e.g. a previously detected one). "auto"/None → detect.
    let lang_arg = language
        .and_then(|l| if l == "auto" { None } else { Some(l) })
        .or_else(|| work.language.clone().filter(|l| l != "auto"));
    let app_for_blocking = app.clone();
    let work_id = id.clone();
    let model_path_for_blocking = model_path.clone();
    let wav_path_for_blocking = wav_path.clone();
    let transcribe_result = tokio::task::spawn_blocking(move || {
        crate::whisper::transcribe_range(
            &app_for_blocking,
            &work_id,
            &model_path_for_blocking,
            &wav_path_for_blocking,
            lang_arg.as_deref(),
            cancel_flag,
            ctx_start,
            Some(prompt.as_str()).filter(|p| !p.is_empty()),
        )
    })
    .await
    .map_err(|e| format!("transcription task panicked: {e}"))?;

    let _ = std::fs::remove_file(&wav_path);

    let new_segments = transcribe_result?.segments;

    // A segment re-run only rewrites that one segment's text — its timestamps
    // and index stay put. The model may return several sub-segments for the
    // padded window; keep the ones that actually live in the original range
    // (majority of their duration inside it) and join those, so the context
    // padding lends accuracy without leaking the neighbours' words in.
    let joined_text = join_text(new_segments.iter());

    // Never replace real content with nothing: if the re-run produced no text
    // at all, leave the row as it was and say so.
    if joined_text.is_empty() {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::set_status(&conn, &id, "done", None)?;
        let _ = app.emit("queue-updated", ());
        return Err("re-run produced no text for this segment; kept the original".to_string());
    }

    {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        // NOTE: status is "running" here — we set it ourselves above. Load the
        // segments unconditionally; gating on status == "done" would yield an
        // empty transcript and wipe the work.
        let existing = crate::library::get(&conn, &id)?.map(|w| w.segments).unwrap_or_default();
        let mut merged = existing.clone();
        let idx = index as usize;
        if let Some(seg) = merged.get_mut(idx) {
            seg.text = joined_text;
        }
        crate::library::update_transcript_edit(&conn, &id, &merged)?;
        crate::library::set_status(&conn, &id, "done", None)?;
        crate::logs::info(format!(
            "re-ran segment {index} ({start:.2}–{end:.2}s) of \"{}\"",
            work.source_filename
        ));
    }
    let _ = app.emit("queue-updated", ());
    Ok(())
}

#[tauri::command]
pub fn cancel_work(
    lib_state: State<'_, Library>,
    queue: State<'_, QueueState>,
    id: String,
) -> Result<(), String> {
    let flag = {
        let flags = queue.cancel_flags.lock().map_err(|_| "queue lock poisoned".to_string())?;
        flags.get(&id).cloned()
    };
    match flag {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => {
            let conn = lib_state.0.lock().map_err(lib_err)?;
            crate::library::set_status(&conn, &id, "cancelled", None)
        }
    }
}

pub fn start_queue_worker<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    {
        let queue = app.state::<QueueState>();
        let mut processing = queue.processing.lock().expect("queue lock poisoned");
        if *processing {
            return;
        }
        *processing = true;
    }
    tauri::async_runtime::spawn(async move {
        run_queue(&app).await;
        let queue = app.state::<QueueState>();
        *queue.processing.lock().expect("queue lock poisoned") = false;
    });
}

pub async fn run_queue<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    loop {
        let next = {
            let lib_state = app.state::<Library>();
            let conn = lib_state.0.lock().expect("library lock poisoned");
            crate::library::next_queued(&conn)
        };
        match next {
            Ok(Some(work)) => process_one(app, work).await,
            _ => break,
        }
    }
}

async fn process_one<R: tauri::Runtime>(app: &tauri::AppHandle<R>, work: Work) {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let queue = app.state::<QueueState>();
        queue
            .cancel_flags
            .lock()
            .expect("queue lock poisoned")
            .insert(work.id.clone(), cancel_flag.clone());
    }

    let result = run_transcription(app, &work, cancel_flag).await;

    {
        let queue = app.state::<QueueState>();
        queue.cancel_flags.lock().expect("queue lock poisoned").remove(&work.id);
    }

    match &result {
        Ok(()) => crate::logs::info(format!("finished \"{}\"", work.source_filename)),
        Err(e) if e == "cancelled" => {
            crate::logs::info(format!("cancelled \"{}\"", work.source_filename))
        }
        Err(e) => crate::logs::error(format!("failed \"{}\": {e}", work.source_filename)),
    }
    if let Err(e) = result {
        let lib_state = app.state::<Library>();
        let conn = lib_state.0.lock().expect("library lock poisoned");
        let status = if e == "cancelled" { "cancelled" } else { "failed" };
        let error = if e == "cancelled" { None } else { Some(e.as_str()) };
        let _ = crate::library::set_status(&conn, &work.id, status, error);
    }
    let _ = app.emit("queue-updated", ());
}

async fn run_transcription<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    work: &Work,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let dir = app_data_dir(app)?;
    {
        let lib_state = app.state::<Library>();
        let conn = lib_state.0.lock().expect("library lock poisoned");
        crate::library::set_status(&conn, &work.id, "running", None)?;
    }
    let _ = app.emit("queue-updated", ());

    let model_id = work.model_id.clone().ok_or("no model selected for this work")?;
    // Only one quant per model now; the column is kept for back-compat with
    // older rows but everything maps to Full.
    let quant = Quant::Full;
    let variant = models::find_variant_any(&dir, &model_id, quant).ok_or("unknown model/quant")?;
    let model_path = models::installed_path(&dir, &variant);
    if !model_path.is_file() {
        return Err(format!("model \"{model_id}\" is not downloaded yet"));
    }

    let source_path = work.source_path.clone().ok_or("work has no source path")?;
    let input = std::path::Path::new(&source_path);
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    crate::logs::info(format!(
        "transcribing \"{}\" with model {model_id}",
        work.source_filename
    ));
    let wav_path = audio::extract_to_wav(app, input, cancel_flag.clone()).await?;

    let language = work.language.clone();
    let app_for_blocking = app.clone();
    let work_id = work.id.clone();
    let wav_path_for_blocking = wav_path.clone();
    let transcribe_result = tokio::task::spawn_blocking(move || {
        crate::whisper::transcribe(
            &app_for_blocking,
            &work_id,
            &model_path,
            &wav_path_for_blocking,
            language.as_deref(),
            cancel_flag,
        )
    })
    .await
    .map_err(|e| format!("transcription task panicked: {e}"))?;

    let _ = std::fs::remove_file(&wav_path);

    let result = transcribe_result?;
    crate::logs::info(format!(
        "\"{}\": {} segments, {:.1}s of audio, language {}",
        work.source_filename,
        result.segments.len(),
        result.duration_secs.unwrap_or(0.0),
        result.detected_language.as_deref().unwrap_or("n/a")
    ));
    let effective_language = result
        .detected_language
        .or_else(|| work.language.clone().filter(|l| l != "auto"));

    let lib_state = app.state::<Library>();
    let conn = lib_state.0.lock().expect("library lock poisoned");
    crate::library::save_transcript(
        &conn,
        &work.id,
        effective_language.as_deref(),
        result.duration_secs,
        &result.segments,
        &result.peaks,
    )
}

// ---- Export ----

fn format_timecode(t: f64, ms_sep: char) -> String {
    let total_ms = (t * 1000.0).round().max(0.0) as i64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    format!("{h:02}:{m:02}:{s:02}{ms_sep}{ms:03}")
}

fn render_txt(segments: &[Segment]) -> String {
    segments.iter().map(|s| s.text.trim()).collect::<Vec<_>>().join("\n")
}

fn render_srt(segments: &[Segment]) -> String {
    segments
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                i + 1,
                format_timecode(s.start, ','),
                format_timecode(s.end, ','),
                s.text.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_vtt(segments: &[Segment]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for s in segments {
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_timecode(s.start, '.'),
            format_timecode(s.end, '.'),
            s.text.trim()
        ));
    }
    out
}

/// Reflows segments into paragraphs, breaking on >2s pauses between segments —
/// good enough proxy for a natural paragraph break without NLP.
fn render_article(segments: &[Segment]) -> String {
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut prev_end: Option<f64> = None;
    for s in segments {
        if let Some(pe) = prev_end {
            if s.start - pe > 2.0 && !current.is_empty() {
                paragraphs.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(s.text.trim());
        prev_end = Some(s.end);
    }
    if !current.is_empty() {
        paragraphs.push(current);
    }
    paragraphs.join("\n\n")
}

fn render_export(work: &Work, format: &str) -> Result<String, String> {
    match format {
        "txt" => Ok(render_txt(&work.segments)),
        "srt" => Ok(render_srt(&work.segments)),
        "vtt" => Ok(render_vtt(&work.segments)),
        "json" => serde_json::to_string_pretty(&work.segments).map_err(|e| e.to_string()),
        "article" | "md" => Ok(render_article(&work.segments)),
        other => Err(format!("unknown export format: {other}")),
    }
}

// ---- Standalone subtitle editor (open/edit/save an external .srt/.vtt) ----

/// Inverse of `format_timecode`: parse `HH:MM:SS,mmm` or `HH:MM:SS.mmm` (hours
/// optional) into seconds. Tolerant of either separator so the same parser
/// handles SRT and VTT.
fn parse_timecode(s: &str) -> Option<f64> {
    let s = s.trim();
    let (hms, ms) = match s.rsplit_once([',', '.']) {
        Some((a, b)) => (a, b),
        None => (s, "0"),
    };
    let ms: f64 = ms.parse().ok()?;
    let parts: Vec<&str> = hms.split(':').collect();
    let (h, m, sec): (f64, f64, f64) = match parts.as_slice() {
        [h, m, s] => (h.parse().ok()?, m.parse().ok()?, s.parse().ok()?),
        [m, s] => (0.0, m.parse().ok()?, s.parse().ok()?),
        _ => return None,
    };
    Some(h * 3600.0 + m * 60.0 + sec + ms / 1000.0)
}

/// Parse SRT or VTT text into segments. Blocks are separated by blank lines;
/// within a block the `-->` line carries the times and the following lines are
/// the caption. Blocks without a `-->` line (index-only, the VTT header) are
/// skipped, so the one parser covers both formats.
fn parse_subtitles(text: &str) -> Vec<Segment> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut segments = Vec::new();
    for block in text.split("\n\n") {
        let lines: Vec<&str> = block.lines().collect();
        let Some(tc_idx) = lines.iter().position(|l| l.contains("-->")) else { continue };
        let Some((a, b)) = lines[tc_idx].split_once("-->") else { continue };
        let Some(start) = parse_timecode(a) else { continue };
        // VTT can append cue settings after the end time ("... align:start").
        let end_str = b.trim().split_whitespace().next().unwrap_or("");
        let Some(end) = parse_timecode(end_str) else { continue };
        let text = lines[tc_idx + 1..].join("\n").trim().to_string();
        segments.push(Segment { start, end, text });
    }
    segments
}

/// Import an external .srt/.vtt into the library as a finished `subtitle` work
/// and return its id. Editing and export then reuse the transcript commands.
#[tauri::command]
pub fn import_subtitle(
    app: AppHandle,
    lib_state: State<'_, Library>,
    path: String,
) -> Result<String, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let segments = parse_subtitles(&text);
    if segments.is_empty() {
        return Err("No subtitles found in that file.".to_string());
    }
    let filename = std::path::Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let id = {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::create_subtitle(&conn, &filename, Some(&path), &segments)?
    };
    let _ = app.emit("queue-updated", ());
    Ok(id)
}

/// Write segments back out as SRT to an arbitrary path (the subtitle editor's
/// Save / Save as). Separate from `export_transcript`, which targets the
/// configured output dir by work id.
#[tauri::command]
pub fn write_subtitle(path: String, segments: Vec<Segment>) -> Result<(), String> {
    std::fs::write(&path, render_srt(&segments)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_export(
    lib_state: State<'_, Library>,
    id: String,
    format: String,
) -> Result<String, String> {
    let conn = lib_state.0.lock().map_err(lib_err)?;
    let work = crate::library::get(&conn, &id)?.ok_or_else(|| "work not found".to_string())?;
    render_export(&work, &format)
}

#[tauri::command]
pub fn export_transcript(
    app: AppHandle,
    lib_state: State<'_, Library>,
    id: String,
    format: String,
) -> Result<String, String> {
    export_transcript_impl(&app, lib_state, id, format)
}

fn export_transcript_impl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    lib_state: State<'_, Library>,
    id: String,
    format: String,
) -> Result<String, String> {
    let work = {
        let conn = lib_state.0.lock().map_err(lib_err)?;
        crate::library::get(&conn, &id)?.ok_or_else(|| "work not found".to_string())?
    };
    let content = render_export(&work, &format)?;

    let settings = config::load(&app_data_dir(&app)?);
    let ext = if format == "article" { "md" } else { format.as_str() };
    let stem = std::path::Path::new(&work.source_filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| work.id.clone());
    let out_dir = settings
        .output_dir
        .map(std::path::PathBuf::from)
        .or_else(dirs::download_dir)
        .ok_or_else(|| "no output directory available".to_string())?;
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!("{stem}.{ext}"));
    std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, end: f64, text: &str) -> Segment {
        Segment { start, end, text: text.to_string() }
    }

    #[test]
    fn timecode_formats_correctly() {
        assert_eq!(format_timecode(0.0, ','), "00:00:00,000");
        assert_eq!(format_timecode(61.234, ','), "00:01:01,234");
        assert_eq!(format_timecode(3661.5, '.'), "01:01:01.500");
        assert_eq!(format_timecode(-1.0, ','), "00:00:00,000");
    }

    #[test]
    fn render_txt_joins_lines() {
        let segments = vec![seg(0.0, 1.0, "Hello "), seg(1.0, 2.0, "world.")];
        assert_eq!(render_txt(&segments), "Hello\nworld.");
    }

    #[test]
    fn parse_subtitles_roundtrips_srt_and_reads_vtt() {
        // render_srt output must parse back to the same times/text.
        let segments = vec![seg(0.0, 1.234, "Hello"), seg(1.5, 3.0, "world")];
        let parsed = parse_subtitles(&render_srt(&segments));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].start, 0.0);
        assert_eq!(parsed[0].end, 1.234);
        assert_eq!(parsed[0].text, "Hello");
        assert_eq!(parsed[1].start, 1.5);
        // VTT (dot separator, header block, cue settings) parses too.
        let vtt = "WEBVTT\n\n00:00:02.000 --> 00:00:04.500 align:start\nHi there";
        let p = parse_subtitles(vtt);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].start, 2.0);
        assert_eq!(p[0].end, 4.5);
        assert_eq!(p[0].text, "Hi there");
    }

    #[test]
    fn render_srt_is_well_formed() {
        let segments = vec![seg(0.0, 1.234, "Hello"), seg(1.5, 3.0, "world")];
        let srt = render_srt(&segments);
        let lines: Vec<&str> = srt.lines().collect();
        assert_eq!(lines[0], "1");
        assert_eq!(lines[1], "00:00:00,000 --> 00:00:01,234");
        assert_eq!(lines[2], "Hello");
        assert_eq!(lines[4], "2");
        assert_eq!(lines[5], "00:00:01,500 --> 00:00:03,000");
        assert_eq!(lines[6], "world");
    }

    #[test]
    fn render_vtt_has_header_and_timecodes() {
        let segments = vec![seg(0.0, 1.0, "Hello")];
        let vtt = render_vtt(&segments);
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:00.000 --> 00:00:01.000"));
        assert!(vtt.contains("Hello"));
    }

    #[test]
    fn render_article_reflows_on_pauses() {
        let segments = vec![
            seg(0.0, 1.0, "First sentence."),
            seg(1.5, 2.0, "Second sentence."),
            seg(5.0, 6.0, "After a long pause."),
        ];
        let article = render_article(&segments);
        assert_eq!(article, "First sentence. Second sentence.\n\nAfter a long pause.");
    }

    fn dummy_work(segments: Vec<Segment>) -> Work {
        Work {
            id: "test".to_string(),
            source_filename: "test.mp3".to_string(),
            source_path: None,
            duration_secs: None,
            language: None,
            model_id: None,
            quant: None,
            status: "done".to_string(),
            error: None,
            kind: "transcript".to_string(),
            transcript_text: String::new(),
            segments,
            peaks: Vec::new(),
            created_at: "0".to_string(),
            updated_at: "0".to_string(),
        }
    }

    #[test]
    fn render_json_round_trips() {
        let segments = vec![seg(0.0, 1.0, "Hello"), seg(1.0, 2.0, "world")];
        let work = dummy_work(segments.clone());
        let json = render_export(&work, "json").unwrap();
        let parsed: Vec<Segment> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].text, "Hello");
    }

    #[test]
    fn render_export_rejects_unknown_format() {
        let work = dummy_work(vec![]);
        assert!(render_export(&work, "docx").is_err());
    }
}
