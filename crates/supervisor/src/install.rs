//! First-run installation of our own daemon, `divid69`.
//!
//! DD69 does not bundle a daemon. Shipping one would add megabytes to every
//! app update for a file that changes on a different schedule, and the old
//! Divi Desktop habit of unpacking a stock `divid` is exactly what we are
//! moving away from: `divid69` is built from our refactored core, not from
//! upstream v3.0.0.
//!
//! The daemon holds the user's private keys. That makes an unverified download
//! unacceptable, so the archive's SHA-256 is pinned here at build time and
//! checked before anything is written to its final location or made
//! executable. A mismatch is a hard failure, never a warning: we would rather
//! leave the user with no node than with a substituted one.

use std::io::Read;
use std::path::{Path, PathBuf};

/// Bumped whenever a new daemon build is published. Also used as the stamp
/// filename, so an upgrade is detected simply by the stamp not being there.
pub const DIVID69_VERSION: &str = "69.0.1";

const BASE_URL: &str = "https://scan.divi.love/downloads";

/// Known-live Divi peers harvested from the network, written into a fresh
/// node's divi.conf so it connects on the first try. This is a bootstrap
/// aid only; the node builds its own peer database after connecting once.
const SEED_PEERS: &[&str] = &[
    "104.168.43.240",
    "104.223.27.104",
    "107.161.83.106",
    "107.172.21.13",
    "107.173.2.10",
    "107.174.226.101",
    "107.175.87.211",
    "116.203.64.121",
    "15.204.247.193",
    "167.160.191.142",
    "172.245.228.178",
    "188.245.61.6",
    "192.210.248.47",
    "192.227.194.191",
    "192.3.86.223",
    "198.12.74.110",
    "198.23.224.242",
    "198.46.232.135",
    "204.152.193.22",
    "204.44.70.163",
    "213.136.69.210",
    "216.144.229.195",
    "216.45.61.244",
    "54.197.42.63",
    "64.23.136.158",
    "94.130.151.81",
];


/// Archive name and its pinned SHA-256, per platform. A platform with no entry
/// simply has no managed daemon yet and falls back to whatever is on the
/// system.
struct Artifact {
    file: &'static str,
    sha256: &'static str,
}

fn artifact() -> Option<Artifact> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some(Artifact {
        file: "divid69-macos-arm64.tar.gz",
        sha256: "4529dea8fa246fbf333c61d2ccbbaffdde5108adebf51d1c886592bfc0e9e634",
    });

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some(Artifact {
        file: "divid69-linux-x86_64.tar.gz",
        sha256: "04d3fe12ea4008224ecceab37376c5575cef74ab7e243add99ce8e63461651c2",
    });

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    return None;
}

/// Where our managed daemon lives. Deliberately under `DD69/`, not the old
/// `Divi Desktop/` tree, so ours and Divi Desktop 2.0's copies never collide.
pub fn managed_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    #[cfg(target_os = "macos")]
    return Some(PathBuf::from(home).join("Library/Application Support/DD69/divid/unpacked"));
    #[cfg(not(target_os = "macos"))]
    return Some(PathBuf::from(home).join(".local/share/DD69/divid/unpacked"));
}

/// Full path to the managed daemon, whether or not it is installed yet.
pub fn managed_divid() -> Option<PathBuf> {
    Some(managed_dir()?.join("divid69"))
}

