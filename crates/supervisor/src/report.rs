//! One place that answers "what is the node doing right now?" — shared by the
//! CLI and the desktop app so they can never disagree.

use crate::config::NodeConfig;
use crate::health::{self, LastShutdown};
use crate::process;
use crate::rpc::RpcClient;
use crate::state::{self, Phase};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct StatusReport {
    pub running: bool,
    pub phase: Phase,
    pub headline: String,
    pub blocks: Option<i64>,
    pub peers: Option<i64>,
    pub last_shutdown: LastShutdown,
    /// The chain needs, or is getting, a repair; the install panel's repair
    /// mode reads this and offers the snapshot or the rebuild.
    pub repair: Option<RepairState>,
}

#[derive(Clone, Debug)]
pub struct RepairState {
    /// The node is stopped because its chain data is damaged (user to choose).
    pub damaged: bool,
    /// The node's own words about the damage.
    pub reason: String,
    /// A rebuild from disk is running and still far behind.
    pub rebuilding: bool,
    pub days_behind: i64,
}

/// What the markers say, for every status answer.
fn repair_state(datadir: &std::path::Path, tip_age: Option<i64>) -> Option<RepairState> {
    let damaged = crate::process::damaged_marker(datadir);
    if damaged.exists() {
        return Some(RepairState {
            damaged: true,
            reason: std::fs::read_to_string(&damaged).unwrap_or_default().trim().to_string(),
            rebuilding: false,
            days_behind: 0,
        });
    }
    let marker = crate::process::repair_marker(datadir);
    if marker.exists() {
        let age = tip_age.unwrap_or(0);
        if age < 86_400 {
            let _ = std::fs::remove_file(&marker);
            return None;
        }
        return Some(RepairState { damaged: false, reason: String::new(), rebuilding: true, days_behind: age / 86_400 });
    }
    None
}

/// Seconds between the newest block's timestamp and now. Basis of the sync
/// heuristic — needs no version-specific RPC fields.
pub fn tip_age_secs(rpc: &RpcClient) -> Option<i64> {
    let hash = rpc.call("getbestblockhash", json!([])).ok()?;
    let hash = hash.as_str()?;
    let block = rpc.call("getblock", json!([hash])).ok()?;
    let tip = block["time"].as_i64()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    Some((now - tip).max(0))
}

