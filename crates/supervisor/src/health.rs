use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// The daemon records on startup whether its previous shutdown flushed
/// cleanly ("Last shutdown was prepared: true/false" in debug.log). That flag
/// is our corruption early-warning: Dirty means the last run was killed or
/// lost power mid-write.
#[derive(Debug, PartialEq)]
pub enum LastShutdown {
    Clean,
    Dirty,
    Unknown,
}

const MARKER: &str = "Last shutdown was prepared: ";
// debug.log grows unbounded; only the most recent startup lines matter.
const TAIL_BYTES: u64 = 2_000_000;

pub fn last_shutdown(datadir: &Path) -> LastShutdown {
    let path = datadir.join("debug.log");
    let Ok(mut f) = File::open(&path) else {
        return LastShutdown::Unknown;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES)));
    let mut raw = Vec::new();
    if f.read_to_end(&mut raw).is_err() {
        return LastShutdown::Unknown;
    }
    let buf = String::from_utf8_lossy(&raw);
    match buf.rfind(MARKER) {
        Some(i) => {
            if buf[i + MARKER.len()..].starts_with("true") {
                LastShutdown::Clean
            } else {
                LastShutdown::Dirty
            }
        }
        None => LastShutdown::Unknown,
    }
}