/// True when the managed daemon is present at the version we expect. The stamp
/// is written only after a successful, verified install, so a half-finished
/// download can never look complete.
pub fn is_installed() -> bool {
    let Some(dir) = managed_dir() else { return false };
    dir.join("divid69").is_file() && dir.join(format!(".installed-{DIVID69_VERSION}")).is_file()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Download, verify and unpack `divid69`. Returns the path to the daemon.
///
/// `progress` is called with short human-readable stages so the UI can show
/// what is happening; a first run downloads a couple of megabytes and the user
/// should not be staring at a frozen window.
pub fn ensure_divid69(progress: impl Fn(&str)) -> Result<PathBuf, String> {
    let dir = managed_dir().ok_or("no home directory")?;
    let target = dir.join("divid69");
    if is_installed() {
        return Ok(target);
    }
    let art = artifact()
        .ok_or("no divid69 build is published for this platform yet")?;
    if art.sha256 == "PENDING_LINUX_BUILD" {
        return Err("no divid69 build is published for this platform yet".into());
    }

    let url = format!("{BASE_URL}/{}", art.file);
    progress("Downloading node software…");
    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("could not download the node software: {e}"))?;
    let mut bytes: Vec<u8> = Vec::with_capacity(4 << 20);
    resp.into_reader()
        .take(64 << 20) // a sane ceiling; the real archive is a few MB
        .read_to_end(&mut bytes)
        .map_err(|e| format!("download was interrupted: {e}"))?;

    progress("Verifying…");
    let got = sha256_hex(&bytes);
    if got != art.sha256 {
        // Not a warning. A daemon that does not match the pinned hash is not
        // ours, and it would be handed the user's wallet.
        return Err(format!(
            "the downloaded node software did not match its expected checksum \
             (expected {}, got {}). Nothing was installed.",
            art.sha256, got
        ));
    }

    progress("Installing…");
    // Unpack beside the target and swap in, so an interrupted extraction never
    // leaves a partial binary at the path the supervisor will try to launch.
    let staging = dir.with_extension("incoming");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("cannot create {}: {e}", staging.display()))?;
    let archive = staging.join(art.file);
    std::fs::write(&archive, &bytes).map_err(|e| format!("cannot write the download: {e}"))?;

    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .status()
        .map_err(|e| format!("could not unpack the node software: {e}"))?;
    if !status.success() {
        return Err("the node software archive could not be unpacked".into());
    }
    let _ = std::fs::remove_file(&archive);

    let unpacked = staging.join("divid69");
    if !unpacked.is_file() {
        return Err("the archive did not contain divid69".into());
    }
    make_executable(&unpacked)?;
    if let Ok(cli) = std::fs::metadata(staging.join("divi69-cli")) {
        let _ = cli; // present in our archives; ignore if a future one omits it
        make_executable(&staging.join("divi69-cli"))?;
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    for name in ["divid69", "divi69-cli"] {
        let from = staging.join(name);
        if from.is_file() {
            let to = dir.join(name);
            let _ = std::fs::remove_file(&to);
            std::fs::rename(&from, &to).map_err(|e| format!("cannot install {name}: {e}"))?;
        }
    }
    let _ = std::fs::remove_dir_all(&staging);

    // macOS quarantines anything downloaded by a normal HTTP client. Clearing
    // it here is what stops Gatekeeper killing the daemon on first launch;
    // the user never sees a dialog for a file they never opened themselves.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(&dir)
            .status();
    }

    std::fs::write(dir.join(format!(".installed-{DIVID69_VERSION}")), art.sha256)
        .map_err(|e| format!("cannot record the install: {e}"))?;
    progress("Node software ready.");
    Ok(target)
}

