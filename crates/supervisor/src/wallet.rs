//! Wallet reads/actions over the local node RPC. Read-only helpers (balance,
//! addresses, activity, validation) are safe. Sending money lives in 4b and
//! will go through explicit confirmation + unlock — not here yet.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;
use std::collections::{HashMap, HashSet};

pub struct AddrInfo {
    pub address: String,
    pub is_main: bool,
    pub receives: i64,
    pub sends: i64,
    pub stakes: i64,
}

/// The account's deposit addresses that have seen activity (plus the main one),
/// with per-address counts by category. Counts are tallied from recent history.
pub fn addresses(cfg: &NodeConfig) -> Vec<AddrInfo> {
    let rpc = RpcClient::new(cfg);
    let main = rpc
        .call("getaccountaddress", json!([""]))
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    let mut map: HashMap<String, (i64, i64, i64)> = HashMap::new();
    if let Ok(txs) = rpc.call("listtransactions", json!(["*", 1000])) {
        if let Some(arr) = txs.as_array() {
            for t in arr {
                let addr = t["address"].as_str().unwrap_or("");
                if addr.is_empty() {
                    continue;
                }
                let e = map.entry(addr.to_string()).or_insert((0, 0, 0));
                let cat = t["category"].as_str().unwrap_or("");
                if cat == "receive" {
                    e.0 += 1;
                } else if cat == "send" {
                    e.1 += 1;
                } else if is_stake_cat(cat) {
                    e.2 += 1;
                }
            }
        }
    }
    if let Some(m) = &main {
        map.entry(m.clone()).or_insert((0, 0, 0));
    }

    let mut out: Vec<AddrInfo> = map
        .into_iter()
        .map(|(address, (r, s, st))| {
            let is_main = main.as_deref() == Some(address.as_str());
            AddrInfo { address, is_main, receives: r, sends: s, stakes: st }
        })
        .collect();
    // Main first, then busiest.
    out.sort_by(|a, b| {
        b.is_main
            .cmp(&a.is_main)
            .then((b.receives + b.sends + b.stakes).cmp(&(a.receives + a.sends + a.stakes)))
    });
    out
}

pub struct Balance {
    pub spendable: f64,
    pub staking: f64,
    pub pending: f64,
    pub immature: f64,
}

// ── Staking details ────────────────────────────────────────────────────────

/// One address's staking picture: how much sits there ("size"), how many times
/// it has staked, and when it first/last staked.
pub struct StakeWallet {
    pub address: String,
    pub size: f64,
    pub stakes: i64,
    pub first_stake: Option<i64>,
    pub last_stake: Option<i64>,
}

fn is_stake_cat(c: &str) -> bool {
    // Divi reports staking rewards as "stake_reward" (also stake/stake_split/
    // orphaned_stake on other builds); coinbase-style rewards as generate/mint.
    c.contains("stake") || matches!(c, "generate" | "mint" | "immature" | "orphan")
}

