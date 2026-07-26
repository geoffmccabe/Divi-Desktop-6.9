//! Reading C2PA "Content Credentials" out of a file — via an on-demand helper.
//!
//! The actual C2PA SDK is a large dependency (image parsers, XMP/JUMBF, X.509),
//! so it is NOT compiled into DD69. It lives in a separate `c2pa-helper` binary
//! that this module downloads on first use, verifies against a pinned SHA-256,
//! caches, and then runs as a child process. Result: the app's own download
//! stays small, and the heavy part is fetched only if someone actually checks a
//! file's credentials.
//!
//! This is the READ half only — we verify what someone else signed. We do not
//! create or sign manifests, and the wording in the UI must not imply we do. The
//! helper is built without remote-manifest fetching, so reading a file never
//! touches the network; the only network use here is the one-time helper
//! download, which is checksum-pinned exactly like the daemon installer.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Mirrors the JSON the helper prints. Field names are the helper's snake_case
/// keys, parsed out by hand so this module needs no serde derive.
#[derive(Debug, Clone, Default)]
pub struct C2paSummary {
    pub present: bool,
    pub state: String,
    pub signer: Option<String>,
    pub generator: Option<String>,
    pub signed_at: Option<String>,
    pub title: Option<String>,
    pub assertions: Vec<String>,
    pub ingredients: usize,
    pub issues: Vec<String>,
    pub divi_txid: Option<String>,
    pub json: String,
}

/// The reverse-domain label a Divi anchor uses inside a manifest. Kept here too
/// so callers that don't spawn the helper still have the constant.
pub const DIVI_POE_LABEL: &str = "org.divi.poe";

const BASE_URL: &str = "https://scan.divi.love/downloads";

/// Bumped whenever a new helper build is published. Also the stamp filename, so
/// an upgrade is detected simply by the stamp not being there.
pub const C2PA_HELPER_VERSION: &str = "0.1.0";

struct Artifact {
    file: &'static str,
    sha256: &'static str,
}

/// Per-platform archive + its pinned SHA-256. `PENDING_*` means no build has
/// been published for that platform yet, which surfaces as a clear "not
/// available on this platform" message rather than a failed download.
fn artifact() -> Option<Artifact> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some(Artifact {
        file: "c2pa-helper-macos-arm64.tar.gz",
        sha256: "PENDING_MACOS_ARM64",
    });

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some(Artifact {
        file: "c2pa-helper-linux-x86_64.tar.gz",
        sha256: "PENDING_LINUX_X86_64",
    });

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    return None;
}

/// Where the cached helper lives. Under `DD69/`, like the managed daemon, so it
/// never collides with Divi Desktop 2.0's tree.
fn managed_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    #[cfg(target_os = "macos")]
    return Some(PathBuf::from(home).join("Library/Application Support/DD69/c2pa/unpacked"));
    #[cfg(not(target_os = "macos"))]
    return Some(PathBuf::from(home).join(".local/share/DD69/c2pa/unpacked"));
}

