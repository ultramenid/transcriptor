// Plain-text activity log, written next to the library in the app data dir.
//
// Deliberately not a logging framework: one append-only file, one roll at 1 MB,
// no levels to configure, no targets to wire up. It exists so a user can say
// "it failed" and hand over something that says why — which of ffmpeg/whisper
// ran, what the model reported, what a crash looked like.
//
// Privacy: this file never contains transcript text. Filenames, paths, model
// ids, durations and error strings only — and it stays on disk like everything
// else in this app.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_BYTES: u64 = 1024 * 1024;
/// How much of the tail `read` hands back to the Settings viewer.
const TAIL_BYTES: u64 = 256 * 1024;

static SINK: OnceLock<Mutex<Option<File>>> = OnceLock::new();

pub fn path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("transcriptor.log")
}

/// Opens the log for appending, rolling the previous one aside if it has grown
/// past the cap. Safe to call more than once; only the first call binds.
pub fn init(app_data_dir: &Path) {
    let file = open_appending(app_data_dir);
    let _ = SINK.set(Mutex::new(file));
}

fn open_appending(app_data_dir: &Path) -> Option<File> {
    let p = path(app_data_dir);
    // One generation of history is enough to survive a restart mid-investigation.
    if std::fs::metadata(&p).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&p, p.with_extension("log.1"));
    }
    OpenOptions::new().create(true).append(true).open(&p).ok()
}

fn stamp() -> String {
    // `now_local` refuses to answer on some multithreaded setups; UTC is a fine
    // fallback for a log line.
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

fn write(level: &str, msg: &str) {
    let line = format!("{} {:<5} {}\n", stamp(), level, msg);
    // Always mirror to stderr: `tauri dev` and Console.app pick it up, and it
    // keeps working before init() or if the file can't be opened.
    eprint!("{line}");
    if let Some(sink) = SINK.get() {
        if let Ok(mut guard) = sink.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(line.as_bytes());
                let _ = file.flush();
            }
        }
    }
}

pub fn info(msg: impl AsRef<str>) {
    write("INFO", msg.as_ref());
}

pub fn warn(msg: impl AsRef<str>) {
    write("WARN", msg.as_ref());
}

pub fn error(msg: impl AsRef<str>) {
    write("ERROR", msg.as_ref());
}

/// Last `TAIL_BYTES` of the log, for the viewer in Settings. Reads from the end
/// so a large file never has to be loaded whole.
pub fn read(app_data_dir: &Path) -> Result<String, String> {
    let p = path(app_data_dir);
    let mut file = match File::open(&p) {
        Ok(f) => f,
        Err(_) => return Ok(String::new()),
    };
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let from = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf).to_string();
    // A mid-line start would look like corruption; drop the partial first line.
    Ok(if from > 0 {
        text.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or(text)
    } else {
        text
    })
}

/// Routes panics into the log. Without this a panic in a worker thread is
/// invisible: the queue just stops.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        error(format!("panic: {info}"));
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    // `init` binds a process-wide OnceLock, so this is the one test allowed to
    // call it — a second call anywhere would be a silent no-op.
    #[test]
    fn init_then_write_lands_in_the_file() {
        let dir = std::env::temp_dir().join(format!("transcriptor-log-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        init(&dir);
        info("hello from the test");
        error("something broke");

        let text = read(&dir).unwrap();
        assert!(text.contains("INFO  hello from the test"), "{text}");
        assert!(text.contains("ERROR something broke"), "{text}");
        // Stamped, not bare: "YYYY-MM-DD HH:MM:SS ".
        let first = text.lines().next().unwrap();
        assert!(first.chars().filter(|c| *c == '-').count() >= 2, "{first}");
        assert!(first[..19].contains(':'), "no timestamp: {first}");
    }

    #[test]
    fn read_returns_the_tail_without_a_partial_line() {
        let dir = std::env::temp_dir().join(format!("transcriptor-log-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // Missing file is not an error — Settings shows an empty viewer.
        assert_eq!(read(&dir).unwrap(), "");

        let mut f = File::create(path(&dir)).unwrap();
        // Comfortably past TAIL_BYTES so the tail path (and the partial-line
        // trim) actually runs.
        for i in 0..20_000 {
            writeln!(f, "line {i} ------------------------------------------").unwrap();
        }
        drop(f);

        let tail = read(&dir).unwrap();
        assert!(tail.len() as u64 <= TAIL_BYTES, "tail too big: {}", tail.len());
        assert!(tail.ends_with("line 19999 ------------------------------------------\n"));
        // First line survived intact rather than starting mid-word.
        assert!(tail.starts_with("line "), "starts mid-line: {:?}", &tail[..40]);
    }
}
