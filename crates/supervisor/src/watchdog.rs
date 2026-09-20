// ── Noticing when the node has stopped answering, and fixing it ────────────
//
// The node can end up alive but unresponsive: the process is running, the port
// is open, connections are accepted — and nothing ever comes back. Every panel
// in the wallet then shows stale numbers or dashes, and the only cure was for
// the owner to quit and reopen.
//
// WHY IT HAPPENS. Each RPC connection is serviced on one of the node's worker
// threads, and a kept-alive connection holds that thread for as long as it
// stays open. Enough long-lived connections — several panels polling, or a
// second wallet running from somewhere else — and every worker is occupied.
// New requests are accepted onto the queue and never reach a thread. Raising
// the thread budget makes it far less likely; it does not make it impossible,
// so the wallet also has to notice and recover.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It never kills the node. A wedged node
// is still holding the chain state it has not written yet, and killing it is
// how the database gets corrupted — which is a far worse outcome than a slow
// wallet. It asks over RPC, waits, and if that fails it signals and waits
// again, for minutes. If the node will not go, it is left alone and reported.

// ── WHAT WENT WRONG ON 2026-Sep-20, AND WHY THE BAR IS NOW SO HIGH ─────────
//
// This watchdog restarted a healthy node roughly every ten minutes for two
// hours, and the wallet showed STILL SYNCING the whole time with nothing
// moving. The logs are unambiguous: at 20:26:26 the node accepted a block in
// 28 milliseconds at the chain tip, and eighteen seconds later this code
// declared it "stopped answering" and shut it down. The shutdown then ground
// away for a quarter of an hour flushing chain state, during which the node
// answered nothing at all — which looked, to the old code, like more evidence
// of a wedge.
//
// Three separate mistakes made that possible, all fixed here:
//
//   1. The probe was the ONLY evidence. If the probe was wrong, the verdict
//      was wrong. Now real RPC traffic is the primary signal, and the probe
//      only gets a say when there has been no real traffic at all.
//   2. "No answer" was one thing. It is two: a port that accepts and then
//      says nothing (a genuine wedge) and a port that refuses (still loading
//      the chain, or shutting down — restarting either is pointless or
//      actively harmful).
//   3. Two minutes of patience against a node whose shutdown alone can take
//      fifteen. Restarting costs minutes of downtime and risks the chain
//      database; being slow to restart costs nothing but a stale panel. The
//      asymmetry is enormous, so the patience is now measured in tens of
//      minutes and the node must be doing nothing at all to earn a restart.

use crate::config::NodeConfig;
use crate::rpc::{Pulse, RpcClient};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

/// How often to look at the node.
const CHECK_EVERY: Duration = Duration::from_secs(30);
/// Consecutive wedge-looking checks before we act. Twenty at thirty seconds is
/// ten minutes of a port that accepts connections and answers none of them,
/// with no ordinary RPC traffic getting through either, and no progress in the
/// node's own log. Nothing healthy looks like that for ten minutes.
const STRIKES: u32 = 20;
/// A pulse must come back quickly. The point is not "is it busy" but "is it
/// answering at all", and a wedged node never answers however long we wait.
const PULSE_TIMEOUT: Duration = Duration::from_secs(8);
/// Real RPC traffic newer than this means the node is talking to us and no
/// probe result can overrule it.
const TRAFFIC_IS_FRESH: Duration = Duration::from_secs(90);
/// Never restart more often than this. Long, because a restart on this chain
/// costs minutes of shutdown plus minutes of index loading; a loop of them
/// never lets the node finish either.
const MIN_BETWEEN_RESTARTS: Duration = Duration::from_secs(3600);
/// How long the RPC port may be absent before we accept the node is not coming
/// up on its own. Loading the chain index takes a couple of minutes; a stuck
/// shutdown can take fifteen. This is past both.
const MAX_NOT_LISTENING: Duration = Duration::from_secs(1800);

/// Has the node written to its own log since we last looked? A node flushing
/// chain state, loading an index or talking to peers writes constantly, and a
/// node doing that is doing work — whatever its RPC port is doing. This is the
/// check that stops us shooting a node that is busy rather than stuck.
fn log_progress(datadir: &Path, seen: &mut Option<(u64, SystemTime)>) -> bool {
    let Ok(m) = std::fs::metadata(datadir.join("debug.log")) else {
        // No log to judge by: give the node the benefit of the doubt.
        return true;
    };
    let now = (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH));
    let moved = match *seen {
        Some(before) => now != before,
        None => true,
    };
    *seen = Some(now);
    moved
}

