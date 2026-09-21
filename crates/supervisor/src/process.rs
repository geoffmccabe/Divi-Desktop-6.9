use crate::rpc::RpcClient;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Our own record of the node's process id.
///
/// ── WHY WE HAVE TO KEEP THIS OURSELVES ───────────────────────────────────
/// The node writes divid.pid only when it runs as a daemon, and Windows has
/// no daemon mode, so on Windows that file NEVER EXISTS. Everything that
/// asked "is the node running?" by looking for it therefore always got the
/// answer "no" -- while the node was running perfectly.
///
/// The damage that did, from Joseph's log of 2026-Sep-21 on 69.13.11: his
/// node started cleanly, opened all three databases, and began loading the
/// block index (a two-minute job). The wallet, unable to see a pid file,
/// logged "node process vanished" a hundred and twelve times, and the
/// watchdog concluded the node was not running and started a SECOND one.
/// The second could not take the data-directory lock the first was holding,
/// died with "Cannot obtain a lock on data directory", and tripped the
/// ChainstateManager assertion on its way out. That assertion -- the thing
/// we have chased for three days -- was this time entirely self-inflicted.
///
/// So we write down the id ourselves the moment we spawn it.
const OUR_PID_FILE: &str = "dd69-node.pid";

/// Record the id of a node we just started.
pub fn remember_pid(datadir: &Path, pid: i32) {
    let _ = std::fs::write(datadir.join(OUR_PID_FILE), pid.to_string());
}

/// Forget it once the node is known to be gone, so a recycled id can never
/// be mistaken for a running node.
pub fn forget_pid(datadir: &Path) {
    let _ = std::fs::remove_file(datadir.join(OUR_PID_FILE));
}

fn read_pid_file(path: &Path) -> Option<i32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// The daemon's pid, if it is actually alive (a stale pid file doesn't count).
///
/// Prefers the node's own divid.pid, which survives a restart of the wallet
/// and is written on the platforms that have a daemon mode; falls back to
/// the id we wrote down ourselves, which is all Windows ever has.
pub fn daemon_pid(datadir: &Path) -> Option<i32> {
    for name in ["divid.pid", OUR_PID_FILE] {
        if let Some(pid) = read_pid_file(&datadir.join(name)) {
            if pid_alive(pid) {
                return Some(pid);
            }
        }
    }
    None
}

fn pid_alive(pid: i32) -> bool {
    #[cfg(windows)]
    {
        // No `kill` on Windows; ask the task list whether the pid still exists.
        // `/NH /FO CSV` yields one quoted row per match, e.g. "divid69.exe","1234",...
        //
        // The image name is checked too, not just the number: process ids are
        // recycled, and mistaking some unrelated program for the node would
        // be worse than not finding it at all.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(o) => {
                let out = String::from_utf8_lossy(&o.stdout);
                out.contains(&format!("\"{pid}\"")) && out.to_lowercase().contains("divid")
            }
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        // Signal 0 = existence check only.
        std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Find a daemon to run, in order of preference:
///
///   1. an explicit path the user passed in,
///   2. our own `divid69`, installed by `install::ensure_divid69`,
///   3. any `divid` on PATH,
///   4. the copy Divi Desktop 2.0 unpacks on macOS,
///   5. `/usr/local/bin/divid`.
///
/// Ours comes before anything found on the system on purpose. A stock upstream
/// `divid` left on PATH by an older install would otherwise silently win, and
/// the whole point of `divid69` is that DD69 runs our refactored core rather
/// than v3.0.0.
pub fn find_divid(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = explicit {
        candidates.push(p);
    }
    if let Some(ours) = crate::install::managed_divid() {
        candidates.push(ours);
    }
    // Look on PATH: `where` on Windows, `which` on Unix. On Windows we look for
    // our own divid69.exe; on Unix a stock `divid` from an older install.
    let (finder, needle) = if cfg!(windows) {
        ("where", "divid69.exe")
    } else {
        ("which", "divid")
    };
    if let Ok(out) = std::process::Command::new(finder).arg(needle).output() {
        // `where` can return several lines; take the first.
        let p = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if !p.is_empty() {
            candidates.push(PathBuf::from(p));
        }
    }
    // Divi Desktop 2.0 unpacks its managed daemon under the user's home on macOS;
    // the exact layout has varied, so try both known shapes.
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        let base = PathBuf::from(home).join("Library/Application Support/Divi Desktop/divid/unpacked");
        candidates.push(base.join("divid"));
        candidates.push(base.join("divi_osx/divid"));
    }
    #[cfg(unix)]
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
    /// A config change (e.g. turning on addressindex) needs the index rebuilt
    /// from the local block files via a one-time full -reindex.
    ReindexRequired(String),
    /// Any other refusal to start (config, ports, permissions...).
    Failed(String),
}

