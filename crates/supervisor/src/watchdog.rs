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

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use std::time::{Duration, Instant};

/// How often to take the node's pulse.
const CHECK_EVERY: Duration = Duration::from_secs(30);
/// Consecutive silent checks before we call it wedged. Four at thirty seconds
/// is two minutes: long enough that a slow reindex or a busy spell is not
/// mistaken for a fault, short enough that nobody sits looking at a dead
/// wallet wondering.
const STRIKES: u32 = 4;
/// A pulse must come back quickly. The point is not "is it busy" but "is it
/// answering at all", and a wedged node never answers however long we wait.
const PULSE_TIMEOUT: Duration = Duration::from_secs(8);
/// Never restart more often than this, whatever happens. A node that dies on
/// startup must not become a restart loop that never lets the chain settle.
const MIN_BETWEEN_RESTARTS: Duration = Duration::from_secs(600);

/// Run forever, watching the node. Intended to be spawned once at startup.
pub fn run() {
    let mut strikes: u32 = 0;
    let mut absent: u32 = 0;
    let mut last_restart: Option<Instant> = None;

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

        if pulse(&cfg) {
            if strikes > 0 {
                crate::applog::log(format!(
                    "watchdog: the node answered again after {strikes} missed check(s)"
                ));
            }
            strikes = 0;
            continue;
        }

        strikes += 1;
        crate::applog::log(format!(
            "watchdog: the node did not answer ({strikes} of {STRIKES}) — pid {pid} is still running"
        ));
        if strikes < STRIKES {
            continue;
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
        match crate::process::safe_stop(&rpc, &cfg.datadir, Duration::from_secs(300)) {
            Ok(d) => crate::applog::log(format!(
                "watchdog: node stopped cleanly after {}s",
                d.as_secs()
            )),
            Err(e) => {
                crate::applog::log(format!(
                    "watchdog: the node would not stop ({e}); leaving it alone rather than forcing \
                     it, since forcing it is what corrupts the chain"
                ));
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
fn pulse(cfg: &NodeConfig) -> bool {
    RpcClient::new(cfg).pulse(PULSE_TIMEOUT)
}
