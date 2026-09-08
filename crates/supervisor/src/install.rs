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

    // Windows x86_64: packaged the same way (.tar.gz, which Windows 10+ extracts
    // with its built-in tar). The checksum is PENDING until the divid69.exe build
    // is published; ensure_divid69 fails cleanly with a clear message until the
    // real hash is pinned here.
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some(Artifact {
        file: "divid69-windows-x86_64.tar.gz",
        sha256: "PENDING_WINDOWS_BUILD",
    });

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    return None;
}

/// Where our managed daemon lives. Deliberately under `DD69/`, not the old
/// `Divi Desktop/` tree, so ours and Divi Desktop 2.0's copies never collide.
pub fn managed_dir() -> Option<PathBuf> {
    // Windows keeps app data under %APPDATA% (HOME is usually unset there),
    // matching the %APPDATA%\DD69 layout used in config.rs. macOS and Linux
    // key off HOME as before.
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        return Some(PathBuf::from(appdata).join("DD69").join("divid").join("unpacked"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        #[cfg(target_os = "macos")]
        return Some(PathBuf::from(home).join("Library/Application Support/DD69/divid/unpacked"));
        #[cfg(not(target_os = "macos"))]
        return Some(PathBuf::from(home).join(".local/share/DD69/divid/unpacked"));
    }
}

/// The daemon and CLI file names for this platform. Windows executables need
/// the `.exe` suffix; Unix builds have none.
fn managed_names() -> [&'static str; 2] {
    if cfg!(windows) {
        ["divid69.exe", "divi69-cli.exe"]
    } else {
        ["divid69", "divi69-cli"]
    }
}

/// Full path to the managed daemon, whether or not it is installed yet.
pub fn managed_divid() -> Option<PathBuf> {
    Some(managed_dir()?.join(managed_names()[0]))
}

/// True when the managed daemon is present at the version we expect. The stamp
/// is written only after a successful, verified install, so a half-finished
/// download can never look complete.
pub fn is_installed() -> bool {
    let Some(dir) = managed_dir() else { return false };
    dir.join(managed_names()[0]).is_file() && dir.join(format!(".installed-{DIVID69_VERSION}")).is_file()
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
    use crate::setuplog;
    let dir = managed_dir().ok_or("no home directory")?;
    let target = dir.join("divid69");
    if is_installed() {
        setuplog::log(format!(
            "node software: already installed (version {DIVID69_VERSION}) at {} — skipping download",
            target.display()
        ));
        return Ok(target);
    }
    let art = match artifact() {
        Some(a) => a,
        None => {
            setuplog::log(format!(
                "node software: NO build published for this platform ({} {}). This platform cannot \
                 run a managed node yet.",
                std::env::consts::OS,
                std::env::consts::ARCH
            ));
            return Err("no divid69 build is published for this platform yet".into());
        }
    };
    if art.sha256.starts_with("PENDING_") {
        setuplog::log(format!(
            "node software: build for this platform ({} {}) is PENDING (no published binary / \
             checksum yet) — cannot install a node here.",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        return Err("no divid69 build is published for this platform yet".into());
    }

    let url = format!("{BASE_URL}/{}", art.file);
    setuplog::log(format!("node software: downloading {url}"));
    setuplog::log(format!("node software: expected checksum {}", art.sha256));
    let t0 = std::time::Instant::now();
    progress("Downloading node software…");
    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| {
            setuplog::log(format!("node software: DOWNLOAD FAILED — {e}"));
            format!("could not download the node software: {e}")
        })?;
    let mut bytes: Vec<u8> = Vec::with_capacity(4 << 20);
    resp.into_reader()
        .take(64 << 20) // a sane ceiling; the real archive is a few MB
        .read_to_end(&mut bytes)
        .map_err(|e| {
            setuplog::log(format!("node software: DOWNLOAD INTERRUPTED — {e}"));
            format!("download was interrupted: {e}")
        })?;
    setuplog::log(format!(
        "node software: downloaded {} bytes in {:.1}s",
        bytes.len(),
        t0.elapsed().as_secs_f64()
    ));

    progress("Verifying…");
    let got = sha256_hex(&bytes);
    if got != art.sha256 {
        setuplog::log(format!(
            "node software: CHECKSUM MISMATCH — expected {}, got {}. Nothing installed.",
            art.sha256, got
        ));
        // Not a warning. A daemon that does not match the pinned hash is not
        // ours, and it would be handed the user's wallet.
        return Err(format!(
            "the downloaded node software did not match its expected checksum \
             (expected {}, got {}). Nothing was installed.",
            art.sha256, got
        ));
    }

    setuplog::log("node software: checksum verified OK");
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
        .map_err(|e| {
            setuplog::log(format!("node software: could not run tar to unpack — {e}"));
            format!("could not unpack the node software: {e}")
        })?;
    if !status.success() {
        setuplog::log("node software: UNPACK FAILED (tar returned an error)");
        return Err("the node software archive could not be unpacked".into());
    }
    let _ = std::fs::remove_file(&archive);

    let [daemon_name, cli_name] = managed_names();
    let unpacked = staging.join(daemon_name);
    if !unpacked.is_file() {
        setuplog::log(format!("node software: archive did not contain {daemon_name}"));
        return Err("the archive did not contain divid69".into());
    }
    setuplog::log("node software: unpacked OK");
    make_executable(&unpacked)?;
    if let Ok(cli) = std::fs::metadata(staging.join(cli_name)) {
        let _ = cli; // present in our archives; ignore if a future one omits it
        make_executable(&staging.join(cli_name))?;
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    for name in managed_names() {
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
        let out = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(&dir)
            .status();
        match out {
            Ok(s) if s.success() => setuplog::log("node software: cleared macOS quarantine flag"),
            Ok(s) => setuplog::log(format!(
                "node software: quarantine-clear returned {s} (Gatekeeper may still block launch)"
            )),
            Err(e) => setuplog::log(format!("node software: could not run xattr to clear quarantine — {e}")),
        }
    }

    std::fs::write(dir.join(format!(".installed-{DIVID69_VERSION}")), art.sha256)
        .map_err(|e| {
            setuplog::log(format!("node software: could not record the install stamp — {e}"));
            format!("cannot record the install: {e}")
        })?;
    setuplog::log(format!(
        "node software: install complete (version {DIVID69_VERSION}) at {}",
        target.display()
    ));
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
    let datadir = crate::config::dd69_datadir();
    let conf = datadir.join("divi.conf");
    if conf.is_file() {
        // One-time repairs to confs WE wrote (never anyone else's node):
        //   1. 69.0.1 included an rpcallowip line that made the RPC port listen
        //      on every interface instead of loopback only — strip it.
        //   2. Turn on addressindex if it isn't already, so the node can report
        //      balances/UTXOs for addresses the user doesn't own (the
        //      Foundation/Charity treasury display, multisig wallets, and the
        //      governance stake snapshot). Enabling it on an already-synced node
        //      makes divid ask for a one-time -reindex; start_with_recovery
        //      detects that and runs it automatically. Takes effect on the
        //      node's next restart.
        if let Ok(text) = std::fs::read_to_string(&conf) {
            let ours = text.contains("Written by DD69");
            let has_allowip = text
                .lines()
                .any(|l| l.trim_start().starts_with("rpcallowip="));
            let has_addressindex = text
                .lines()
                .any(|l| l.trim_start().starts_with("addressindex="));
            //   3. rpcthreads below 16 (the stock 4, or a hand-edit) makes the
            //      node stop answering under a burst of concurrent calls — it
            //      looks dead while healthy (see the first-run template below).
            //      Normalise anything under 16 up to 16; leave a higher value be.
            let has_threads = text.lines().any(|l| l.trim_start().starts_with("rpcthreads="));
            let weak_threads = text.lines().any(|l| {
                l.trim_start()
                    .strip_prefix("rpcthreads=")
                    .and_then(|v| v.trim().parse::<u32>().ok())
                    .map(|n| n < 16)
                    .unwrap_or(false)
            });
            let fix_threads = !has_threads || weak_threads;
            if ours && (has_allowip || !has_addressindex || fix_threads) {
                let mut fixed: String = text
                    .lines()
                    .filter(|l| !l.trim_start().starts_with("rpcallowip="))
                    .filter(|l| !(fix_threads && l.trim_start().starts_with("rpcthreads=")))
                    .map(|l| format!("{l}\n"))
                    .collect();
                if !has_addressindex {
                    fixed.push_str("addressindex=1\n");
                }
                if fix_threads {
                    fixed.push_str("rpcthreads=16\n");
                }
                let _ = std::fs::write(&conf, fixed);
                restrict_to_owner(&conf);
                crate::setuplog::log("node settings: repaired existing divi.conf (updated one or more of: rpcallowip removed, addressindex, rpcthreads)");
            } else {
                crate::setuplog::log("node settings: existing divi.conf is already correct");
            }
        }
        return Ok(datadir);
    }
    crate::setuplog::log(format!("node settings: creating a new divi.conf in {}", datadir.display()));
    std::fs::create_dir_all(&datadir)
        .map_err(|e| format!("cannot create {}: {e}", datadir.display()))?;

    let pass = random_hex_32()?;
    // rpcthreads is raised from the stock 4 deliberately. With only four, a
    // burst of concurrent calls makes the node stop answering entirely and it
    // looks dead while it is in fact healthy — a failure we have already hit
    // in production once.
    //
    // There is deliberately NO rpcallowip here. In this codebase's RPC server,
    // setting rpcallowip — even to 127.0.0.1 — flips the listener from
    // loopback-only to all interfaces, leaving the allow-list as the only
    // barrier between the LAN and a wallet's RPC port. Omitting it makes the
    // daemon bind to loopback and nothing else, so the port is simply not
    // reachable from the network at all.
    //
    // maxconnections keeps a home user from becoming a 125-peer relay hub on
    // their own bandwidth; 32 is plenty for fast sync and good citizenship.
    let mut body = format!(
        "# Written by DD69 on first run. Edit freely; DD69 will not rewrite it.\n\
         rpcuser=dd69\n\
         rpcpassword={pass}\n\
         rpcport=51473\n\
         server=1\n\
         listen=1\n\
         rpcthreads=16\n\
         maxconnections=32\n\
         # addressindex lets the node report balances/UTXOs for ANY address, not\n\
         # just the wallet's own: the treasury + multisig displays and the\n\
         # governance stake snapshot all rely on it.\n\
         addressindex=1\n"
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
    crate::setuplog::log(format!(
        "node settings: new divi.conf written (credentials generated; {} seed peers seeded)",
        SEED_PEERS.len()
    ));
    Ok(datadir)
}

/// Free bytes available to us on the filesystem holding `path`.
#[cfg(unix)]
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    Some(s.f_bavail as u64 * s.f_frsize as u64)
}

#[cfg(not(unix))]
fn free_bytes(_path: &Path) -> Option<u64> {
    None // no Windows build yet; the guard simply doesn't gate there
}

/// Public wrapper so the setup flow can run the same free-space check.
pub fn free_bytes_public(path: &Path) -> Option<u64> {
    free_bytes(path)
}

/// 32 bytes of randomness from the OS CSPRNG, as hex. Uses `getrandom` (already
/// a dependency), so it works on Windows too — `/dev/urandom` does not exist
/// there, which previously made first-run node setup fail on Windows.
fn random_hex_32() -> Result<String, String> {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).map_err(|e| format!("no source of randomness: {e}"))?;
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
    use crate::setuplog;
    use std::time::Duration;

    setuplog::log("bringup: first-run sequence starting");

    // Test rig: when pointed at an external node (e.g. a regtest node via
    // DIVI_DATADIR), skip all node install/start so the app never touches the
    // mainnet datadir. Set DD69_SKIP_BRINGUP=1.
    if std::env::var("DD69_SKIP_BRINGUP").is_ok() {
        setuplog::log("bringup: skipped (DD69_SKIP_BRINGUP is set)");
        progress("bringup skipped (DD69_SKIP_BRINGUP)");
        return Ok(0);
    }

    // If a remote node is already selected and reachable, respect that choice.
    if let Ok(cfg) = NodeConfig::load() {
        if cfg.remote {
            setuplog::log("bringup: a remote node is selected — not starting a local node");
            return Err("using a remote node; not starting a local one".into());
        }
    }

    // We run our node in DD69's OWN datadir. If a divi.conf we did not write
    // is sitting there, some other installation owns that folder — starting our
    // daemon on it would take the datadir lock and two daemon builds alternating
    // over one block database is how databases get corrupted. So: hands off. If
    // that node is running, DD69 still reads it over RPC; we just never start,
    // stop, or rewrite anything of theirs. (This must check the folder the node
    // actually uses — dd69_datadir — not the legacy 2.0 DIVI folder, which DD69
    // no longer runs in; checking the wrong folder made the app wrongly back off
    // whenever a stale 2.0 config still existed on the machine.)
    let datadir = crate::config::dd69_datadir();
    let conf = datadir.join("divi.conf");
    let blocks_present = datadir.join("blocks").is_dir();
    if conf.is_file() {
        let ours = std::fs::read_to_string(&conf)
            .map(|t| t.contains("Written by DD69"))
            .unwrap_or(false);
        setuplog::log(format!(
            "bringup: existing divi.conf found in node folder (written by DD69: {ours}; \
             blockchain data present: {blocks_present})"
        ));
        if !ours {
            setuplog::log(
                "bringup: this node folder belongs to another Divi installation — leaving it \
                 untouched and not starting our node",
            );
            return Err(
                "an existing Divi installation owns this datadir; leaving it untouched".into(),
            );
        }
    } else {
        setuplog::log(format!(
            "bringup: no divi.conf yet — treating as a FRESH install (blockchain data present: \
             {blocks_present})"
        ));
    }

    progress("Preparing your node…");
    setuplog::log("bringup: preparing node settings (divi.conf)…");
    ensure_local_node_conf().map_err(|e| {
        setuplog::log(format!("bringup: FAILED to write node settings — {e}"));
        e
    })?;
    setuplog::log("bringup: node settings ready");

    // A first sync writes the whole chain — about 9 GB today and growing. If
    // the disk can't hold it, refuse up front instead of filling their drive
    // to the brim and dying at 87%. An already-synced node needs only modest
    // headroom for new blocks.
    let fresh = !datadir.join("blocks").is_dir();
    let need_gb: u64 = if fresh { 15 } else { 3 };
    if let Some(free) = free_bytes(&datadir) {
        let free_gb = free / (1 << 30);
        setuplog::log(format!(
            "bringup: disk check — {free_gb} GB free, {need_gb} GB needed ({})",
            if fresh { "fresh sync" } else { "already have chain data" }
        ));
        if free_gb < need_gb {
            setuplog::log("bringup: NOT ENOUGH DISK — stopping before any download");
            return Err(format!(
                "not enough free disk space to run a node: {free_gb} GB free, \
                 at least {need_gb} GB needed. Nothing was downloaded."
            ));
        }
    } else {
        setuplog::log("bringup: disk check — could not read free space (continuing)");
    }

    let divid = ensure_divid69(&progress).map_err(|e| {
        setuplog::log(format!("bringup: node software not available — {e}"));
        e
    })?;

    // Reload now that the conf exists, so we have real RPC credentials.
    let cfg = NodeConfig::load().map_err(|e| {
        setuplog::log(format!("bringup: could not read node settings — {e}"));
        format!("could not read the node settings: {e}")
    })?;
    let rpc = RpcClient::new(&cfg);

    // Prefer our freshly installed divid69, falling back to whatever find_divid
    // turns up if for some reason the managed copy is not where we expect.
    let bin = if divid.is_file() {
        divid
    } else {
        setuplog::log("bringup: managed node binary missing — searching the system for one");
        process::find_divid(None).map_err(|e| {
            setuplog::log(format!("bringup: no node program found anywhere — {e}"));
            e
        })?
    };
    setuplog::log(format!("bringup: launching node program at {}", bin.display()));

    progress("Starting the node…");
    let report = process::start_with_recovery(
        &bin,
        &cfg.datadir,
        &rpc,
        Duration::from_secs(180),
        Duration::from_secs(1800),
    )
    .map_err(|e| {
        setuplog::log(format!("bringup: NODE FAILED TO START — {e}"));
        e
    })?;
    match &report.repaired_with {
        Some(what) => setuplog::log(format!(
            "bringup: node running (pid {}), after repair: {what}",
            report.pid
        )),
        None => setuplog::log(format!("bringup: node running (pid {})", report.pid)),
    }
    // Record the first peer count so a 'never connected' case is unambiguous in
    // the log: did the node come up but find zero peers, or fail to come up?
    if let Ok(v) = rpc.call("getconnectioncount", serde_json::json!([])) {
        setuplog::log(format!("bringup: peers connected so far: {v}"));
    }
    setuplog::log("bringup: first-run sequence finished OK");
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
