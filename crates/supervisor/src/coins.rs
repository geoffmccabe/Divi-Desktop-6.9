//! Coin maturity for staking. Divi mainnet rule (verified against core source,
//! wallet.cpp SelectStakeCoins): a normal received output becomes stakeable once
//! it is BOTH ≥ 1 hour old (nMinCoinAgeForStaking = 3600s) AND ≥ 10 confirmations
//! deep. At ~60s blocks the 10-confirmation floor (~10 min) is always reached long
//! before the 1-hour age, so the 1-hour coin-age is the binding constraint.
//!
//! We estimate a UTXO's age from its confirmation count (~60s per block) so the
//! whole panel costs a single `listunspent` call — important while the node is
//! under load. The countdown is therefore approximate, not exact.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

const MATURE_SECS: f64 = 3600.0; // 1 hour coin-age
const MIN_CONFS: i64 = 10; // depth floor for a normal (non-coinstake) output
const BLOCK_SECS: f64 = 60.0; // ~60s target block time → age estimate

pub struct Utxo {
    pub address: String,
    pub amount: f64,
    pub confirmations: i64,
    pub matured: bool,
    pub pct: f64,          // 0..100 toward stakeable
    pub stakeable_at: i64, // unix seconds (0 once matured)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Every unspent output with how mature it is for staking, combined across all
/// of the wallet's addresses. Immature (still-aging) ones first, soonest to
/// mature at the top.
pub fn coin_maturity(cfg: &NodeConfig) -> Vec<Utxo> {
    let rpc = RpcClient::new(cfg);
    // minconf 0 so freshly-received coins show up immediately as "0%".
    let arr = rpc.call("listunspent", json!([0, 9_999_999])).unwrap_or(json!([]));
    let now = now_unix();
    let mut out = Vec::new();
    if let Some(items) = arr.as_array() {
        for u in items {
            let amount = u["amount"].as_f64().unwrap_or(0.0);
            let confs = u["confirmations"].as_i64().unwrap_or(0).max(0);
            let address = u["address"].as_str().unwrap_or("").to_string();

            let age = confs as f64 * BLOCK_SECS;
            let age_ratio = (age / MATURE_SECS).min(1.0);
            let conf_ratio = (confs as f64 / MIN_CONFS as f64).min(1.0);
            let pct = age_ratio.min(conf_ratio) * 100.0;
            let matured = age >= MATURE_SECS && confs >= MIN_CONFS;

            // seconds still to wait = whichever constraint finishes last
            let secs_left = ((MATURE_SECS - age).max(0.0))
                .max(((MIN_CONFS - confs).max(0)) as f64 * BLOCK_SECS);
            let stakeable_at = if matured { 0 } else { now + secs_left as i64 };

            out.push(Utxo { address, amount, confirmations: confs, matured, pct, stakeable_at });
        }
    }
    // Immature first (soonest-to-mature on top), then matured by size.
    out.sort_by(|a, b| {
        a.matured
            .cmp(&b.matured)
            .then(a.stakeable_at.cmp(&b.stakeable_at))
            .then(b.amount.partial_cmp(&a.amount).unwrap_or(std::cmp::Ordering::Equal))
    });
    out
}
