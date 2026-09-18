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

/// Wall-clock stamp as `YYYY-MM-DD HH:MM:SS UTC`.
///
/// Computed here rather than shelled out to `date`. Two reasons: `date -r` does
/// not exist on Windows, so every line in a Windows log read "epoch 1789679518"
/// and nobody could tell when anything happened or how long a step took; and
/// spawning a process PER LOG LINE is absurd when a failing node writes seventy
/// lines in three minutes.
///
/// UTC rather than local time, deliberately: these logs get pasted into chat
/// and compared against server-side records, and an unlabelled local time from
/// an unknown timezone is worse than useless.
fn stamp(ts_ms: u64) -> String {
    let secs = ts_ms / 1000;
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let (h, mi, sec) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{sec:02} UTC")
}

/// Days since 1970-01-01 to calendar date. Hinnant's algorithm, which is exact
/// and needs no date library.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The last line written, and how many times it has repeated since.
///
/// A node that crashes on startup is retried until it times out, and a tester's
/// log arrived with seventy identical crash lines in it. They bury everything
/// useful. Identical consecutive lines are now counted rather than repeated.
static REPEAT: Mutex<Option<(String, u32)>> = Mutex::new(None);

/// Write out a pending "repeated N times" note, if any.
fn flush_repeats() {
    let pending = {
        let Ok(mut g) = REPEAT.lock() else { return };
        match g.take() {
            Some((msg, n)) if n > 1 => Some((msg, n)),
            _ => None,
        }
    };
    if let Some((_, n)) = pending {
        let line = format!("[{}]   (the line above repeated {n} times)", stamp(now_ms()));
        append_to_file(&line);
        if let Ok(mut g) = LOG.lock() {
            g.push((now_ms(), format!("  (the line above repeated {n} times)")));
        }
    }
}

pub fn log(msg: impl Into<String>) {
    let msg = msg.into();
    let now = now_ms();
    // Identical consecutive lines are counted, not repeated. See REPEAT above.
    {
        let Ok(mut g) = REPEAT.lock() else { return };
        match g.as_mut() {
            Some((last, n)) if *last == msg => {
                *n += 1;
                return;
            }
            _ => {}
        }
        let previous = g.replace((msg.clone(), 1));
        drop(g);
        if let Some((_, n)) = previous {
            if n > 1 {
                let note = format!("  (the line above repeated {n} times)");
                append_to_file(&format!("[{}] {}", stamp(now), note));
                if let Ok(mut l) = LOG.lock() {
                    l.push((now, note));
                }
            }
        }
    }
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

/// Copy the tail of the node's own debug.log into the setup log.
///
/// THE SINGLE MOST USEFUL ADDITION HERE. When a node fails to start we captured
/// one line: the one containing "Error:", or its last words. We never saw what
/// came BEFORE, which is what names the startup step it died in. Two testers
/// sent logs showing "Assertion failed ... ChainstateManager.cpp line 102" and
/// nothing else, so diagnosing it needed a person at a keyboard on the far side
/// of the world.
pub fn attach_node_log(lines_wanted: usize) {
    let path = crate::config::dd69_datadir().join("debug.log");
    let Ok(text) = std::fs::read_to_string(&path) else {
        log(format!("node log: none found at {}", path.display()));
        return;
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines_wanted);
    log(format!(
        "node log: last {} lines of debug.log (the node's own words) ↓",
        all.len() - start
    ));
    for l in &all[start..] {
        // Indented so the node's voice is distinguishable from ours.
        let trimmed = if l.len() > 400 { &l[..400] } else { l };
        log(format!("  | {trimmed}"));
    }
    log("node log: end");
}

/// Is the peer port already taken, and if so by what?
///
/// A tester's node could not start because his older Divi wallet still held the
/// port. That is entirely predictable BEFORE launching, and the node's own
/// wording for it ("Unable to bind") explains nothing to a user.
pub fn check_port(port: u16) {
    use std::net::TcpListener;
    match TcpListener::bind(("0.0.0.0", port)) {
        Ok(l) => {
            drop(l);
            log(format!("port {port}: free"));
        }
        Err(e) => {
            log(format!("port {port}: ALREADY IN USE ({e}) — another Divi node is probably running"));
            if let Some(who) = port_holder(port) {
                log(format!("port {port}: held by → {who}"));
            }
        }
    }
}

/// Best-effort name of whatever holds a port, so the log names the culprit
/// instead of leaving the user to guess which program to close.
fn port_holder(port: u16) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        return s.lines().nth(1).map(|l| l.split_whitespace().take(2).collect::<Vec<_>>().join(" pid "));
    }
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("ss").args(["-lptn", &format!("sport = :{port}")]).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        return s.lines().nth(1).map(|l| l.trim().to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("cmd")
            .args(["/C", &format!("netstat -ano -p tcp | findstr LISTENING | findstr :{port}")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let pid = s.split_whitespace().last()?.to_string();
        let name = std::process::Command::new("cmd")
            .args(["/C", &format!("tasklist /FI \"PID eq {pid}\" /NH")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().next().unwrap_or("").to_string())
            .unwrap_or_default();
        return Some(format!("{name} (pid {pid})"));
    }
    #[allow(unreachable_code)]
    None
}

/// One plain sentence ending each session, so nobody has to read the whole file
/// to learn whether it worked.
pub fn session_result(ok: bool, summary: impl Into<String>) {
    flush_repeats();
    log(format!(
        "RESULT: {} — {}",
        if ok { "the node started" } else { "THE NODE DID NOT START" },
        summary.into()
    ));
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