/// The wallet's addresses that hold stakeable coins and/or have staked, largest
/// first. Size comes from spendable UTXOs; stake counts/dates from history.
pub fn staking_wallets(cfg: &NodeConfig) -> Vec<StakeWallet> {
    let rpc = RpcClient::new(cfg);

    // Size = sum of spendable outputs per address (what can actually stake).
    let mut size: HashMap<String, f64> = HashMap::new();
    if let Ok(u) = rpc.call("listunspent", json!([1, 9_999_999])) {
        if let Some(arr) = u.as_array() {
            for o in arr {
                if let Some(a) = o["address"].as_str() {
                    *size.entry(a.to_string()).or_insert(0.0) += o["amount"].as_f64().unwrap_or(0.0);
                }
            }
        }
    }

    // Stake count + first/last stake time per address.
    let mut stakes: HashMap<String, (i64, Option<i64>, Option<i64>)> = HashMap::new();
    if let Ok(txs) = rpc.call("listtransactions", json!(["*", 2000])) {
        if let Some(arr) = txs.as_array() {
            for t in arr {
                let addr = t["address"].as_str().unwrap_or("");
                if addr.is_empty() || !is_stake_cat(t["category"].as_str().unwrap_or("")) {
                    continue;
                }
                let time = t["time"].as_i64();
                let e = stakes.entry(addr.to_string()).or_insert((0, None, None));
                e.0 += 1;
                if let Some(ts) = time {
                    e.1 = Some(e.1.map_or(ts, |f: i64| f.min(ts)));
                    e.2 = Some(e.2.map_or(ts, |l: i64| l.max(ts)));
                }
            }
        }
    }

    let mut keys: std::collections::HashSet<String> = HashSet::new();
    keys.extend(size.keys().cloned());
    keys.extend(stakes.keys().cloned());

    let mut out: Vec<StakeWallet> = keys
        .into_iter()
        .map(|address| {
            let s = stakes.get(&address).copied().unwrap_or((0, None, None));
            StakeWallet {
                size: *size.get(&address).unwrap_or(&0.0),
                stakes: s.0,
                first_stake: s.1,
                last_stake: s.2,
                address,
            }
        })
        .filter(|w| w.size > 0.0 || w.stakes > 0)
        .collect();
    out.sort_by(|a, b| b.size.partial_cmp(&a.size).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Lottery cycle parameters (start height, blocks per cycle) for the active
/// network. Divi runs a weekly lottery (10080 one-minute blocks); regtest is 10.
fn lottery_cycle(rpc: &RpcClient) -> (i64, i64) {
    let chain = rpc
        .call("getblockchaininfo", json!([]))
        .ok()
        .and_then(|v| v["chain"].as_str().map(str::to_string))
        .unwrap_or_default();
    match chain.as_str() {
        "regtest" => (101, 10),
        _ => (101, 10080), // main + test: weekly
    }
}

/// Where and (roughly) when the next lottery draw happens. `next_eta` is an
/// estimate (blocks-remaining × ~60s), so the UI should label it approximate.
pub struct LotteryInfo {
    pub tip: i64,
    pub next_height: i64,
    pub next_eta: i64,
}

pub fn lottery_info(cfg: &NodeConfig) -> Option<LotteryInfo> {
    let rpc = RpcClient::new(cfg);
    let tip = rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64())?;
    let (_, cycle) = lottery_cycle(&rpc);
    let next_height = (tip / cycle + 1) * cycle;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let next_eta = now + (next_height - tip) * 60;
    Some(LotteryInfo { tip, next_height, next_eta })
}

/// How many big (rank 0) and small (ranks 1-10) lottery prizes each of `addrs`
/// has won, by scanning historical lottery blocks. NOTE: derived from
/// getlotteryblockwinners; verify the totals against a synced mainnet node
/// before presenting them as authoritative.
pub struct LotteryWin {
    pub address: String,
    pub big: i64,
    pub small: i64,
}

pub fn lottery_wins(cfg: &NodeConfig, addrs: &[String]) -> Vec<LotteryWin> {
    let rpc = RpcClient::new(cfg);
    let want: HashSet<&str> = addrs.iter().map(|s| s.as_str()).collect();
    let mut tally: HashMap<String, (i64, i64)> = HashMap::new();

    let tip = match rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64()) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let (_, cycle) = lottery_cycle(&rpc);
    let mut h = cycle; // lottery blocks fall on multiples of the cycle
    let mut scanned = 0;
    while h <= tip && scanned < 4000 {
        if let Ok(v) = rpc.call("getlotteryblockwinners", json!([h])) {
            if let Some(cands) = v["Lottery Candidates"].as_array() {
                for c in cands {
                    let rank = c["Rank"].as_i64().unwrap_or(-1);
                    for a in c["Address"].as_str().unwrap_or("").split(':') {
                        if want.contains(a) {
                            let e = tally.entry(a.to_string()).or_insert((0, 0));
                            if rank == 0 {
                                e.0 += 1;
                            } else if rank > 0 {
                                e.1 += 1;
                            }
                        }
                    }
                }
            }
        }
        h += cycle;
        scanned += 1;
    }

    tally
        .into_iter()
        .map(|(address, (big, small))| LotteryWin { address, big, small })
        .collect()
}