/// Create the data directory and a `divi.conf` if the user has neither.
///
/// Without this a first-time user has a daemon but no credentials for it, and
/// every RPC call fails with "no rpcuser/rpcpassword". The password is 32 bytes
/// of kernel randomness, written to a file only the user can read: it guards
/// local access to a wallet, so a memorable-but-guessable value would be worse
/// than useless.
///
/// An existing `divi.conf` is never touched. Someone who already runs a node
/// has their own settings and we have no business rewriting them.
pub fn ensure_local_node_conf() -> Result<PathBuf, String> {
    let datadir = crate::config::default_datadir();
    let conf = datadir.join("divi.conf");
    if conf.is_file() {
        return Ok(datadir);
    }
    std::fs::create_dir_all(&datadir)
        .map_err(|e| format!("cannot create {}: {e}", datadir.display()))?;

    let pass = random_hex_32()?;
    // rpcthreads is raised from the stock 4 deliberately. With only four, a
    // burst of concurrent calls makes the node stop answering entirely and it
    // looks dead while it is in fact healthy — a failure we have already hit
    // in production once.
    let mut body = format!(
        "# Written by DD69 on first run. Edit freely; DD69 will not rewrite it.\n\
         rpcuser=dd69\n\
         rpcpassword={pass}\n\
         rpcport=51473\n\
         rpcallowip=127.0.0.1\n\
         server=1\n\
         listen=1\n\
         rpcthreads=16\n"
    );
    // A brand-new node has an empty peer database and would otherwise depend on
    // the DNS seeder to find its first peers. That seeder has proven unreliable,
    // so we hand the node a set of known-live peers to connect to immediately.
    // It only needs one of these to work once; after that the node saves its own
    // peer database and never relies on this list again.
    body.push_str("\n# Known-live peers, so a fresh node connects without waiting on DNS seeds.\n");
    for ip in SEED_PEERS {
        body.push_str("addnode=");
        body.push_str(ip);
        body.push('\n');
    }
    std::fs::write(&conf, body).map_err(|e| format!("cannot write divi.conf: {e}"))?;
    restrict_to_owner(&conf);
    Ok(datadir)
}

/// 32 bytes of kernel randomness as hex. `/dev/urandom` is used directly rather
/// than pulling in an RNG crate for one call.
fn random_hex_32() -> Result<String, String> {
    let mut buf = [0u8; 32];
    let mut f = std::fs::File::open("/dev/urandom")
        .map_err(|e| format!("no source of randomness: {e}"))?;
    f.read_exact(&mut buf)
        .map_err(|e| format!("could not read randomness: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// The RPC password is in this file, so keep it out of other users' reach.
fn restrict_to_owner(p: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(p) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(p, perms);
        }
    }
}

/// The whole first-launch sequence, so a person who has never run Divi can
/// install the app, open it, and end up with a syncing node without doing
/// anything technical:
///
///   1. if the active node is a remote one the user chose, do nothing — they
///      are deliberately using someone else's node, not this machine's;
///   2. write a divi.conf (with credentials and the seed-peer list) if absent;
///   3. download and checksum-verify divid69 if it is not already installed;
///   4. launch the node, repairing the block database if last time was dirty.
///
/// `progress` reports short human stages for the UI. Every step is idempotent,
/// so this is safe to call on every launch: once the conf exists and the daemon
/// is installed and running, it returns almost immediately.
pub fn first_run_bringup(progress: impl Fn(&str)) -> Result<i32, String> {
    use crate::config::NodeConfig;
    use crate::process;
    use crate::rpc::RpcClient;
    use std::time::Duration;

    // If a remote node is already selected and reachable, respect that choice.
    if let Ok(cfg) = NodeConfig::load() {
        if cfg.remote {
            return Err("using a remote node; not starting a local one".into());
        }
    }

    progress("Preparing your node…");
    ensure_local_node_conf()?;
    let divid = ensure_divid69(&progress)?;

    // Reload now that the conf exists, so we have real RPC credentials.
    let cfg = NodeConfig::load().map_err(|e| format!("could not read the node settings: {e}"))?;
    let rpc = RpcClient::new(&cfg);

    // Prefer our freshly installed divid69, falling back to whatever find_divid
    // turns up if for some reason the managed copy is not where we expect.
    let bin = if divid.is_file() {
        divid
    } else {
        process::find_divid(None)?
    };

    progress("Starting the node…");
    let report = process::start_with_recovery(
        &bin,
        &cfg.datadir,
        &rpc,
        Duration::from_secs(180),
        Duration::from_secs(1800),
    )?;
    progress("Node is running.");
    Ok(report.pid)
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
