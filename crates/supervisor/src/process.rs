use crate::rpc::RpcClient;
use std::path::Path;
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
