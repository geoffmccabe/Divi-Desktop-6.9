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

/// The node's own last error, read from its debug.log.
///
/// When a node dies after start-up the app could only say "the node isn't
/// running". The reason was sitting in the node's own file the whole time. A
/// tester's chain database corrupted three times in a week and every screen he
/// saw just said the node was not running.
/// Chatter that contains the word "Error:" and means nothing.
///
/// A healthy node writes "RPCAcceptHandler: Error: Invalid argument" whenever
/// its RPC accept loop is interrupted, which is constantly. Geoff's node, in
/// perfect health, had written that line 1,299 times and "Operation
/// canceled" 8 more -- and those 1,307 lines were the ONLY matches for the
/// old filter in the whole file. There were no real errors in it at all.
///
/// So "the last line containing Error:" was, in practice, always this. Every
/// "The node stopped. Its last message was: RPCAcceptHandler: Error: …"
/// anyone has ever been shown was noise presented as a cause of death, and
/// it sent us looking in the wrong place more than once.
fn is_noise(line: &str) -> bool {
    const NOISE: [&str; 3] = [
        "RPCAcceptHandler",
        // Ordinary peer churn. A connection refused by one node out of
        // hundreds is a normal evening, not a fault.
        "connect() to",
        "socket send error",
    ];
    NOISE.iter().any(|n| line.contains(n))
}

/// Lines that really do explain why a node is not running.
fn is_real_failure(line: &str) -> bool {
    const FATAL: [&str; 9] = [
        "Aborted",
        "corruption",
        "Corrupted",
        "Assertion failed",
        "Error opening block database",
        "Error loading block database",
        "Error initializing",
        "Unable to bind",
        "Cannot obtain a lock on data directory",
    ];
    FATAL.iter().any(|f| line.contains(f))
}

/// The node's own explanation for why it is not running, or None when it
/// never gave one.
///
/// None is an honest and common answer: a node told to shut down cleanly
/// writes no error at all. Returning noise instead of None is what made this
/// unusable.
pub fn last_node_error(datadir: &std::path::Path) -> Option<String> {
    /* WHERE THE NODE ACTUALLY SAYS IT IS DYING. A node that fails during
       start-up -- a failed assertion, a port it cannot bind, a database it
       cannot open -- prints that to its OWN OUTPUT and exits, often before
       debug.log has been opened at all. This only ever read debug.log, so
       the very messages worth reporting were the ones it could not see, and
       it fell back to whatever chatter debug.log happened to hold.

       Read both, newest first, spawn log first. */
    let spawn = std::fs::read_to_string(datadir.join("dd69-spawn.log")).unwrap_or_default();
    let text = std::fs::read_to_string(datadir.join("debug.log")).unwrap_or_default();
    if spawn.trim().is_empty() && text.trim().is_empty() {
        return None;
    }
    // Only the tail: these files reach hundreds of megabytes.
    let tail: Vec<&str> = spawn
        .lines()
        .rev()
        .take(60)
        .chain(text.lines().rev().take(400))
        .collect();
    // Prefer a line that is unambiguously a failure.
    for line in &tail {
        let l = line.trim();
        if !is_noise(l) && is_real_failure(l) {
            let msg = l.splitn(3, ' ').nth(2).unwrap_or(l).trim();
            return Some(msg.chars().take(200).collect());
        }
    }
    // Failing that, any error that is not known chatter.
    for line in &tail {
        let l = line.trim();
        if !is_noise(l) && l.contains("Error:") {
            let msg = l.splitn(3, ' ').nth(2).unwrap_or(l).trim();
            return Some(msg.chars().take(200).collect());
        }
    }
    None
}

#[cfg(test)]
mod last_error_tests {
    use super::*;

    #[test]
    fn rpc_accept_chatter_is_never_a_cause_of_death() {
        // 1,307 of these in a perfectly healthy log.
        assert!(is_noise("RPCAcceptHandler: Error: Invalid argument"));
        assert!(is_noise("RPCAcceptHandler: Error: Operation canceled"));
        assert!(is_noise("connect() to 1.2.3.4:51472 failed after select(): Connection refused (61)"));
    }

    #[test]
    fn genuine_failures_are_recognised() {
        assert!(is_real_failure("Error opening block database"));
        assert!(is_real_failure("Assertion failed: instance != nullptr, file ChainstateManager.cpp"));
        assert!(is_real_failure("Error: Unable to bind to 0.0.0.0:51472 on this computer."));
        assert!(is_real_failure("Cannot obtain a lock on data directory"));
    }

    #[test]
    fn ordinary_activity_is_neither() {
        for l in ["UpdateTip: new best=abc height=4223779", "UPnP Port Mapping successful."] {
            assert!(!is_real_failure(l));
            assert!(!l.contains("Error:"));
        }
    }
}
