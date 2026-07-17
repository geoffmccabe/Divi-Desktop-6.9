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
    let last_shutdown = health::last_shutdown(&cfg.datadir);

    if process::daemon_pid(&cfg.datadir).is_none() {
        let (phase, headline) = if health::stale_pid_file(&cfg.datadir, false) {
            (
                Phase::CrashedNeedsRepair,
                "The node didn't shut down cleanly last time. It will repair itself on the next start — your coins are safe.".to_string(),
            )
        } else {
            (Phase::Stopped, "The node isn't running.".to_string())
        };
        return StatusReport { running: false, phase, headline, blocks: None, peers: None, last_shutdown };
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
            // Running (pid present) but RPC didn't answer even on retry: it's
            // busy/warming up, not "starting from scratch". Say so, and let the
            // UI keep the last-known peers/height rather than blanking them.
            return StatusReport {
                running: true,
                phase: Phase::Starting,
                headline: "The node is busy — reconnecting…".into(),
                blocks: None,
                peers: None,
                last_shutdown,
            }
        }
    };

    let blocks = rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64());
    let staking = rpc.call("getstakingstatus", json!([])).unwrap_or(json!({}));
    let tip_age = tip_age_secs(&rpc);
    let h = state::assess(peers, tip_age, &staking);
    StatusReport {
        running: true,
        phase: h.phase,
        headline: h.headline,
        blocks,
        peers: Some(peers),
        last_shutdown,
    }
}
