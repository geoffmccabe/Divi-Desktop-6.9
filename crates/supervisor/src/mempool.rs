//! Live mempool snapshot for the map's Mempool panel. This reads OUR node's
//! mempool, which is the network mempool as our node has heard it over P2P
//! gossip. A wallet cannot force peers to hand over their mempool on demand
//! (Divi has no per-peer mempool RPC), so "staying current" means polling our
//! own node quickly while the node keeps itself synced from its peers.
//!
//! Classifying a tx as "mine" is authoritative: `gettransaction` returns wallet
//! details only for the user's own transactions (inputs OR outputs), and errors
//! for everyone else's. We only decode txids the client hasn't classified yet,
//! so a fast poll loop stays cheap even though each new tx costs a call or two.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

pub struct MemEntry {
    pub txid: String,
    pub size: i64,
    pub fee_sats: i64,
    pub time: i64,
    /// True only when this entry was decoded THIS call (a txid new to the
    /// client). For already-known txids the client keeps its stored flags.
    pub decoded: bool,
    pub mine: bool,
    /// "receive" | "send" | "" — from the wallet's own view of the tx.
    pub category: String,
    /// Net amount to/from the user's wallet, DIVI (0 when not mine).
    pub amount_mine: f64,
    /// Carries an OP_META data payload (a "message", payment request, etc.).
    pub has_data: bool,
}

pub struct MemSnapshot {
    pub tip: i64,
    pub best_hash: String,
    pub entries: Vec<MemEntry>,
}

/// Snapshot the mempool. `known` = txids the client already has classified, so
/// we skip re-decoding them and only pay for genuinely new transactions.
pub fn snapshot(cfg: &NodeConfig, known: &[String]) -> Option<MemSnapshot> {
    let rpc = RpcClient::new(cfg);
    let tip = rpc.call("getblockcount", json!([])).ok().and_then(|v| v.as_i64())?;
    let best_hash = rpc
        .call("getbestblockhash", json!([]))
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();

    // Verbose mempool: one call gives every txid with size, fee and first-seen
    // time. This is the whole picture; decoding below only adds ownership.
    let raw = rpc.call("getrawmempool", json!([true])).ok()?;
    let obj = raw.as_object()?;

    let known: std::collections::HashSet<&str> = known.iter().map(String::as_str).collect();
    let mut entries = Vec::with_capacity(obj.len());
    let mut decoded_budget = 80; // cap per snapshot so a flood can't stall the poll

    for (txid, info) in obj {
        let size = info["size"].as_i64().or_else(|| info["vsize"].as_i64()).unwrap_or(0);
        let fee_sats = (info["fee"].as_f64().unwrap_or(0.0) * 1e8).round() as i64;
        let time = info["time"].as_i64().unwrap_or(0);

        let mut e = MemEntry {
            txid: txid.clone(),
            size,
            fee_sats,
            time,
            decoded: false,
            mine: false,
            category: String::new(),
            amount_mine: 0.0,
            has_data: false,
        };

        if !known.contains(txid.as_str()) && decoded_budget > 0 {
            decoded_budget -= 1;
            e.decoded = true;
            classify(&rpc, txid, &mut e);
        }
        entries.push(e);
    }

    Some(MemSnapshot { tip, best_hash, entries })
}

/// Fill in mine/category/amount (from the wallet) and has_data (from the raw
/// script), for a txid the client hasn't seen before.
fn classify(rpc: &RpcClient, txid: &str, e: &mut MemEntry) {
    // `gettransaction` succeeds only for the wallet's own txs — the honest,
    // authoritative "is this mine" that covers both spending and receiving.
    if let Ok(wtx) = rpc.call("gettransaction", json!([txid])) {
        e.mine = true;
        e.amount_mine = wtx["amount"].as_f64().unwrap_or(0.0);
        // The per-detail category is the clearest label for the direction.
        e.category = wtx["details"][0]["category"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| if e.amount_mine >= 0.0 { "receive".into() } else { "send".into() });
    }

    // Detect an OP_META data output ("message" / payment request / anchor).
    if let Ok(dtx) = rpc.call("getrawtransaction", json!([txid, 1])) {
        if let Some(vouts) = dtx["vout"].as_array() {
            e.has_data = vouts.iter().any(|v| {
                let asm = v["scriptPubKey"]["asm"].as_str().unwrap_or("");
                let hex = v["scriptPubKey"]["hex"].as_str().unwrap_or("");
                asm.starts_with("OP_META") || asm.starts_with("OP_RETURN") || hex.starts_with("6a")
            });
        }
    }
}