const CORRUPTION_MARKERS: [&str; 4] = [
    "corruption",
    "Error loading block database",
    "Failed to find best block",
    "Error opening block database",
];

/// divid prints one of these when an index option (addressindex/txindex) was
/// turned on after the chain was already synced without it. The fix is a full
/// -reindex, which rebuilds from block files already on disk (no re-download).
const REINDEX_REQUIRED_MARKERS: [&str; 2] = [
    "to change -addressindex",
    "rebuild the database using -reindex",
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
    let attempt = if extra_args.is_empty() {
        "normal start".to_string()
    } else {
        format!("start with {}", extra_args.join(" "))
    };
    let spawn_log_path = datadir.join("dd69-spawn.log");

    /* ── A PROCESS EXISTING IS NOT A NODE WORKING ─────────────────────────
       This used to see a live process id and return Running immediately,
       without asking the node anything at all. A node that is wedged --
       process alive, port open, answering nothing -- sailed straight
       through, and the wallet reported "RESULT: the node started".

       Geoff, 2026-Sep-21: his log said the node started and was reused as
       pid 68587; the node had in fact stopped answering, and the wallet had
       no idea because it never asked. Nothing downstream could recover,
       because as far as bring-up was concerned everything had gone fine.

       So a reused process now has to prove itself on exactly the same terms
       as a freshly started one: it must answer. It drops into the same wait
       loop below, which is patient with a node still loading its chain and
       honest about one that never replies. */
    let existing = daemon_pid(datadir);
    if let Some(pid) = existing {
        crate::setuplog::log(format!(
            "node launch: a node is already running (pid {pid}) — checking it answers before              reusing it"
        ));
    } else {
        crate::setuplog::log(format!("node launch: {attempt} — {}", divid.display()));
    }

    if let Some(pid) = existing {
        /* Give it the same patience a starting node gets -- a node loading a
           four-million-block index answers nothing for a couple of minutes,
           and that is not a fault. But if it never answers, say so plainly
           and name the cure. Do NOT fall through to the repair rungs: they
           would each try to start a second node, every one of which would
           fail to bind the port this one is holding, and the owner would be
           told another wallet is running when it is this one. */
        let deadline = Instant::now();
        while deadline.elapsed() < timeout {
            if rpc.call("getblockcount", serde_json::json!([])).is_ok() {
                crate::setuplog::log(format!(
                    "node launch: the running node answered — reusing it (pid {pid})"
                ));
                return Spawn::Running(pid);
            }
            if !pid_alive(pid) {
                crate::setuplog::log(
                    "node launch: the node that was running has exited — starting a fresh one",
                );
                break;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        if pid_alive(pid) {
            crate::setuplog::log(format!(
                "node launch: the node (pid {pid}) is running but has not answered in {}s",
                timeout.as_secs()
            ));
            return Spawn::Failed(format!(
                "A Divi node is already running on this computer (process {pid}) but it is not \
                 responding. It has to be stopped before another can start. Quit any other Divi \
                 wallet, or restart the computer if none is open."
            ));
        }
    }

    let spawned_pid = match spawn_node(divid, datadir, extra_args, &spawn_log_path) {
        Ok(pid) => pid,
        Err(e) => return Spawn::Failed(e),
    };

    let started = Instant::now();
    let mut log_size: u64 = 0;
    let mut last_log_growth = Instant::now();
    let mut patience_noted = false;
    loop {
        if rpc.call("getblockcount", serde_json::json!([])).is_ok() {
            /* ── ANSWERING IS PROOF. A PID FILE IS NOT. ────────────────────
               This used to demand a divid.pid file even after the node had
               answered an RPC call, and report "node answered RPC but wrote
               no pid file" as a FAILURE if it was missing.

               Windows has no daemon mode, so the node never writes that file
               there. Joseph's laptop on 2026-Sep-21: the node started, loaded
               the wallet, opened its P2P threads, connected to a peer at
               height 4,224,101 and answered us -- and the wallet declared
               THE NODE DID NOT START, whereupon the watchdog tried to start
               a second one and the fresh-install path went off to fetch a
               snapshot on top of a node that was already running.

               A node that answers RPC is running. That is not a matter of
               opinion. Use the pid file when it exists, because it survives
               a restart of the wallet, and otherwise the id of the process
               we just spawned, which we now keep. */
            let pid = daemon_pid(datadir).unwrap_or(spawned_pid);
            remember_pid(datadir, pid);
            crate::setuplog::log(format!("node launch: node answered — running (pid {pid})"));
            return Spawn::Running(pid);
        }
        // Daemon printed a fatal line and died? Classify and stop waiting.
        if daemon_pid(datadir).is_none() && started.elapsed() > Duration::from_secs(3) {
            // Its own output first; failing that, the tail of its debug.log,
            // which is where "Block database corruption detected" is written.
            let mut said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
            if !said.lines().any(looks_fatal) {
                if let Ok(dbg) = std::fs::read_to_string(datadir.join("debug.log")) {
                    let tail: Vec<&str> = dbg.lines().rev().take(80).collect();
                    said = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
                }
            }
            /* ── WHAT COUNTS AS THE NODE'S LAST WORDS ─────────────────────
               This looked only for a line containing "Error:". A C runtime
               assertion does not say "Error:" -- it says

                 Assertion failed: instance != nullptr, file
                 ChainstateManager.cpp, line 102 ... in AppInit()

               so the classifier below (which has handled "Assertion failed"
               all along) was never reached. The launch fell through to the
               "exited early" log line and tried again, and again, for the
               full 180 seconds: Joseph's log on 2026-Sep-20 has seventy
               identical crashes in a row, none of them classified, before
               the wallet finally reported a TIMEOUT rather than the crash
               that had already happened seventy times.

               A process that died is a process that died. Take the first
               line that looks fatal by ANY of these signs. */
            // The LAST fatal line, not the first. A node can grumble on its
            // way down; what killed it is the thing it said last.
            if let Some(line) = said.lines().filter(|l| looks_fatal(l)).next_back() {
                let msg = line.trim().to_string();
                crate::setuplog::log(format!("node launch: node reported an error and exited — {msg}"));
                if REINDEX_REQUIRED_MARKERS.iter().any(|m| msg.contains(m)) {
                    return Spawn::ReindexRequired(msg);
                }
                if CORRUPTION_MARKERS.iter().any(|m| msg.contains(m)) {
                    return Spawn::Corruption(msg);
                }
                // Two failures a user CAN fix, if only they are told what they
                // mean. The node's own wording explains neither.
                if msg.contains("Unable to bind") {
                    return Spawn::Failed(
                        "Another Divi wallet is already running on this computer and is using the \
                         network port this one needs. Close the other Divi wallet (including Divi \
                         Desktop 2.0, and check the system tray), then start this one again."
                            .into(),
                    );
                }
                if msg.contains("Assertion failed") {
                    return Spawn::Failed(format!(
                        "The node program stopped immediately with an internal error, so this is a \
                         fault in the node program itself rather than anything you did. Please send \
                         this to the Divi team: {msg}"
                    ));
                }
                return Spawn::Failed(msg);
            }
            // No "Error:" line but the process is gone — capture whatever it did
            // say (e.g. a bare "Killed: 9" from Gatekeeper leaves nothing here,
            // which is itself the tell).
            if !said.trim().is_empty() {
                crate::setuplog::log(format!(
                    "node launch: node exited early. Its output: {}",
                    said.trim().lines().rev().take(3).collect::<Vec<_>>().join(" | ")
                ));
            } else {
                // Platform-specific, because the causes are completely
                // different and Joseph was told about macOS Gatekeeper on a
                // Windows machine, which is worse than saying nothing.
                #[cfg(target_os = "macos")]
                crate::setuplog::log(
                    "node launch: the node process is gone and said nothing — on macOS this is \
                     the signature of Gatekeeper killing an unsigned binary (Killed: 9)",
                );
                #[cfg(windows)]
                crate::setuplog::log(
                    "node launch: cannot see the node process yet and it has said nothing — \
                     usually it is simply still loading the block index, which takes a couple \
                     of minutes on this chain",
                );
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                crate::setuplog::log(
                    "node launch: the node process is gone and said nothing — check that the \
                     binary is executable and not blocked by security software",
                );
            }
        }
        /* ── A TIMEOUT IS FOR A NODE THAT HAS STOPPED, NOT ONE THAT IS SLOW ──
           This fired on the clock alone. Joseph's laptop, 2026-Sep-21: the
           node was alive and loading a damaged block index -- slow, but
           working -- and at 180 seconds the wallet declared "failed, no
           output" and walked away. Twenty seconds later the node reported
           "Block database corruption detected", which is the exact message
           that triggers the automatic repair. Nobody was listening.

           So the clock only counts while the node is NOT making progress.
           If the process is alive and still writing to its log, it gets
           more time, up to a hard ceiling that a genuinely stuck node
           cannot talk its way past. A dead process or a silent one still
           times out as before. */
        let quiet_for = last_log_growth.elapsed();
        if node_log_grew(datadir, &mut log_size) {
            last_log_growth = Instant::now();
        }
        let still_working = pid_alive(spawned_pid) && quiet_for < Duration::from_secs(120);
        let hard_ceiling = started.elapsed() >= timeout.max(Duration::from_secs(1800));
        if started.elapsed() >= timeout && still_working && !hard_ceiling {
            if !patience_noted {
                patience_noted = true;
                crate::setuplog::log(format!(
                    "node launch: {}s and no answer yet, but the node is alive and still writing \
                     to its log — giving it longer (it is probably loading the block index)",
                    timeout.as_secs()
                ));
            }
        } else if started.elapsed() >= timeout {
            let said = std::fs::read_to_string(&spawn_log_path).unwrap_or_default();
            let hint = said
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("no output")
                .trim()
                .to_string();
            crate::setuplog::log(format!(
                "node launch: TIMED OUT after {}s waiting for the node to answer (its last words: {hint})",
                timeout.as_secs()
            ));
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
/// Start the node program and return the process id of the child.
///
/// Split out so that a node which is ALREADY running can be put through the
/// same "does it actually answer" check as a freshly started one, instead of
/// being waved through on the strength of its process existing.
fn spawn_node(
    divid: &Path,
    datadir: &Path,
    extra_args: &[&str],
    spawn_log_path: &Path,
) -> Result<i32, String> {
    let Ok(spawn_log) = std::fs::File::create(spawn_log_path) else {
        crate::setuplog::log(format!("node launch: cannot write in {}", datadir.display()));
        return Err(format!("cannot write in {}", datadir.display()));
    };
    let Ok(spawn_log_err) = spawn_log.try_clone() else {
        return Err("cannot open spawn log".into());
    };
    let mut cmd = std::process::Command::new(divid);
    /* Belt and braces. The config layer already strips the Windows
       extended-length prefix, but this is the one place a path is actually
       handed to the node, and handing it \\?\... is what silently broke
       every Windows install: LevelDB reads that as a relative path, glues it
       onto the working directory, cannot lock the block index, and the node
       dies in AppInit. Strip it here too, so no future caller can
       reintroduce it. */
    let datadir = crate::config::strip_extended_prefix(datadir);
    let datadir = datadir.as_path();
    cmd.arg(format!("-conf={}", datadir.join("divi.conf").display()))
        .arg(format!("-datadir={}/", datadir.display()));
    for a in extra_args {
        cmd.arg(a);
    }
    // On Windows, spawning a console subprocess would flash a black console
    // window; CREATE_NO_WINDOW suppresses it. No effect (and not compiled) on Unix.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Keep the child's real process id. On Windows the node writes no pid
    // file at all (there is no daemon mode there), so this is the only id we
    // will ever have for it.
    match cmd.stdout(spawn_log).stderr(spawn_log_err).spawn() {
        Ok(child) => {
            let pid = child.id() as i32;
            // Immediately, before anything can ask whether it is running.
            // On Windows this is the only record that will ever exist.
            crate::process::remember_pid(datadir, pid);
            Ok(pid)
        }
        Err(e) => {
            // The OS refused to start the process at all — the classic cases are a
            // missing/blocked binary (macOS Gatekeeper) or a permissions problem.
            crate::setuplog::log(format!(
                "node launch: OPERATING SYSTEM REFUSED to start the node — {e} ({})",
                divid.display()
            ));
            Err(format!("could not launch {}: {e}", divid.display()))
        }
    }
}

/// Has the node's own log grown since we last looked? Cheap, and the most
/// honest sign that a node which has not answered yet is nonetheless alive
/// and doing something -- loading a block index, most often.
fn node_log_grew(datadir: &Path, seen: &mut u64) -> bool {
    let now = std::fs::metadata(datadir.join("debug.log")).map(|m| m.len()).unwrap_or(0);
    let grew = now > *seen;
    *seen = now;
    grew
}

/// Signs that a line is the node's last words.
///
/// "Error:" alone is not enough. A C runtime assertion prints
/// `Assertion failed: ... in AppInit()` with no "Error:" anywhere, and
/// because the classifier only matched "Error:", seventy consecutive
/// identical crashes in Joseph's log on 2026-Sep-20 were each logged as
/// "exited early" and retried, until the launch gave up after 180 seconds
/// and reported a TIMEOUT instead of the crash that had already happened
/// seventy times.
const FATAL_SIGNS: [&str; 6] = [
    "Error:",
    "Assertion failed",
    "terminate called",
    "Segmentation fault",
    "Aborted",
    "panicked at",
];

/// Chatter that carries the word "Error:" and means nothing. The node writes
/// RPCAcceptHandler errors constantly in perfect health -- 1,307 of them in
/// Geoff's log, with no real errors at all beside them -- so matching on
/// "Error:" alone picks up noise and presents it as the reason the node died.
/// That is how Joseph was twice told his node's "last message" was an RPC
/// accept error, which explained nothing and pointed nowhere.
fn is_noise(line: &str) -> bool {
    const NOISE: [&str; 3] = ["RPCAcceptHandler", "connect() to", "socket send error"];
    NOISE.iter().any(|n| line.contains(n))
}

fn looks_fatal(line: &str) -> bool {
    if is_noise(line) {
        return false;
    }
    // The repair markers are fatal in their own right. They were only
    // consulted AFTER a line had matched FATAL_SIGNS, so a corruption report
    // that did not happen to say "Error:" was never classified, and the
    // repair ladder it exists to trigger never ran.
    FATAL_SIGNS.iter().any(|sign| line.contains(sign))
        || CORRUPTION_MARKERS.iter().any(|m| line.contains(m))
        || REINDEX_REQUIRED_MARKERS.iter().any(|m| line.contains(m))
}

pub fn start_with_recovery(
    divid: &Path,
    datadir: &Path,
    rpc: &RpcClient,
    normal_timeout: Duration,
    repair_timeout: Duration,
) -> Result<StartReport, String> {
    // Repair our own node's conf before every launch. The first-run setup path
    // writes it only once, so an already-set-up node would never gain a newly
    // required option (e.g. addressindex, which the treasury/multisig displays
    // and the governance snapshot depend on). ensure_local_node_conf only edits
    // a DD69-written conf and is idempotent; when it adds addressindex the node
    // asks for a one-time -reindex, which the ladder below then performs.
    if datadir == crate::config::dd69_datadir().as_path() {
        let _ = crate::install::ensure_local_node_conf();
    }

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
            Spawn::ReindexRequired(_) => {
                // An index option was just enabled (addressindex). Rebuild the
                // index from the on-disk block files once; this is a longer
                // first start, not a re-download, and only happens the one time.
                return match spawn_once(divid, datadir, rpc, *timeout, &["-reindex"]) {
                    Spawn::Running(pid) => Ok(StartReport {
                        pid,
                        repaired_with: Some("building the address index".to_string()),
                    }),
                    Spawn::Corruption(msg)
                    | Spawn::Failed(msg)
                    | Spawn::ReindexRequired(msg) => {
                        Err(format!("could not build the address index: {msg}"))
                    }
                };
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

/// Ask the operating system to pass on a polite shutdown request.
///
/// SIGTERM on Unix, which divid handles exactly as it handles the `stop`
/// RPC: flush the chain, close the databases, exit. On Windows, taskkill
/// WITHOUT /F, which is the request-to-close, not the force.
///
/// Never SIGKILL, and never taskkill /F. Forcing a node mid-flush is what
/// corrupts the block database, and no amount of impatience justifies it.
fn request_stop_via_signal(pid: i32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// The one rule this whole project exists to enforce: never kill divid.
/// Ask it to stop over RPC, then WAIT for the process to actually exit —
/// the flush between "stop" and exit is the 9-13 s corruption window.
pub fn safe_stop(rpc: &RpcClient, datadir: &Path, timeout: Duration) -> Result<Duration, String> {
    let Some(pid) = daemon_pid(datadir) else {
        crate::applog::log("shutdown: node was not running — nothing to stop");
        return Err("daemon is not running".into());
    };
    crate::applog::log(format!("shutdown: asking the node to stop and save (pid {pid})"));

    /* ── ASKING OVER RPC IS NOT THE ONLY WAY TO ASK ───────────────────────
       This used to be `rpc.call("stop")?` -- return immediately if the call
       fails. But the node this function exists to rescue is a WEDGED one,
       and a wedged node cannot accept the stop command either. So the one
       case it was written for was the one case it gave up on instantly.
       The watchdog then logged "the node would not stop; leaving it alone",
       and nothing ever recovered. Geoff's node sat wedged for fifteen hours
       on 2026-Sep-21 with the watchdog silent throughout.

       When the command cannot be delivered, send SIGTERM instead. That is
       NOT a kill: it is the same polite request, and the node handles it
       with exactly the same clean shutdown and flush as the RPC command.
       SIGKILL remains forbidden, here and everywhere -- that is the one
       that corrupts the chain. */
    if let Err(e) = rpc.call("stop", serde_json::json!([])) {
        crate::applog::log(format!(
            "shutdown: the node would not take the stop command ({e}) — asking the operating \
             system to pass on the same request instead (a graceful signal, never a kill)"
        ));
        request_stop_via_signal(pid);
    }
    let started = Instant::now();
    while started.elapsed() < timeout {
        if !pid_alive(pid) {
            let secs = started.elapsed().as_secs();
            crate::applog::log(format!("shutdown: node saved and exited cleanly after {secs}s"));
            // Our record is only meaningful while that process lives. Clear
            // it now, so a recycled process id can never be read back as a
            // running node.
            forget_pid(datadir);
            return Ok(started.elapsed());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    crate::applog::log(format!(
        "shutdown: node still saving after {}s — waiting, NOT killing it",
        timeout.as_secs()
    ));
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

#[cfg(test)]
mod our_pid_file_tests {
    use super::*;

    #[test]
    fn we_remember_and_forget_the_nodes_process_id() {
        let dir = std::env::temp_dir().join(format!("dd69-pid-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Our own process id is certainly alive, which makes it a usable
        // stand-in for a running node here.
        let me = std::process::id() as i32;
        remember_pid(&dir, me);
        assert_eq!(read_pid_file(&dir.join(OUR_PID_FILE)), Some(me));

        forget_pid(&dir);
        assert_eq!(read_pid_file(&dir.join(OUR_PID_FILE)), None);
        // With nothing recorded and no divid.pid, nothing is claimed to run.
        assert_eq!(daemon_pid(&dir), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_dead_process_id_is_not_a_running_node() {
        let dir = std::env::temp_dir().join(format!("dd69-pid-dead-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // An id that cannot belong to a live process.
        std::fs::write(dir.join(OUR_PID_FILE), "2147483646").unwrap();
        assert_eq!(daemon_pid(&dir), None, "a stale record must never count as running");
        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod fatal_line_tests {
    use super::{looks_fatal, CORRUPTION_MARKERS};

    #[test]
    fn a_c_assertion_is_fatal_even_without_the_word_error() {
        // Joseph's Windows node, verbatim. This is the line that used to be
        // ignored, causing a 180-second retry loop instead of a diagnosis.
        let line = "Assertion failed: instance != nullptr, file ChainstateManager.cpp, \
                    line 102 | | C:\\...\\divid69.exe in AppInit()";
        assert!(looks_fatal(line));
        assert!(!line.contains("Error:"), "the point of the test is that it does not");
    }

    #[test]
    fn a_corruption_report_is_fatal_even_without_the_word_error() {
        // Joseph's node, 2026-Sep-21. This is the line that triggers the
        // automatic repair, and it was never being classified because it
        // does not contain "Error:".
        let line = "loading block database : Block database corruption detected! \
                    Failed to find best block in block index";
        assert!(looks_fatal(line));
        assert!(CORRUPTION_MARKERS.iter().any(|m| line.contains(m)));
    }

    #[test]
    fn the_nodes_own_error_lines_still_count() {
        assert!(looks_fatal(
            "Error: Unable to bind to 0.0.0.0:51472 on this computer. DIVI Core is probably already running."
        ));
    }

    #[test]
    fn crashes_without_a_message_of_their_own_count_too() {
        assert!(looks_fatal("Segmentation fault"));
        assert!(looks_fatal("terminate called after throwing an instance of 'std::runtime_error'"));
    }

    #[test]
    fn ordinary_startup_chatter_is_not_fatal() {
        assert!(!looks_fatal("Loading block index..."));
        assert!(!looks_fatal("UPnP Port Mapping successful."));
        assert!(!looks_fatal("init message: Verifying wallet..."));
    }

    #[test]
    fn rpc_accept_noise_is_not_a_crash_however_much_it_says_error() {
        // A healthy node writes this constantly. Treating it as fatal is how
        // "The node stopped. Its last message was: RPCAcceptHandler: Error:"
        // got shown to a user twice, explaining nothing.
        assert!(!looks_fatal("RPCAcceptHandler: Error: Invalid argument"));
        assert!(!looks_fatal(
            "RPCAcceptHandler: Error: The I/O operation has been aborted because of either a \
             thread exit or an application request"
        ));
        assert!(!looks_fatal("connect() to 1.2.3.4:51472 failed after select(): Connection refused"));
    }
}
