//! Stale ("orphan") blocks, from `getchaintips`.
//!
//! When two stakers mint a block at the same height, one wins and the other
//! becomes a stale block. `getchaintips` lists every branch tip our node has
//! seen: the one marked `active` is the real chain, the rest lost.
//!
//! Two honesty caveats that the UI must not paper over:
//!   * This is LOCAL knowledge. Our node only knows about a stale block if it
//!     personally received it. Another node may have seen more or fewer.
//!   * The list lives in memory, so it starts empty at every node restart. The
//!     rate is "what we've seen since we started", not an absolute chain metric.

//! ⚠ COST: getchaintips is NOT a cheap call. Measured on a healthy node at the
//! 4.1M-block tip it takes ~18 SECONDS (a normal call is ~9ms) and it holds the
//! daemon's main lock while it runs, which stalls block processing and every
//! other RPC behind it. Polling it on a timer wedged the test node solid.
//!
//! So: never call this on a schedule. It is on-demand only, and the result is
//! cached below so repeated asks are free.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a fetched report stays fresh. Generous on purpose — forks appear a
/// couple of times a day, so there is nothing to gain from asking more often.
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);

static CACHE: Mutex<Option<(Instant, OrphanReport)>> = Mutex::new(None);

#[derive(Debug, Clone)]
pub struct StaleBlock {
    pub height: i64,
    /// `valid-fork` = we fully validated it; `valid-headers` = header only.
    pub status: String,
    /// How many blocks long the losing branch was. 1 = a lone stale block.
    pub branch_len: i64,
}

#[derive(Debug, Clone, Default)]
pub struct OrphanReport {
    pub stale: Vec<StaleBlock>,
    pub tip: i64,
    /// Blocks between the oldest stale block we know of and the tip — the
    /// window the rate below is measured over.
    pub span: i64,
    /// Stale blocks as a percentage of that window.
    pub rate_pct: f64,
}

/// Returns the cached report if it is still fresh, without touching the node.
pub fn cached() -> Option<OrphanReport> {
    let g = CACHE.lock().ok()?;
    let (at, r) = g.as_ref()?;
    (at.elapsed() < CACHE_TTL).then(|| r.clone())
}

/// Fetch fork data. `force` bypasses the cache — only ever in response to a
/// direct user action, given the ~18s cost.
pub fn orphans(cfg: &NodeConfig, force: bool) -> Option<OrphanReport> {
    if !force {
        if let Some(r) = cached() {
            return Some(r);
        }
    }
    let rpc = RpcClient::new(cfg);
    // Optional: a node build without getchaintips just yields no orphan data
    // rather than an error the user has to see.
    let tips = rpc.call_optional("getchaintips", serde_json::json!([])).ok()??;
    let arr = tips.as_array()?;

    let tip = arr
        .iter()
        .filter(|t| t["status"].as_str() == Some("active"))
        .filter_map(|t| t["height"].as_i64())
        .max()
        .unwrap_or(0);

    let mut stale: Vec<StaleBlock> = arr
        .iter()
        .filter(|t| t["status"].as_str() != Some("active"))
        .filter_map(|t| {
            Some(StaleBlock {
                height: t["height"].as_i64()?,
                status: t["status"].as_str().unwrap_or("unknown").to_string(),
                branch_len: t["branchlen"].as_i64().unwrap_or(1),
            })
        })
        .collect();
    stale.sort_by_key(|s| -s.height);

    let oldest = stale.iter().map(|s| s.height).min().unwrap_or(tip);
    let span = (tip - oldest).max(0);
    let rate_pct = if span > 0 { stale.len() as f64 * 100.0 / span as f64 } else { 0.0 };

    let report = OrphanReport { stale, tip, span, rate_pct };
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((Instant::now(), report.clone()));
    }
    Some(report)
}
