//! Wallet reads/actions over the local node RPC. Read-only helpers (balance,
//! addresses, activity, validation) are safe. Sending money lives in 4b and
//! will go through explicit confirmation + unlock — not here yet.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

pub struct Balance {
    pub spendable: f64,
    pub staking: f64,
    pub pending: f64,
    pub immature: f64,
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
            let kind = match t["category"].as_str().unwrap_or("") {
                "receive" => "receive",
                "send" => "send",
                "generate" | "immature" | "stake" | "mint" | "orphan" => "stake",
                _ => "other",
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