/// Run forever, watching the node. Intended to be spawned once at startup.
pub fn run() {
    let mut strikes: u32 = 0;
    let mut absent: u32 = 0;
    let mut last_restart: Option<Instant> = None;
    let mut not_listening_since: Option<Instant> = None;
    let mut log_seen: Option<(u64, SystemTime)> = None;

    loop {
        std::thread::sleep(CHECK_EVERY);

        let Ok(cfg) = NodeConfig::load() else { continue };
        // A node we do not manage is not ours to restart.
        if cfg.remote {
            continue;
        }
        // NOT RUNNING AT ALL. This used to be skipped, on the assumption that
        // start-up handles it. Start-up only runs once. If the node stops while
        // the wallet is open — it was stopped and not restarted, it crashed, or
        // the machine put it to sleep — nothing brought it back and the wallet
        // simply said NODE NOT RUNNING until the owner restarted everything.
        let Some(pid) = crate::process::daemon_pid(&cfg.datadir) else {
            absent += 1;
            // Two checks of grace, so we never race the start-up sequence that
            // is probably already starting one.
            if absent < 2 {
                continue;
            }
            if let Some(t) = last_restart {
                if t.elapsed() < MIN_BETWEEN_RESTARTS {
                    continue;
                }
            }
            crate::applog::log("watchdog: the node is not running — starting it");
            crate::setuplog::log("watchdog: node was not running — starting it automatically");
            last_restart = Some(Instant::now());
            absent = 0;
            let rpc = RpcClient::new(&cfg);
            let Some(bin) = crate::install::managed_divid() else { continue };
            match crate::process::start_with_recovery(
                &bin,
                &cfg.datadir,
                &rpc,
                Duration::from_secs(180),
                Duration::from_secs(1800),
            ) {
                Ok(rep) => {
                    crate::applog::log(format!("watchdog: node started (pid {})", rep.pid));
                    crate::setuplog::log(format!("watchdog: node started (pid {})", rep.pid));
                }
                Err(e) => {
                    crate::applog::log(format!("watchdog: could not start the node — {e}"));
                    crate::setuplog::log(format!("watchdog: COULD NOT START THE NODE — {e}"));
                }
            }
            continue;
        };
        absent = 0;

        // ── 1. Real traffic beats any probe of ours ────────────────────────
        // Every RPC call the app makes stamps this on success. If one got
        // through recently the node is answering, and that is the end of it.
        if let Some(age) = crate::mapfeed::since_answer() {
            if age < TRAFFIC_IS_FRESH {
                if strikes > 0 {
                    crate::applog::log(format!(
                        "watchdog: the wallet's own RPC calls are getting through ({}s ago) — \
                         clearing {strikes} strike(s)",
                        age.as_secs()
                    ));
                }
                strikes = 0;
                not_listening_since = None;
                continue;
            }
        }

        // ── 2. Ask the node directly ───────────────────────────────────────
        match pulse(&cfg) {
            Pulse::Answered => {
                if strikes > 0 {
                    crate::applog::log(format!(
                        "watchdog: the node answered again after {strikes} missed check(s)"
                    ));
                }
                strikes = 0;
                not_listening_since = None;
                continue;
            }
            // Not up yet, or on its way down. Either way, restarting it is the
            // wrong move: this is the state the old code mistook for a wedge
            // and "cured" by shutting the node down again.
            Pulse::NotListening => {
                let since = *not_listening_since.get_or_insert_with(Instant::now);
                strikes = 0;
                if since.elapsed() < MAX_NOT_LISTENING {
                    crate::applog::log(format!(
                        "watchdog: the RPC port is not open yet ({}s) — the node is starting or \
                         shutting down, which is not a fault; waiting",
                        since.elapsed().as_secs()
                    ));
                    continue;
                }
                crate::applog::log(format!(
                    "watchdog: the RPC port has been closed for {} minutes with pid {pid} still \
                     alive — treating that as stuck",
                    since.elapsed().as_secs() / 60
                ));
                not_listening_since = None;
                // Fall through to the restart below.
            }
            Pulse::Silent => {
                // ── 3. Is it actually doing anything? ──────────────────────
                // A node flushing its chain state writes to debug.log the
                // whole time and cannot answer RPC while it does. That is
                // busy, not broken, and shooting it is how the database gets
                // damaged.
                if log_progress(&cfg.datadir, &mut log_seen) {
                    if strikes > 0 {
                        crate::applog::log(
                            "watchdog: no RPC answer, but the node is still writing to its log — \
                             it is busy, not wedged; waiting",
                        );
                    }
                    strikes = 0;
                    continue;
                }
                strikes += 1;
                crate::applog::log(format!(
                    "watchdog: the RPC port accepts connections but answers nothing, and the node \
                     has written nothing to its log ({strikes} of {STRIKES}) — pid {pid}"
                ));
                if strikes < STRIKES {
                    continue;
                }
            }
        }

        if let Some(t) = last_restart {
            if t.elapsed() < MIN_BETWEEN_RESTARTS {
                crate::applog::log(
                    "watchdog: it is wedged again, but a restart was attempted recently — waiting \
                     rather than looping",
                );
                strikes = 0;
                continue;
            }
        }

        crate::applog::log("watchdog: the node is wedged; restarting it");
        crate::setuplog::log("watchdog: node stopped answering — restarting it automatically");
        last_restart = Some(Instant::now());
        strikes = 0;

        let rpc = RpcClient::new(&cfg);
        // Ask, then wait. safe_stop escalates to a signal and keeps waiting; it
        // never forces, because forcing corrupts the chain database.
        //
        // Twenty minutes, not five. A shutdown on a four-million-block chain
        // spends that long flushing state to disk at full tilt, and the old
        // five-minute limit simply gave up in the middle and reported failure
        // on a shutdown that was working perfectly well.
        match crate::process::safe_stop(&rpc, &cfg.datadir, Duration::from_secs(1200)) {
            Ok(d) => crate::applog::log(format!(
                "watchdog: node stopped cleanly after {}s",
                d.as_secs()
            )),
            Err(e) => {
                // Do not force it. But do not go quiet either: the wallet used
                // to sit on STILL SYNCING indefinitely with nothing in the
                // report explaining why, which is exactly the dead end Geoff
                // hit. Say it plainly, and keep watching — when the process
                // finally does exit, the not-running branch above starts a
                // fresh one.
                crate::applog::log(format!(
                    "watchdog: the node would not stop ({e}); leaving it alone rather than forcing \
                     it, since forcing it is what corrupts the chain"
                ));
                crate::setuplog::log(
                    "watchdog: the node is shutting down and taking a long time flushing the \
                     chain to disk. It is not being forced, because forcing it is what corrupts \
                     the chain. A new one starts automatically once it finishes.",
                );
                continue;
            }
        }

        let Some(bin) = crate::install::managed_divid() else { continue };
        match crate::process::start_with_recovery(
            &bin,
            &cfg.datadir,
            &rpc,
            Duration::from_secs(180),
            Duration::from_secs(1800),
        ) {
            Ok(rep) => {
                crate::applog::log(format!("watchdog: node restarted (pid {})", rep.pid));
                crate::setuplog::log(format!(
                    "watchdog: node restarted automatically (pid {})",
                    rep.pid
                ));
            }
            Err(e) => {
                crate::applog::log(format!("watchdog: could not restart the node — {e}"));
                crate::setuplog::log(format!("watchdog: RESTART FAILED — {e}"));
            }
        }
    }
}

