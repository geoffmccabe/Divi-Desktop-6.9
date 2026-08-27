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
//!
//! ## Whose key
//!
//! The model account belongs to the OPERATOR, and no user ever sees or supplies
//! a key — they pay in points instead. That is the whole commercial
//! arrangement: we hold the account, they pay for what they use at a markup.
//!
//! There are two ways to satisfy that, and the FIRST is preferred:
//!
//! 1. **The AI Gateway.** The key stays on the server; this passes a gateway
//!    token instead. That token is scoped to one service, can be revoked on its
//!    own, and losing it hands nobody an Anthropic account. It is also the only
//!    arrangement that works once other people are using this, because a
//!    desktop app cannot keep a shared secret.
//! 2. **A direct key**, from Admin → AI, for a machine with no gateway.
//!
//! An earlier version asked the person at the keyboard for a key in the App
//! Builder panel itself. That was backwards twice over: it made every user do
//! an operator's job, and anyone who complied would have paid Anthropic
//! directly AND been charged points for the same work.
//!
//! So the key goes straight from the OS keychain, where the admin panel put it,
//! into this child process's environment. It is never returned to the interface
//! and never written to a file.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// How this wallet reaches a model, in order of preference.
enum ModelAccess {
    /// The key stays on a server we run; this holds only a revocable token.
    Gateway { url: String, token: String },
    /// A key on this machine. Fine for one operator, wrong for many users.
    DirectKey(String),
    None,
}

/// Where the gateway's address is kept.
///
/// A URL is not a secret. Keeping it in the keychain bought no protection and
/// cost a permission prompt every time the app was rebuilt — two prompts, for
/// one secret.
pub fn gateway_url_path() -> PathBuf {
    dd69_supervisor::config::dd69_datadir().join("ai-gateway.txt")
}

pub fn read_gateway_url() -> Option<String> {
    std::fs::read_to_string(gateway_url_path())
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn write_gateway_url(url: &str) -> Result<(), String> {
    let path = gateway_url_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let url = url.trim();
    if url.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    std::fs::write(&path, url).map_err(|e| e.to_string())
}

fn model_access() -> ModelAccess {
    let secret = |name: &str| {
        dd69_supervisor::security::ai_get(name)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    // The URL first, from a plain file, so a wallet with no gateway configured
    // never touches the keychain at all and is never asked about it.
    if let Some(url) = read_gateway_url() {
        if let Some(token) = secret("gateway_token") {
            return ModelAccess::Gateway { url, token };
        }
    }
    match secret("claude") {
        Some(key) => ModelAccess::DirectKey(key),
        None => ModelAccess::None,
    }
}

/// Set the gateway address. Not a secret, so this is a plain command.
#[tauri::command]
pub fn set_gateway_url(url: String) -> Result<(), String> {
    write_gateway_url(&url)
}

#[tauri::command]
pub fn gateway_url() -> String {
    read_gateway_url().unwrap_or_default()
}

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
        // So it can stop itself if this wallet is killed rather than closed.
        // An orphan holding the port makes the next wallet look broken.
        .env("BUILDER_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null());

    // How this wallet reaches a model. Configured in Admin → AI, handed to the
    // child process and nowhere else: not to the interface, not to a file.
    match model_access() {
        ModelAccess::Gateway { url, token } => {
            cmd.env("BUILDER_PROVIDER", "gateway")
                .env("BUILDER_BASE_URL", url)
                .env("BUILDER_GATEWAY_TOKEN", token);
        }
        ModelAccess::DirectKey(key) => {
            cmd.env("BUILDER_PROVIDER", "anthropic")
                .env("ANTHROPIC_API_KEY", key);
        }
        ModelAccess::None => {
            *TROUBLE.lock().unwrap() = Some(
                "This wallet has no way to reach an AI yet. Add a Gateway, or an Anthropic key, in the gear menu under AI."
                    .into(),
            );
            // Still started: everything except building works, and the panel
            // can then say exactly what is missing rather than nothing at all.
        }
    }
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
            // A missing key is recorded above and must survive a successful
            // start, because the service runs fine without one — it just
            // cannot build anything.
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
    /// An operator key is configured, so building is possible.
    pub key_set: bool,
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
    let key_set = !matches!(model_access(), ModelAccess::None);
    BuilderServiceStatus {
        running,
        key_set,
        // A missing key is worth saying even when the service is up, because it
        // is the one thing stopping anything being built.
        trouble: if running && key_set { None } else { TROUBLE.lock().unwrap().clone() },
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
