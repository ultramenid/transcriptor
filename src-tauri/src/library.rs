// SQLite (rusqlite + FTS5): works index, history, search.
// Recents / library / queue are three views of this one table.

use crate::whisper::Segment;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub struct Library(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub source_filename: String,
    pub source_path: Option<String>,
    pub duration_secs: Option<f64>,
    pub language: Option<String>,
    pub model_id: Option<String>,
    pub quant: Option<String>,
    pub status: String,
    pub error: Option<String>,
    // "transcript" (audio/video run) or "subtitle" (an imported .srt/.vtt).
    // Drives the library category filter; defaults to "transcript" for rows
    // created before this column existed.
    pub kind: String,
    pub transcript_text: String,
    pub segments: Vec<Segment>,
    // Per-bucket audio amplitude, so the library redraws the real waveform.
    // Empty for works transcribed before this was persisted.
    pub peaks: Vec<f32>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn open(app_data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(app_data_dir.join("library.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS works (
            id TEXT PRIMARY KEY,
            source_filename TEXT NOT NULL,
            source_path TEXT,
            duration_secs REAL,
            language TEXT,
            model_id TEXT,
            quant TEXT,
            status TEXT NOT NULL,
            error TEXT,
            kind TEXT NOT NULL DEFAULT 'transcript',
            transcript_text TEXT NOT NULL DEFAULT '',
            segments_json TEXT NOT NULL DEFAULT '[]',
            peaks_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
            transcript_text, source_filename, content='works', content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS works_ai AFTER INSERT ON works BEGIN
            INSERT INTO works_fts(rowid, transcript_text, source_filename)
            VALUES (new.rowid, new.transcript_text, new.source_filename);
        END;
        CREATE TRIGGER IF NOT EXISTS works_ad AFTER DELETE ON works BEGIN
            INSERT INTO works_fts(works_fts, rowid, transcript_text, source_filename)
            VALUES ('delete', old.rowid, old.transcript_text, old.source_filename);
        END;
        CREATE TRIGGER IF NOT EXISTS works_au AFTER UPDATE ON works BEGIN
            INSERT INTO works_fts(works_fts, rowid, transcript_text, source_filename)
            VALUES ('delete', old.rowid, old.transcript_text, old.source_filename);
            INSERT INTO works_fts(rowid, transcript_text, source_filename)
            VALUES (new.rowid, new.transcript_text, new.source_filename);
        END;
        "#,
    )
    .map_err(|e| e.to_string())?;

    // Migrate DBs created before peaks were persisted. ADD COLUMN errors if it
    // already exists — that's the "already migrated" case, so ignore it.
    let _ = conn.execute(
        "ALTER TABLE works ADD COLUMN peaks_json TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE works ADD COLUMN kind TEXT NOT NULL DEFAULT 'transcript'",
        [],
    );

    Ok(conn)
}

// Unix-epoch-milliseconds as a fixed-width string — sorts correctly as text
// and gives enough resolution that rapid consecutive inserts stay ordered.
fn now() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms:016}")
}