pub fn status_report(cfg: &NodeConfig) -> StatusReport {
    // A remote node (over an SSH tunnel) has no local pid/datadir to inspect —
    // its whole status comes from RPC, so skip the local-file checks entirely.
    let last_shutdown = if cfg.remote {
        LastShutdown::Unknown
    } else {
        health::last_shutdown(&cfg.datadir)
    };

    if !cfg.remote && process::daemon_pid(&cfg.datadir).is_none() {
        let (phase, headline) = if process::damaged_marker(&cfg.datadir).exists() {
            (
                Phase::Stopped,
                "The blockchain data on this computer is damaged. Choose a repair: the chain snapshot (about an hour) or a rebuild from the blocks on disk (hours to days). Your coins are safe either way.".to_string(),
            )
        } else if health::stale_pid_file(&cfg.datadir, false) {
            (
                Phase::CrashedNeedsRepair,
                "The node didn't shut down cleanly last time. It will repair itself on the next start — your coins are safe.".to_string(),
            )
        } else if let Some(err) = crate::install::install_error() {
            // The most useful thing the app can say, and it used to say nothing:
            // the node program itself could not be installed, so there is no
            // node to sync and never will be until that is dealt with.
            (
                Phase::Stopped,
                format!("The node program could not be installed, so there is nothing to sync. {err}"),
            )
        } else if !crate::install::is_installed() {
            (
                Phase::Stopped,
                "The node program hasn't been installed yet. It downloads on first run — check your internet connection."
                    .to_string(),
            )
        } else if let Some(why) = health::last_node_error(&cfg.datadir) {
            // Say WHY. The reason is in the node's own log; not showing it left
            // users staring at "the node isn't running" with nothing to act on.
            (
                Phase::Stopped,
                format!("The node stopped. Its last message was: {why}"),
            )
        } else {
            /* No error anywhere -- which is the normal case after a clean
               shutdown, and used to be papered over by quoting RPC accept
               chatter as if it were a cause of death. Say the true thing,
               and say what to do next. */
            (
                Phase::Stopped,
                "The node isn't running, and it didn't report an error — so it was most likely \
                 shut down cleanly. It should start again on its own; if it doesn't, press \
                 Ctrl-L (⌘-L on a Mac) a minute from now and send the diagnostic."
                    .to_string(),
            )
        };
        return StatusReport { running: false, phase, headline, blocks: None, peers: None, last_shutdown,
            repair: repair_state(&cfg.datadir, None),
        };
    }

    let rpc = RpcClient::new(cfg);

    // Probe with one cheap call. The legacy node's RPC is bursty, so a single
    // miss doesn't mean it's down — retry once before concluding anything.
    let peers = rpc
        .call("getconnectioncount", json!([]))
        .ok()
        .and_then(|v| v.as_i64())
        .or_else(|| {
            rpc.call("getconnectioncount", json!([]))
                .ok()
                .and_then(|v| v.as_i64())
        });
    let peers = match peers {
        Some(p) => p,
        None => {
            // The peer count did not come back. That call is one of the
            // heavier ones, and under RPC contention it can time out while the
            // node is perfectly alive and answering everything else. Saying
            // "Connecting to the node" then is simply wrong, and it contradicts
            // the balance sitting on screen right beside it.
            //
            // So ask the cheapest question there is before concluding anything.
            let alive = rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64());
            return match alive {
                Some(h) => StatusReport {
                    // It IS answering; we just could not get the peer count this
                    // time. Report what we know and leave the count unknown.
                    running: true,
                    phase: Phase::Syncing,
                    headline: "Connected. Still counting peers…".into(),
                    blocks: Some(h),
                    peers: None,
                    last_shutdown,
            repair: repair_state(&cfg.datadir, None),
        },
                None => StatusReport {
                    running: true,
                    phase: Phase::Starting,
                    headline: "Connecting to the node…".into(),
                    blocks: None,
                    peers: None,
                    last_shutdown,
            repair: repair_state(&cfg.datadir, None),
        },
            }
        }
    };

    let blocks = rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64());
    // Tell the map when the chain actually moves. Only a genuine change of
    // height produces anything, so a poll that finds the same block is silent.
    if let Some(h) = blocks {
        crate::mapfeed::block_height(h);
    }
    let mut staking = rpc.call("getstakingstatus", json!([])).unwrap_or(json!({}));
    // The node's "staking status" flag FLICKERS — it can read true even when the
    // wallet is LOCKED and can't actually sign a stake. Recompute it from stable
    // signals gated on the real unlock state, so "staking" means genuinely
    // staking: an encrypted wallet must be unlocked (unlocked_until != 0), an
    // unencrypted one always is; plus mintable coins and peers.
    let winfo = rpc.call("getwalletinfo", json!([])).unwrap_or(json!({}));
    let encrypted = winfo.get("unlocked_until").is_some();
    let unlocked = !encrypted || winfo["unlocked_until"].as_i64().map(|u| u != 0).unwrap_or(false);
    let actually_staking = unlocked
        && staking["mintablecoins"].as_bool().unwrap_or(false)
        && staking["haveconnections"].as_bool().unwrap_or(false);
    staking["staking status"] = serde_json::json!(actually_staking);
    let tip_age = tip_age_secs(&rpc);
    /* A rebuild from disk (see process::repair_marker) looks like a node
       years behind. Say what it is; the install panel offers the snapshot. */
    let repair = repair_state(&cfg.datadir, tip_age);
    if let Some(r) = repair.as_ref().filter(|r| r.rebuilding) {
        return StatusReport {
            running: true,
            phase: Phase::Syncing,
            headline: format!(
                "Rebuilding the blockchain from the blocks on disk — at block {}, {} days still to verify. Slow on an ordinary computer; the snapshot repair is faster.",
                blocks.unwrap_or(0), r.days_behind
            ),
            blocks,
            peers: Some(peers),
            last_shutdown,
            repair,
        };
    }
    let h = state::assess(peers, tip_age, &staking);
    StatusReport {
        running: true,
        phase: h.phase,
        headline: h.headline,
        blocks,
        peers: Some(peers),
        last_shutdown,
            repair: repair_state(&cfg.datadir, None),
        }
}
