use crate::rpc::RpcClient;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The daemon's pid, if it is actually alive (a stale pid file doesn't count).
pub fn daemon_pid(datadir: &Path) -> Option<i32> {
    let pid = std::fs::read_to_string(datadir.join("divid.pid")).ok()?;
    let pid: i32 = pid.trim().parse().ok()?;
    if pid_alive(pid) {
        Some(pid)
    } else {
        None
    }
}

fn pid_alive(pid: i32) -> bool {
    // Signal 0 = existence check only. Unix; Windows comes with the Tauri phase.
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Find a divid binary: explicit path, then PATH, then where Divi Desktop 2.0
/// unpacks its managed copy on macOS.
pub fn find_divid(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = explicit {
        candidates.push(p);
    }
    if let Ok(out) = std::process::Command::new("which").arg("divid").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            candidates.push(PathBuf::from(p));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        // Divi Desktop 2.0 unpacks its managed daemon here at launch; the
        // exact layout has varied, so try both known shapes.
        let base = PathBuf::from(home).join("Library/Application Support/Divi Desktop/divid/unpacked");
        candidates.push(base.join("divid"));
        candidates.push(base.join("divi_osx/divid"));
    }
    candidates.push(PathBuf::from("/usr/local/bin/divid"));
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "cannot find a divid binary — pass --divid <path>".into())
}

/// Outcome of one launch attempt.
enum Spawn {
    Running(i32),
    /// The block database is damaged — repairable by rebuilding it.
    Corruption(String),
    /// Any other refusal to start (config, ports, permissions...).
    Failed(String),
}

const CORRUPTION_MARKERS: [&str; 4] = [
    "corruption",
    "Error loading block database",
    "Failed to find best block",
    "Error opening block database",
];

/// One launch attempt with a given set of extra flags. Waits until the node's
/// RPC answers, or classifies why it didn't.
fn spawn_once(
    divid: &Path,
    datadir: &Path,
    rpc: &RpcClient,
    timeout: Duration,
    extra_args: &[&str],
) -> Spawn {
    if let Some(pid) = daemon_pid(datadir) {
        return Spawn::Running(pid);
    }
    let spawn_log_path = datadir.join("dd69-spawn.log");
    let Ok(spawn_log) = std::fs::File::create(&spawn_log_path) else {
        return Spawn::Failed(format!("cannot write in {}", datadir.display()));
    };
    let Ok(spawn_log_err) = spawn_log.try_clone() else {
        return Spawn::Failed("cannot open spawn log".into());
    };
    let mut cmd = std::process::Command::new(divid);
    cmd.arg(format!("-conf={}", datadir.join("divi.conf").display()))
        .arg(format!("-datadir={}/", datadir.display()));
    for a in extra_args {
        cmd.arg(a);
    }
    if cmd.stdout(spawn_log).stderr(spawn_log_err).spawn().is_err() {
        return Spawn::Failed(format!("could not launch {}", divid.display()));
    }

    let started = Instant::now();
    loop {
        if rpc.call("getblockcount", serde_json::json!([])).is_ok() {
            return match daemon_pid(datadir) {
                Some(pid) => Spawn::Running(pid),
                None => Spawn::Failed("node answered RPC but wrote no pid file".into()),
            };
        }
        // Daemon printed a fatal line and died? Classify and stop waiting.
        if daemon_pid(datadir).is_none() && started.elapsed() > Duration::from_secs(3) {
            let said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
            if let Some(line) = said.lines().find(|l| l.contains("Error:")) {
                let msg = line.trim().to_string();
                if CORRUPTION_MARKERS.iter().any(|m| msg.contains(m)) {
                    return Spawn::Corruption(msg);
                }
                return Spawn::Failed(msg);
            }
        }
        if started.elapsed() >= timeout {
            let said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
            let hint = said
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("no output")
                .trim()
                .to_string();
            return Spawn::Failed(format!(
                "node did not become ready within {}s (its last words: {})",
                timeout.as_secs(),
                hint
            ));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// What a start actually did, so the UI can tell the user the truth.
pub struct StartReport {
    pub pid: i32,
    /// Some(flag) if the node had to be repaired to start.
    pub repaired_with: Option<String>,
}

/// The recovery ladder. Try a normal start; if the block database is corrupt,
/// rebuild it from the local block files — chainstate-only first (fast), then
/// a full index rebuild. Neither step ever touches wallet.dat: keys are never
/// at risk, only the re-downloadable chain data is rebuilt.
///
/// Rung 3 (restore from the daily snapshot) is a future step — it needs the
/// download+verify code — and is surfaced as a clear message rather than
/// pretended.
pub fn start_with_recovery(
    divid: &Path,
    datadir: &Path,
    rpc: &RpcClient,
    normal_timeout: Duration,
    repair_timeout: Duration,
) -> Result<StartReport, String> {
    // (flag, human label, timeout). None flag = ordinary start.
    let ladder: [(Option<&str>, &str, Duration); 3] = [
        (None, "", normal_timeout),
        (Some("-reindex-chainstate"), "rebuilding the coin database", repair_timeout),
        (Some("-reindex"), "rebuilding the full blockchain index", repair_timeout),
    ];

    let mut last_corruption = String::new();
    for (i, (flag, label, timeout)) in ladder.iter().enumerate() {
        let args: Vec<&str> = flag.iter().copied().collect();
        match spawn_once(divid, datadir, rpc, *timeout, &args) {
            Spawn::Running(pid) => {
                return Ok(StartReport {
                    pid,
                    repaired_with: if i == 0 { None } else { Some((*label).to_string()) },
                });
            }
            Spawn::Corruption(msg) => {
                last_corruption = msg;
                // fall through to the next, more aggressive repair rung
                continue;
            }
            Spawn::Failed(msg) => return Err(msg),
        }
    }
    Err(format!(
        "the blockchain data is damaged and a local rebuild didn't fix it ({}). \
         Next step: restore from the Divi snapshot. Your coins are safe — only downloaded data is affected.",
        last_corruption
    ))
}

/// The one rule this whole project exists to enforce: never kill divid.
/// Ask it to stop over RPC, then WAIT for the process to actually exit —
/// the flush between "stop" and exit is the 9-13 s corruption window.
pub fn safe_stop(rpc: &RpcClient, datadir: &Path, timeout: Duration) -> Result<Duration, String> {
    let Some(pid) = daemon_pid(datadir) else {
        return Err("daemon is not running".into());
    };
    rpc.call("stop", serde_json::json!([]))?;
    let started = Instant::now();
    while started.elapsed() < timeout {
        if !pid_alive(pid) {
            return Ok(started.elapsed());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "daemon (pid {pid}) still flushing after {}s — NOT killing it; wait longer",
        timeout.as_secs()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corruption_markers_match_real_divi_error() {
        let real = "Error: Error loading block database : Block database corruption detected! Failed to find best block in block index";
        assert!(CORRUPTION_MARKERS.iter().any(|m| real.contains(m)));
    }

    #[test]
    fn benign_error_is_not_corruption() {
        let benign = "Error: Unable to bind to 0.0.0.0:51472";
        assert!(!CORRUPTION_MARKERS.iter().any(|m| benign.contains(m)));
    }
}
