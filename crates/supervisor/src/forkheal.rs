//! Heal a node stuck on a stale fork.
//!
//! Seen 2026-Oct-02 on Geoff's desktop: the node had split from the network
//! at one block a day earlier and kept staking on its own chain. Every peer
//! that offered the real chain was marked "misbehaving" for "bad" blocks and
//! banned, so it ended with no peers and no way back. The node's log said so
//! on every attempt: "forked chain older than max reorganization depth
//! (height N)", N being the block where the two chains part. The node will
//! not reorganise that deep by itself; told that its own block N is invalid,
//! it drops the fork, and with the bans cleared it syncs the real chain. That
//! is exactly what was done by hand; here it is done by the watchdog.
//!
//! Guards: at least `MIN_HITS` such lines in the recent log, all naming the
//! same height; the node must have no peers (the symptom that makes it
//! stuck; a node with peers that merely sees a rival branch is left alone);
//! once per height per hour. Every step is logged, and `reconsiderblock`
//! undoes it if a human disagrees.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::time::{Duration, Instant};

const TAIL_BYTES: u64 = 256 * 1024;
const MIN_HITS: usize = 5;
const RETRY_AFTER: Duration = Duration::from_secs(60 * 60);

/// The height named in the node's complaint, if it is complaining enough.
pub fn stuck_fork_height(datadir: &std::path::Path) -> Option<i64> {
    let path = datadir.join("debug.log");
    let mut f = File::open(&path).ok()?;
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES))).ok()?;
    let mut raw = Vec::new();
    f.read_to_end(&mut raw).ok()?;
    heights_in(&String::from_utf8_lossy(&raw))
}

fn heights_in(log: &str) -> Option<i64> {
    const NEEDLE: &str = "forked chain older than max reorganization depth (height ";
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for line in log.lines() {
        let Some(i) = line.find(NEEDLE) else { continue };
        let rest = &line[i + NEEDLE.len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(h) = digits.parse::<i64>() {
            *counts.entry(h).or_insert(0) += 1;
        }
    }
    counts.into_iter().filter(|(_, n)| *n >= MIN_HITS).max_by_key(|(_, n)| *n).map(|(h, _)| h)
}

pub struct Healer {
    tried: HashMap<i64, Instant>,
}

impl Healer {
    pub fn new() -> Self {
        Healer { tried: HashMap::new() }
    }

    /// One watchdog check. Returns what it did, if anything.
    pub fn check(&mut self, cfg: &NodeConfig) -> Option<String> {
        let height = stuck_fork_height(&cfg.datadir)?;
        if let Some(t) = self.tried.get(&height) {
            if t.elapsed() < RETRY_AFTER {
                return None;
            }
        }
        let rpc = RpcClient::new(cfg);
        let peers = rpc.call("getconnectioncount", json!([])).ok()?.as_i64()?;
        if peers > 0 {
            return None;
        }
        self.tried.insert(height, Instant::now());
        let ours = rpc.call("getblockhash", json!([height])).ok()?.as_str()?.to_string();
        crate::setuplog::log(format!(
            "fork: the node is on a stale fork from block {height} ({}…) with no peers; dropping that block and clearing bans so it rejoins the network",
            &ours[..ours.len().min(12)]
        ));
        if let Err(e) = rpc.call("invalidateblock", json!([ours])) {
            crate::setuplog::log(format!("fork: invalidateblock failed: {e}"));
            return None;
        }
        let _ = rpc.call("clearbanned", json!([]));
        for seed in crate::install::SEED_PEERS.iter().take(2) {
            let _ = rpc.call("addnode", json!([seed, "onetry"]));
        }
        Some(format!("left the stale fork at block {height}; syncing the real chain"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_repeated_complaints_about_one_height() {
        let one = "2026-10-02 ERROR: ContextualCheckBlockHeader: forked chain older than max reorganization depth (height 4239430)\n";
        assert_eq!(heights_in(&one.repeat(2)), None);
        assert_eq!(heights_in(&one.repeat(6)), Some(4239430));
        let mixed = format!("{}{}", one.repeat(6), "x forked chain older than max reorganization depth (height 7)\n".repeat(9));
        assert_eq!(heights_in(&mixed), Some(7));
        assert_eq!(heights_in("nothing here"), None);
    }
}