/// One cheap question with a short deadline. `getblockcount` touches no wallet
/// and no lock, so a healthy node answers it in milliseconds; a wedged one
/// never answers it at all.
fn pulse(cfg: &NodeConfig) -> Pulse {
    RpcClient::new(cfg).pulse(PULSE_TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_growth_is_progress_and_a_frozen_log_is_not() {
        let dir = std::env::temp_dir().join(format!("dd69-wd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("debug.log");
        std::fs::write(&log, b"starting\n").unwrap();

        let mut seen = None;
        // The first look has nothing to compare against and must never be
        // read as "stuck" — that alone would restart a node on sight.
        assert!(log_progress(&dir, &mut seen));
        // Nothing written since: no progress.
        assert!(!log_progress(&dir, &mut seen));
        // The node wrote a line: it is doing work.
        std::fs::write(&log, b"starting\nnew best block\n").unwrap();
        assert!(log_progress(&dir, &mut seen));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_log_is_never_held_against_the_node() {
        let mut seen = None;
        assert!(log_progress(Path::new("/dd69/definitely/not/here"), &mut seen));
    }

    #[test]
    fn patience_exceeds_the_cost_of_a_restart() {
        // A restart costs a long shutdown flush plus a chain-index load. The
        // watchdog must be slower to act than that whole cycle takes, or it
        // restarts a node that is still recovering from the last restart.
        let wedge_verdict = CHECK_EVERY * STRIKES;
        assert!(wedge_verdict >= Duration::from_secs(600));
        assert!(MIN_BETWEEN_RESTARTS > wedge_verdict);
        assert!(MAX_NOT_LISTENING > Duration::from_secs(900));
    }
}
