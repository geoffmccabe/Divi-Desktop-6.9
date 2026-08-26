//! Starting the App Builder service with the wallet.
//!
//! The builder needs a small Node process running beside the wallet. Asking
//! somebody to open a terminal and run a command is not a feature, it is
//! homework, and it is not how this gets tested. So the wallet starts it.
//!
//! Two things make this less obvious than it looks:
//!
//! * **A window app on macOS does not inherit your shell's PATH.** Launched
//!   from Finder or the Dock, `node` is simply not found, even though it works
//!   perfectly in a terminal. So the usual install locations are searched
//!   directly rather than trusting PATH.
//! * **The service files have to be somewhere.** Today they live in the repo,
//!   which is right for a machine that has the repo and wrong for a shipped
//!   build. The candidate list below says exactly where it looked, so when it
//!   cannot find them the panel can say so instead of showing a mystery.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// The running service, if we started one. Held so it can be stopped again.
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// Why it is not running, when it is not.
static TROUBLE: Mutex<Option<String>> = Mutex::new(None);

/// Opening credit for a new account: 20,000 points is $20 of build time.
///
/// ⚠ This is for testing. Every account seen for the first time is given it,
/// once, recorded in the ledger like any other movement. It must be removed
/// before this service is reachable by anybody else.
const WELCOME_POINTS: &str = "20000";

/// Where Node gets installed. PATH is not usable from a windowed app.
const NODE_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    "/opt/homebrew/opt/node/bin/node",
    "C:\\Program Files\\nodejs\\node.exe",
];

fn find_node() -> Option<PathBuf> {
    for c in NODE_CANDIDATES {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Some(p);
        }
    }
    // A version manager puts it somewhere unpredictable; ask the login shell,
    // which is the only thing that knows.
    #[cfg(unix)]
    {
        if let Ok(out) = Command::new("/bin/sh")
            .args(["-lc", "command -v node"])
            .output()
        {
            let found = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !found.is_empty() && Path::new(&found).is_file() {
                return Some(PathBuf::from(found));
            }
        }
    }
    None
}

/// Where the service's own files might be, most specific first.
fn find_service_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Beside the binary, for a build that bundles it as a resource.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("app-builder"));
            // target/release/<exe> -> repo root
            candidates.push(dir.join("../../contrib/app-builder"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join("Divi-Desktop-6.9/contrib/app-builder"));
    }

    candidates
        .into_iter()
        .find(|c| c.join("src/server.mjs").is_file())
}

/// Start it, unless it is already running or something is genuinely missing.
///
/// Never panics and never blocks the window opening: anything that goes wrong
/// is recorded and reported through `builder_service_status`.
pub fn start() {
    let mut child = CHILD.lock().unwrap();
    if let Some(existing) = child.as_mut() {
        // Still alive? Leave it be.
        if matches!(existing.try_wait(), Ok(None)) {
            return;
        }
    }

    let Some(node) = find_node() else {
        *TROUBLE.lock().unwrap() = Some(
            "Node is not installed on this machine, and the App Builder service needs it.".into(),
        );
        return;
    };
    let Some(dir) = find_service_dir() else {
        *TROUBLE.lock().unwrap() =
            Some("The App Builder service files could not be found on this machine.".into());
        return;
    };

    let log = dd69_supervisor::config::dd69_datadir().join("app-builder.log");
    let _ = std::fs::create_dir_all(log.parent().unwrap_or(Path::new(".")));
    let out = std::fs::File::create(&log).ok();
    let err = out.as_ref().and_then(|f| f.try_clone().ok());

    let mut cmd = Command::new(node);
    cmd.arg("src/server.mjs")
        .current_dir(&dir)
        .env("BUILDER_WELCOME_POINTS", WELCOME_POINTS)
        .stdin(Stdio::null());
    if let (Some(out), Some(err)) = (out, err) {
        cmd.stdout(out).stderr(err);
    }
    // On Windows this would otherwise flash a console window.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(c) => {
            *child = Some(c);
            *TROUBLE.lock().unwrap() = None;
        }
        Err(e) => {
            *TROUBLE.lock().unwrap() = Some(format!("The App Builder service would not start: {e}"));
        }
    }
}

/// Stop it when the wallet closes, so a service is not left running unattended.
pub fn stop() {
    if let Some(mut c) = CHILD.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

#[derive(serde::Serialize)]
pub struct BuilderServiceStatus {
    /// We started it and it has not exited.
    pub running: bool,
    /// A sentence for the panel when it is not running, otherwise null.
    pub trouble: Option<String>,
    /// Where its output goes, so a problem can actually be looked at.
    pub log: String,
}

#[tauri::command]
pub fn builder_service_status() -> BuilderServiceStatus {
    let mut child = CHILD.lock().unwrap();
    let running = match child.as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        None => false,
    };
    BuilderServiceStatus {
        running,
        trouble: if running { None } else { TROUBLE.lock().unwrap().clone() },
        log: dd69_supervisor::config::dd69_datadir()
            .join("app-builder.log")
            .display()
            .to_string(),
    }
}

/// Ask for it to be started again, after Node was installed or a crash.
#[tauri::command]
pub fn builder_service_restart() -> BuilderServiceStatus {
    stop();
    start();
    builder_service_status()
}
