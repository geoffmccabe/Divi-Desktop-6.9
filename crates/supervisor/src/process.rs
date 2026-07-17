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

/// Start divid against a datadir and wait until its RPC actually answers
/// (tolerating the "still starting up" phase). Returns the pid.
pub fn start_daemon(
    divid: &Path,
    datadir: &Path,
    rpc: &RpcClient,
    timeout: Duration,
) -> Result<i32, String> {
    if let Some(pid) = daemon_pid(datadir) {
        return Err(format!("a node is already running (pid {pid})"));
    }
    // The daemon's startup complaints are gold when something goes wrong —
    // capture them instead of letting them scroll away (or vanish).
    let spawn_log_path = datadir.join("dd69-spawn.log");
    let spawn_log = std::fs::File::create(&spawn_log_path)
        .map_err(|e| format!("cannot write in {}: {}", datadir.display(), e))?;
    let spawn_log_err = spawn_log.try_clone().map_err(|e| e.to_string())?;
    std::process::Command::new(divid)
        .arg(format!("-conf={}", datadir.join("divi.conf").display()))
        .arg(format!("-datadir={}/", datadir.display()))
        .stdout(spawn_log)
        .stderr(spawn_log_err)
        .spawn()
        .map_err(|e| format!("could not launch {}: {}", divid.display(), e))?;
    let started = Instant::now();
    while started.elapsed() < timeout {
        if rpc.call("getblockcount", serde_json::json!([])).is_ok() {
            return daemon_pid(datadir).ok_or_else(|| "node answered RPC but wrote no pid file".into());
        }
        // If the daemon printed a fatal complaint and died, say so now
        // rather than waiting out the full timeout.
        if daemon_pid(datadir).is_none() && started.elapsed() > Duration::from_secs(10) {
            let said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
            if let Some(line) = said.lines().find(|l| l.contains("Error:")) {
                return Err(format!("the node refused to start: {}", line.trim()));
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    let said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
    let hint = said
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("no output")
        .trim()
        .to_string();
    Err(format!(
        "node did not become ready within {}s (its last words: {})",
        timeout.as_secs(),
        hint
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