#[allow(clippy::too_many_arguments)]
pub fn create_queued(
    conn: &Connection,
    source_filename: &str,
    source_path: Option<&str>,
    model_id: Option<&str>,
    quant: Option<&str>,
    language: Option<&str>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    conn.execute(
        "INSERT INTO works (id, source_filename, source_path, model_id, quant, language, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?7)",
        rusqlite::params![id, source_filename, source_path, model_id, quant, language, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Insert an imported .srt/.vtt as a finished `subtitle` work. Duration is the
/// last segment's end so the library shows a sensible length. No model/language.
pub fn create_subtitle(
    conn: &Connection,
    source_filename: &str,
    source_path: Option<&str>,
    segments: &[Segment],
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    let transcript_text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let segments_json = serde_json::to_string(segments).map_err(|e| e.to_string())?;
    let duration = segments.last().map(|s| s.end);
    conn.execute(
        "INSERT INTO works (id, source_filename, source_path, duration_secs, status, kind, transcript_text, segments_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'done', 'subtitle', ?5, ?6, ?7, ?7)",
        rusqlite::params![id, source_filename, source_path, duration, transcript_text, segments_json, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn next_queued(conn: &Connection) -> Result<Option<Work>, String> {
    let sql = format!("{SELECT_ALL} WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1");
    conn.query_row(&sql, [], row_to_work)
        .map(Some)
        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
        .map_err(|e| e.to_string())
}

pub fn requeue(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE works SET status = 'queued', error = NULL, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Requeue with a different model/quant. If `language` is Some, the language
/// column is updated too (None keeps the previous value — e.g. a detected
/// language from the last run carries over).
pub fn requeue_with(
    conn: &Connection,
    id: &str,
    model_id: &str,
    quant: &str,
    language: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE works SET status = 'queued', error = NULL, model_id = ?2, quant = ?3, language = COALESCE(?4, language), updated_at = ?5 WHERE id = ?1",
        rusqlite::params![id, model_id, quant, language, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Works left mid-flight when the app quit or crashed. The queue only picks up
/// `queued`, so a `running` row can never resume itself — and the UI offers
/// Retry only for `failed`, leaving it spinning forever. Requeue them at
/// startup. Returns how many were recovered.
pub fn requeue_orphans(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "UPDATE works SET status = 'queued', error = NULL, updated_at = ?1 WHERE status = 'running'",
        rusqlite::params![now()],
    )
    .map_err(|e| e.to_string())
}

pub fn set_status(conn: &Connection, id: &str, status: &str, error: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE works SET status = ?2, error = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, status, error, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name cannot be empty".to_string());
    }
    conn.execute(
        "UPDATE works SET source_filename = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_transcript(
    conn: &Connection,
    id: &str,
    language: Option<&str>,
    duration_secs: Option<f64>,
    segments: &[Segment],
    peaks: &[f32],
) -> Result<(), String> {
    let transcript_text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let segments_json = serde_json::to_string(segments).map_err(|e| e.to_string())?;
    // Empty peaks (e.g. a re-run that didn't recompute them) keep the stored
    // waveform rather than wiping it.
    let peaks_json = serde_json::to_string(peaks).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE works SET status = 'done', language = ?2, duration_secs = COALESCE(?3, duration_secs),
         transcript_text = ?4, segments_json = ?5,
         peaks_json = CASE WHEN ?7 = '[]' THEN peaks_json ELSE ?7 END, updated_at = ?6 WHERE id = ?1",
        rusqlite::params![id, language, duration_secs, transcript_text, segments_json, now(), peaks_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_transcript_edit(conn: &Connection, id: &str, segments: &[Segment]) -> Result<(), String> {
    let transcript_text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let segments_json = serde_json::to_string(segments).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE works SET transcript_text = ?2, segments_json = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, transcript_text, segments_json, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_work(row: &rusqlite::Row) -> rusqlite::Result<Work> {
    let segments_json: String = row.get("segments_json")?;
    let segments: Vec<Segment> = serde_json::from_str(&segments_json).unwrap_or_default();
    let peaks_json: String = row.get("peaks_json")?;
    let peaks: Vec<f32> = serde_json::from_str(&peaks_json).unwrap_or_default();
    Ok(Work {
        id: row.get("id")?,
        source_filename: row.get("source_filename")?,
        source_path: row.get("source_path")?,
        duration_secs: row.get("duration_secs")?,
        language: row.get("language")?,
        model_id: row.get("model_id")?,
        quant: row.get("quant")?,
        status: row.get("status")?,
        error: row.get("error")?,
        kind: row.get("kind")?,
        transcript_text: row.get("transcript_text")?,
        segments,
        peaks,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const SELECT_ALL: &str = "SELECT id, source_filename, source_path, duration_secs, language, model_id, quant,
    status, error, kind, transcript_text, segments_json, peaks_json, created_at, updated_at FROM works";

pub fn list_recent(conn: &Connection, limit: i64) -> Result<Vec<Work>, String> {
    let mut stmt = conn
        .prepare(&format!("{SELECT_ALL} ORDER BY created_at DESC LIMIT ?1"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], row_to_work)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_all(conn: &Connection) -> Result<Vec<Work>, String> {
    let mut stmt = conn
        .prepare(&format!("{SELECT_ALL} ORDER BY created_at DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_work).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn search(conn: &Connection, query: &str) -> Result<Vec<Work>, String> {
    let sql = format!(
        "{SELECT_ALL} WHERE id IN (
            SELECT works.id FROM works_fts
            JOIN works ON works.rowid = works_fts.rowid
            WHERE works_fts MATCH ?1
        ) ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let fts_query = format!("\"{}\"*", query.replace('"', ""));
    let rows = stmt
        .query_map([fts_query], row_to_work)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Work>, String> {
    let sql = format!("{SELECT_ALL} WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_work)
        .map(Some)
        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
        .map_err(|e| e.to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM works WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Connection {
        let dir = std::env::temp_dir().join(format!("transcriptor-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        open(&dir).unwrap()
    }

    #[test]
    fn requeue_orphans_recovers_interrupted_runs() {
        let conn = temp_db();
        let running = create_queued(&conn, "a.mp3", None, None, None, None).unwrap();
        let done = create_queued(&conn, "b.mp3", None, None, None, None).unwrap();
        set_status(&conn, &running, "running", None).unwrap();
        save_transcript(&conn, &done, None, Some(3.0), &[], &[]).unwrap();

        assert_eq!(requeue_orphans(&conn).unwrap(), 1);
        assert_eq!(get(&conn, &running).unwrap().unwrap().status, "queued");
        // Finished work is untouched, duration included.
        let done = get(&conn, &done).unwrap().unwrap();
        assert_eq!(done.status, "done");
        assert_eq!(done.duration_secs, Some(3.0));
    }

    #[test]
    fn create_and_get_round_trips() {
        let conn = temp_db();
        let id = create_queued(
            &conn,
            "interview.mp3",
            Some("/tmp/interview.mp3"),
            Some("large-v3-turbo"),
            Some("compact"),
            Some("auto"),
        )
        .unwrap();

        let work = get(&conn, &id).unwrap().expect("work should exist");
        assert_eq!(work.source_filename, "interview.mp3");
        assert_eq!(work.status, "queued");
        assert_eq!(work.model_id.as_deref(), Some("large-v3-turbo"));
        assert_eq!(work.language.as_deref(), Some("auto"));
    }

    #[test]
    fn status_update_and_next_queued() {
        let conn = temp_db();
        let id = create_queued(&conn,
            "a.mp3",
            Some("/tmp/a.mp3"),
            Some("tiny"),
            Some("compact"),
            Some("auto"),
        )
        .unwrap();

        let next = next_queued(&conn).unwrap().expect("should have queued work");
        assert_eq!(next.id, id);

        set_status(&conn, &id, "running", None).unwrap();
        assert!(next_queued(&conn).unwrap().is_none());

        set_status(&conn, &id, "failed", Some("disk full")).unwrap();
        let work = get(&conn, &id).unwrap().unwrap();
        assert_eq!(work.status, "failed");
        assert_eq!(work.error.as_deref(), Some("disk full"));

        requeue(&conn, &id).unwrap();
        let work = get(&conn, &id).unwrap().unwrap();
        assert_eq!(work.status, "queued");
        assert!(work.error.is_none());
    }

    #[test]
    fn save_and_search_transcript() {
        let conn = temp_db();
        let id = create_queued(
            &conn,
            "meeting.mp3",
            Some("/tmp/meeting.mp3"),
            Some("base"),
            Some("compact"),
            Some("auto"),
        )
        .unwrap();

        let segments = vec![
            Segment { start: 0.0, end: 2.0, text: "Hello everyone.".to_string() },
            Segment { start: 2.5, end: 5.0, text: "Today we discuss budgets.".to_string() },
        ];
        save_transcript(&conn, &id, Some("en"), Some(300.0), &segments, &[0.1, 0.9, 0.4]).unwrap();

        let work = get(&conn, &id).unwrap().unwrap();
        assert_eq!(work.status, "done");
        assert_eq!(work.language.as_deref(), Some("en"));
        assert_eq!(work.duration_secs, Some(300.0));
        assert_eq!(work.segments.len(), 2);
        assert!(work.transcript_text.contains("budgets"));
        // Peaks round-trip so the library redraws the real waveform.
        assert_eq!(work.peaks, vec![0.1, 0.9, 0.4]);

        // An empty-peaks re-run (e.g. per-segment) keeps the stored waveform.
        save_transcript(&conn, &id, Some("en"), Some(300.0), &segments, &[]).unwrap();
        assert_eq!(get(&conn, &id).unwrap().unwrap().peaks, vec![0.1, 0.9, 0.4]);

        let results = search(&conn, "budgets").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id);

        let results = search(&conn, "absentphrase").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn edit_and_delete() {
        let conn = temp_db();
        let id = create_queued(
            &conn,
            "podcast.mp3",
            Some("/tmp/podcast.mp3"),
            Some("small"),
            Some("compact"),
            Some("auto"),
        )
        .unwrap();

        save_transcript(&conn, &id, Some("en"), None, &[
            Segment { start: 0.0, end: 1.0, text: "Original.".to_string() },
        ], &[])
        .unwrap();

        update_transcript_edit(
            &conn,
            &id,
            &[Segment { start: 0.0, end: 1.0, text: "Edited.".to_string() }],
        )
        .unwrap();

        let work = get(&conn, &id).unwrap().unwrap();
        assert_eq!(work.segments[0].text, "Edited.");
        assert_eq!(work.transcript_text, "Edited.");

        delete(&conn, &id).unwrap();
        assert!(get(&conn, &id).unwrap().is_none());
    }

    #[test]
    fn create_subtitle_is_a_done_subtitle_work() {
        let conn = temp_db();
        let segments = vec![
            Segment { start: 0.0, end: 1.5, text: "Hello".to_string() },
            Segment { start: 1.5, end: 4.0, text: "world".to_string() },
        ];
        let id = create_subtitle(&conn, "movie.srt", Some("/tmp/movie.srt"), &segments).unwrap();
        let work = get(&conn, &id).unwrap().unwrap();
        assert_eq!(work.kind, "subtitle");
        assert_eq!(work.status, "done");
        assert_eq!(work.model_id, None);
        assert_eq!(work.duration_secs, Some(4.0)); // last segment end
        assert_eq!(work.segments.len(), 2);
        // Text is searchable like any transcript.
        assert!(search(&conn, "world").unwrap().iter().any(|w| w.id == id));
    }

    #[test]
    fn list_recent_orders_by_created_at() {
        let conn = temp_db();
        let id1 = create_queued(&conn, "oldest.mp3", Some("/tmp/oldest.mp3"), Some("tiny"), Some("compact"), Some("auto"),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let id2 = create_queued(
            &conn, "newest.mp3", Some("/tmp/newest.mp3"), Some("tiny"), Some("compact"), Some("auto"),
        )
        .unwrap();

        let recent = list_recent(&conn, 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, id2);
        assert_eq!(recent[1].id, id1);

        let limited = list_recent(&conn, 1).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].id, id2);
    }
}
