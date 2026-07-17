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

pub fn parse_last_shutdown(log_tail: &str) -> LastShutdown {
    match log_tail.rfind(MARKER) {
        Some(i) => {
            if log_tail[i + MARKER.len()..].starts_with("true") {
                LastShutdown::Clean
            } else {
                LastShutdown::Dirty
            }
        }
        None => LastShutdown::Unknown,
    }
}

/// Second, independent crash signal: divid removes its pid file on a clean
/// exit. A pid file pointing at a dead process means the daemon was killed
/// or lost power — detectable IMMEDIATELY, without waiting for the next
/// daemon startup to write its log flag.
pub fn stale_pid_file(datadir: &Path, daemon_running: bool) -> bool {
    !daemon_running && datadir.join("divid.pid").exists()
}

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
    parse_last_shutdown(&String::from_utf8_lossy(&raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_most_recent_flag() {
        let log = "x\nLast shutdown was prepared: false\ny\nLast shutdown was prepared: true\nz";
        assert_eq!(parse_last_shutdown(log), LastShutdown::Clean);
        let log2 = "Last shutdown was prepared: true\nLast shutdown was prepared: false\n";
        assert_eq!(parse_last_shutdown(log2), LastShutdown::Dirty);
        assert_eq!(parse_last_shutdown("no marker here"), LastShutdown::Unknown);
    }
}
