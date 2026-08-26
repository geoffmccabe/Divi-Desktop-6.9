//! Lightweight in-app event log for the dashboard. It records what the APP does
//! around the node — asked it to start, waited, ran a check, asked it to stop,
//! a request timed out, etc. — so those steps are visible in Settings → Logs next
//! to the node's own log, instead of being invisible.
//!
//! Consecutive identical messages collapse into one entry with a repeat count, so
//! a repeated action never spams the log or a copy-paste (the display shows the
//! line once, then "[^^ xN]"). In-memory, size-capped, and cheap — the collapse
//! means calling it in a loop adds a counter, not a thousand entries.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// One collapsed log entry. `ts_ms` is the time of the most recent occurrence;
/// the dashboard formats it into local time.
pub struct AppEntry {
    pub ts_ms: u64,
    pub msg: String,
    pub count: u32,
}

const MAX_ENTRIES: usize = 800;

static LOG: Mutex<Vec<AppEntry>> = Mutex::new(Vec::new());

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Record one app event. If it's an immediate repeat of the previous message,
/// bump that entry's counter instead of adding a new line.
pub fn log(msg: impl Into<String>) {
    let msg = msg.into();
    let now = now_ms();
    if let Ok(mut g) = LOG.lock() {
        if let Some(last) = g.last_mut() {
            if last.msg == msg {
                last.count += 1;
                last.ts_ms = now;
                return;
            }
        }
        g.push(AppEntry { ts_ms: now, msg, count: 1 });
        let len = g.len();
        if len > MAX_ENTRIES {
            g.drain(0..len - MAX_ENTRIES);
        }
    }
}

/// A snapshot of the log, oldest first, for the dashboard to render.
pub fn entries() -> Vec<AppEntry> {
    LOG.lock()
        .map(|g| {
            g.iter()
                .map(|e| AppEntry { ts_ms: e.ts_ms, msg: e.msg.clone(), count: e.count })
                .collect()
        })
        .unwrap_or_default()
}