pub fn balance(cfg: &NodeConfig) -> Option<Balance> {
    let rpc = RpcClient::new(cfg);
    let w = rpc.call("getwalletinfo", json!([])).ok()?;
    let f = |k: &str| w[k].as_f64().unwrap_or(0.0);
    Some(Balance {
        // Older Divi exposes spendable_balance; fall back to plain balance.
        spendable: if w.get("spendable_balance").is_some() {
            f("spendable_balance")
        } else {
            f("balance")
        },
        staking: f("staking_balance"),
        pending: f("unconfirmed_balance"),
        immature: f("immature_balance"),
    })
}

pub fn new_address(cfg: &NodeConfig) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    rpc.call("getnewaddress", json!([]))?
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "the node returned no address".into())
}

pub fn is_valid_address(cfg: &NodeConfig, addr: &str) -> bool {
    let rpc = RpcClient::new(cfg);
    rpc.call("validateaddress", json!([addr]))
        .ok()
        .and_then(|v| v["isvalid"].as_bool())
        .unwrap_or(false)
}

pub struct Tx {
    pub kind: String, // receive | send | stake | other
    pub amount: f64,
    pub address: String,
    pub confirmations: i64,
    pub txid: String,
    pub time: i64,
}

/// A page of wallet transactions (from `listtransactions`, a fast local read —
/// no chain re-parse). `from` skips that many of the most-recent txs. Returns
/// None if the node couldn't be reached (so the UI can distinguish "offline"
/// from "genuinely no transactions").
pub fn list(cfg: &NodeConfig, count: i64, from: i64) -> Option<Vec<Tx>> {
    let rpc = RpcClient::new(cfg);
    let v = rpc.call("listtransactions", json!(["*", count, from])).ok()?;
    let arr = v.as_array()?;
    Some(arr.iter().map(tx_from_json).collect())
}

fn tx_from_json(t: &serde_json::Value) -> Tx {
    let cat = t["category"].as_str().unwrap_or("");
    let kind = if cat == "receive" {
        "receive"
    } else if cat == "send" {
        "send"
    } else if is_stake_cat(cat) {
        "stake"
    } else {
        "other"
    };
    Tx {
        kind: kind.to_string(),
        amount: t["amount"].as_f64().unwrap_or(0.0),
        address: t["address"].as_str().unwrap_or("").to_string(),
        confirmations: t["confirmations"].as_i64().unwrap_or(0),
        txid: t["txid"].as_str().unwrap_or("").to_string(),
        time: t["time"].as_i64().unwrap_or(0),
    }
}

pub fn recent(cfg: &NodeConfig, count: i64) -> Vec<Tx> {
    let rpc = RpcClient::new(cfg);
    let Ok(v) = rpc.call("listtransactions", json!(["*", count])) else {
        return vec![];
    };
    let Some(arr) = v.as_array() else { return vec![] };
    // listtransactions is oldest-first; show newest-first.
    let mut out: Vec<Tx> = arr
        .iter()
        .rev()
        .map(|t| {
            let cat = t["category"].as_str().unwrap_or("");
            let kind = if cat == "receive" {
                "receive"
            } else if cat == "send" {
                "send"
            } else if is_stake_cat(cat) {
                "stake"
            } else {
                "other"
            };
            Tx {
                kind: kind.to_string(),
                amount: t["amount"].as_f64().unwrap_or(0.0),
                address: t["address"].as_str().unwrap_or("").to_string(),
                confirmations: t["confirmations"].as_i64().unwrap_or(0),
                txid: t["txid"].as_str().unwrap_or("").to_string(),
                time: t["time"].as_i64().unwrap_or(0),
            }
        })
        .collect();
    out.truncate(count.max(0) as usize);
    out
}