fn is_installed(dir: &Path) -> bool {
    dir.join("c2pa-helper").is_file()
        && dir.join(format!(".installed-{C2PA_HELPER_VERSION}")).is_file()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Ensure the helper binary is present and verified, returning its path.
///
/// A development/local override skips the download entirely: set
/// `DIVI_C2PA_HELPER` to the path of a freshly built helper. This is how the
/// spawn path is tested before any archive is hosted.
fn ensure_helper() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("DIVI_C2PA_HELPER") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!("DIVI_C2PA_HELPER points at {}, which is not a file", p.display()));
    }

    let dir = managed_dir().ok_or("no home directory")?;
    let target = dir.join("c2pa-helper");
    if is_installed(&dir) {
        return Ok(target);
    }

    let art = artifact().ok_or(
        "reading Content Credentials isn't available on this platform yet",
    )?;
    if art.sha256.starts_with("PENDING_") {
        return Err("reading Content Credentials isn't available on this platform yet".into());
    }

    let url = format!("{BASE_URL}/{}", art.file);
    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("could not download the credentials reader: {e}"))?;
    let mut bytes: Vec<u8> = Vec::with_capacity(12 << 20);
    resp.into_reader()
        .take(64 << 20)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("download was interrupted: {e}"))?;

    let got = sha256_hex(&bytes);
    if got != art.sha256 {
        // A mismatch means the file is not the one we published. Never a warning.
        return Err(format!(
            "the downloaded credentials reader did not match its expected checksum \
             (expected {}, got {}). Nothing was installed.",
            art.sha256, got
        ));
    }

    // Unpack into a staging dir and swap in, so an interrupted extraction never
    // leaves a partial binary where we will try to run it.
    let staging = dir.with_extension("incoming");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("cannot create {}: {e}", staging.display()))?;
    let archive = staging.join(art.file);
    std::fs::write(&archive, &bytes).map_err(|e| format!("cannot write the download: {e}"))?;

    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .status()
        .map_err(|e| format!("could not unpack the credentials reader: {e}"))?;
    if !status.success() {
        return Err("the credentials reader archive could not be unpacked".into());
    }
    let _ = std::fs::remove_file(&archive);

    let unpacked = staging.join("c2pa-helper");
    if !unpacked.is_file() {
        return Err("the archive did not contain c2pa-helper".into());
    }
    make_executable(&unpacked)?;

    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let _ = std::fs::remove_file(&target);
    std::fs::rename(&unpacked, &target).map_err(|e| format!("cannot install the reader: {e}"))?;
    let _ = std::fs::remove_dir_all(&staging);

    // macOS quarantines anything downloaded by a normal HTTP client; clearing it
    // stops Gatekeeper blocking a helper the user never opened themselves.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(&dir)
            .status();
    }

    std::fs::write(dir.join(format!(".installed-{C2PA_HELPER_VERSION}")), art.sha256)
        .map_err(|e| format!("cannot record the install: {e}"))?;
    Ok(target)
}

/// Read credentials from raw file bytes. `format` is the file extension or MIME
/// type. Ensures the helper (downloading it once if needed), runs it, and parses
/// its JSON output. Ok(summary with present=false) means the file simply has no
/// credentials, which is not an error — most files don't.
pub fn read(bytes: Vec<u8>, format: &str) -> Result<C2paSummary, String> {
    let helper = ensure_helper()?;

    let mut child = std::process::Command::new(&helper)
        .arg(format)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the credentials reader: {e}"))?;

    // Feed the file to the child on a separate thread while we read its output,
    // so a large file can never deadlock by filling the stdin pipe before the
    // child starts draining it.
    let mut stdin = child.stdin.take().ok_or("no stdin pipe to the reader")?;
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&bytes);
        // Dropping stdin here signals EOF to the child.
    });

    let output = child
        .wait_with_output()
        .map_err(|e| format!("the credentials reader failed: {e}"))?;
    let _ = writer.join();

    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr);
        let msg = msg.trim();
        return Err(if msg.is_empty() {
            "the credentials reader failed".to_string()
        } else {
            msg.to_string()
        });
    }

    let v: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("the credentials reader returned unreadable output: {e}"))?;

    Ok(C2paSummary {
        present: v["present"].as_bool().unwrap_or(false),
        state: v["state"].as_str().unwrap_or("").to_string(),
        signer: v["signer"].as_str().map(str::to_string),
        generator: v["generator"].as_str().map(str::to_string),
        signed_at: v["signed_at"].as_str().map(str::to_string),
        title: v["title"].as_str().map(str::to_string),
        assertions: v["assertions"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        ingredients: v["ingredients"].as_u64().unwrap_or(0) as usize,
        issues: v["issues"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        divi_txid: v["divi_txid"].as_str().map(str::to_string),
        json: v["json"].as_str().unwrap_or("").to_string(),
    })
}

fn make_executable(p: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(p)
            .map_err(|e| format!("cannot read {}: {e}", p.display()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(p, perms)
            .map_err(|e| format!("cannot make {} executable: {e}", p.display()))?;
    }
    Ok(())
}
