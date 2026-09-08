//! A dedicated, detailed log of the FIRST-RUN / setup flow.
//!
//! This is separate from `applog` (the short dashboard event log) on purpose.
//! When a brand-new user's install stalls, we need a complete, timestamped
//! record of every step — environment, disk, download bytes and checksum,
//! unpack, quarantine, the exact daemon launch and its first RPC answer or the
//! OS error that stopped it — so the friend can hit ⌘L, copy it, and paste it
//! back for diagnosis without any back-and-forth.
//!
//! Two properties matter:
//!   * It is PERSISTED to a file (`setup-log.txt` in the node folder), so it
//!     survives even if the app itself crashes before the window paints.
//!   * It never records a secret. Nothing here logs the wallet password, seed
//!     phrase, private keys, or the node's rpcpassword — only what happened.

use std::io::Write as _;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
static APP_VERSION: Mutex<Option<String>> = Mutex::new(None);

const MAX_MEM: usize = 4000;
/// On session start, if the on-disk log is bigger than this, keep only its tail
/// so it can't grow without bound over many launches.
const MAX_FILE_BYTES: u64 = 512 * 1024;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Wall-clock stamp as `YYYY-MM-DD HH:MM:SS` in local time, best-effort.
fn stamp(ts_ms: u64) -> String {
    // Avoid pulling a date crate: format via `date` where available, else fall
    // back to the raw epoch. The friend's paste is read by a human, so a plain
    // local-time string is what we want when we can get it.
    let secs = (ts_ms / 1000) as i64;
    #[cfg(unix)]
    {
        if let Ok(out) = std::process::Command::new("date")
            .arg("-r")
            .arg(secs.to_string())
            .arg("+%Y-%m-%d %H:%M:%S")
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    format!("epoch {secs}")
}

fn file_path() -> Option<PathBuf> {
    Some(crate::config::dd69_datadir().join("setup-log.txt"))
}

fn append_to_file(line: &str) {
    let Some(p) = file_path() else { return };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{line}");
    }
}

/// Record the app's version so the report header can show what build the friend
/// is actually running. Called once at startup from the app crate.
pub fn set_app_version(v: &str) {
    if let Ok(mut g) = APP_VERSION.lock() {
        *g = Some(v.to_string());
    }
}

fn app_version() -> String {
    APP_VERSION
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| "unknown".into())
}

/// Append one detailed setup line, to memory and to the persistent file.
pub fn log(msg: impl Into<String>) {
    let msg = msg.into();
    let now = now_ms();
    let line = format!("[{}] {}", stamp(now), msg);
    append_to_file(&line);
    if let Ok(mut g) = LOG.lock() {
        g.push((now, msg));
        let len = g.len();
        if len > MAX_MEM {
            g.drain(0..len - MAX_MEM);
        }
    }
}

/// Best-effort OS name + version, for the report header.
fn os_version() -> String {
    let os = std::env::consts::OS;
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sw_vers").arg("-productVersion").output() {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !v.is_empty() {
                return format!("macOS {v}");
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = std::fs::read_to_string("/etc/os-release") {
            if let Some(l) = text.lines().find(|l| l.starts_with("PRETTY_NAME=")) {
                let v = l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string();
                if !v.is_empty() {
                    return v;
                }
            }
        }
    }
    os.to_string()
}

/// Free disk on the node folder, formatted, plus the folder path.
fn disk_line() -> String {
    let dir = crate::config::dd69_datadir();
    match crate::install::free_bytes_public(&dir) {
        Some(free) => format!("{:.1} GB free", free as f64 / (1u64 << 30) as f64),
        None => "unknown".into(),
    }
}

/// Start a fresh setup-log session: trim the file if huge, then write a big
/// separator and the full environment snapshot. Safe to call on every launch.
pub fn start_session() {
    trim_file_if_huge();
    log("──────────────────────────────────────────────");
    log("DD69 setup session started");
    log(format!("app version: {}", app_version()));
    log(format!("os: {} ({})", os_version(), std::env::consts::ARCH));
    log(format!("node folder: {}", crate::config::dd69_datadir().display()));
    log(format!("free disk: {}", disk_line()));
}

fn trim_file_if_huge() {
    let Some(p) = file_path() else { return };
    let Ok(meta) = std::fs::metadata(&p) else { return };
    if meta.len() <= MAX_FILE_BYTES {
        return;
    }
    if let Ok(text) = std::fs::read_to_string(&p) {
        let lines: Vec<&str> = text.lines().collect();
        let keep = lines.len().saturating_sub(3000);
        let tail = lines[keep..].join("\n");
        let _ = std::fs::write(&p, format!("(older setup-log lines trimmed)\n{tail}\n"));
    }
}

/// The full copy-pasteable report for ⌘L: a live header plus the entire
/// persistent log (all sessions), so nothing that happened is missing. Falls
/// back to the in-memory lines if the file can't be read. Contains no secrets.
pub fn report() -> String {
    let header = format!(
        "DD69 Setup Log\n\
         generated: {}\n\
         app version: {}\n\
         os: {} ({})\n\
         node folder: {}\n\
         free disk: {}\n\
         ──────────────────────────────────────────────\n",
        stamp(now_ms()),
        app_version(),
        os_version(),
        std::env::consts::ARCH,
        crate::config::dd69_datadir().display(),
        disk_line(),
    );

    if let Some(p) = file_path() {
        if let Ok(text) = std::fs::read_to_string(&p) {
            if !text.trim().is_empty() {
                return format!("{header}{text}");
            }
        }
    }
    // Fallback: in-memory only.
    let body: String = LOG
        .lock()
        .map(|g| {
            g.iter()
                .map(|(ts, m)| format!("[{}] {}", stamp(*ts), m))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    format!("{header}{body}\n")
}
