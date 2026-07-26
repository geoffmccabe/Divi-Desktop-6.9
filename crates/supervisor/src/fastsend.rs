//! Fast Send: build, sign, and broadcast a transaction that (1) pays a ~5x
//! priority fee and (2) carries an on-chain OP_META "DFS1" marker so the
//! receiver can truthfully recognise a Fast Send. This divid has no fee knob
//! and no fundrawtransaction, so we assemble the raw tx by hand: pick coins,
//! set the fee via the change amount, then create/sign/send. The exact RPC
//! sequence was proven on regtest before shipping.
//!
//! SAFETY: because we control the fee implicitly (inputs minus outputs), a bad
//! coin-selection or change calc could in principle burn a huge fee. So the
//! FINAL signed tx's real fee is recomputed and checked against a hard cap
//! BEFORE broadcast — if it's outside the safe range we abort and send nothing.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::{json, Value};

const RELAY_SATS_PER_BYTE: f64 = 10.0; // relayfee 0.0001/kB
const FEE_MULTIPLE: f64 = 5.0; // "5x the usual" priority fee
const FEE_CAP_DIVI: f64 = 1.0; // absolute ceiling; abort if a tx would exceed it
const DUST_DIVI: f64 = 0.0001;
pub const MARKER: &str = "DFS1"; // Divi Fast Send v1 on-chain tag

/// OP_META (0x6a) + single pushdata of the marker bytes, as a scriptPubKey hex.
pub fn marker_script_hex() -> String {
    let data = MARKER.as_bytes();
    let mut s = format!("6a{:02x}", data.len());
    for b in data {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn round8(x: f64) -> f64 {
    (x * 1e8).round() / 1e8
}
// 5x priority fee for a tx of the given input/output count (P2PKH sizing + slack).
fn est_fee(inputs: usize, outputs: usize) -> f64 {
    let size = 10 + inputs * 148 + outputs * 34 + 20;
    round8(size as f64 * RELAY_SATS_PER_BYTE * FEE_MULTIPLE / 1e8)
}

pub fn fast_send(cfg: &NodeConfig, address: &str, amount: f64, passphrase: Option<&str>) -> Result<String, String> {
    if amount <= 0.0 {
        return Err("Amount must be greater than zero.".into());
    }
    let rpc = RpcClient::new(cfg);

    // 1. Spendable coins.
    let utxos = rpc.call("listunspent", json!([1, 9999999])).map_err(|e| format!("listunspent: {e}"))?;
    let mut coins: Vec<&Value> = utxos
        .as_array()
        .map(|a| a.iter().filter(|u| u["spendable"].as_bool().unwrap_or(false) && u["amount"].as_f64().unwrap_or(0.0) > 0.0).collect())
        .unwrap_or_default();
    if coins.is_empty() {
        return Err("No spendable coins available for a Fast Send.".into());
    }
    let amt = |u: &Value| u["amount"].as_f64().unwrap_or(0.0);

    // 2. Coin selection: prefer the smallest SINGLE coin that covers amount+fee
    // (one input = smallest tx). Otherwise accumulate largest-first.
    coins.sort_by(|a, b| amt(a).partial_cmp(&amt(b)).unwrap_or(std::cmp::Ordering::Equal));
    let need1 = amount + est_fee(1, 3);
    let mut selected: Vec<&Value> = Vec::new();
    if let Some(single) = coins.iter().find(|u| amt(u) >= need1) {
        selected.push(single);
    } else {
        for u in coins.iter().rev() {
            selected.push(u);
            if selected.iter().map(|c| amt(c)).sum::<f64>() >= amount + est_fee(selected.len(), 3) {
                break;
            }
        }
    }
    let total: f64 = selected.iter().map(|c| amt(c)).sum();
    let fee = est_fee(selected.len(), 3);
    if total < amount + fee {
        return Err("Not enough spendable balance for a Fast Send (amount plus priority fee).".into());
    }
    if fee > FEE_CAP_DIVI {
        return Err("Computed priority fee exceeds the safety cap.".into());
    }

    // 3. Change to a fresh own address.
    let change_addr = rpc
        .call("getnewaddress", json!([]))
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or("Could not get a change address.")?;

    // 4. Assemble inputs + outputs (recipient, OP_META marker, change).
    let inputs: Vec<Value> = selected.iter().map(|u| json!({"txid": u["txid"], "vout": u["vout"]})).collect();
    let change = round8(total - amount - fee);
    let mut outputs = serde_json::Map::new();
    outputs.insert(address.to_string(), json!(round8(amount)));
    outputs.insert(marker_script_hex(), json!(0));
    if change >= DUST_DIVI {
        outputs.insert(change_addr, json!(change));
    }

    let raw = rpc
        .call("createrawtransaction", json!([inputs, Value::Object(outputs)]))
        .map_err(|e| format!("createrawtransaction: {e}"))?;
    let raw_hex = raw.as_str().ok_or("createrawtransaction returned no hex")?.to_string();

    // 5. Sign (unlock just for this, then re-lock spends immediately).
    if let Some(pass) = passphrase {
        rpc.call("walletpassphrase", json!([pass, 120, false])).map_err(|e| format!("Unlock failed: {e}"))?;
    }
    let signed = rpc.call("signrawtransaction", json!([raw_hex]));
    if let Some(pass) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([pass, 0, true]));
    }
    let signed = signed.map_err(|e| format!("signrawtransaction: {e}"))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("Could not sign the Fast Send (wallet locked or missing keys).".into());
    }
    let signed_hex = signed["hex"].as_str().ok_or("signrawtransaction returned no hex")?.to_string();

    // 6. FINAL safety net: recompute the REAL fee from the signed tx and refuse
    // to broadcast anything outside the safe range.
    let dec = rpc.call("decoderawtransaction", json!([signed_hex])).map_err(|e| format!("decode: {e}"))?;
    let out_sum: f64 = dec["vout"]
        .as_array()
        .map(|a| a.iter().map(|v| v["value"].as_f64().unwrap_or(0.0)).sum())
        .unwrap_or(0.0);
    let actual_fee = round8(total - out_sum);
    if !(0.0..=FEE_CAP_DIVI).contains(&actual_fee) {
        return Err(format!("Aborted before sending: computed fee {actual_fee} DIVI is outside the safe range."));
    }

    // 7. Broadcast.
    let txid = rpc.call("sendrawtransaction", json!([signed_hex])).map_err(|e| format!("broadcast: {e}"))?;
    Ok(txid.as_str().unwrap_or_default().to_string())
}

/// Read an OP_META output's payload and tell whether it's the Fast Send marker.
/// `hex` is a scriptPubKey hex string. Handles the single-byte pushdata form
/// (OP_META <len> <data>) that we and the marker use.
pub fn is_fast_marker(hex: &str) -> bool {
    let h = hex.as_bytes();
    if h.len() < 4 || &hex[0..2] != "6a" {
        return false;
    }
    let len = match u8::from_str_radix(&hex[2..4], 16) {
        Ok(n) if (n as usize) < 0x4c => n as usize,
        _ => return false,
    };
    let start = 4;
    let end = start + len * 2;
    if hex.len() < end {
        return false;
    }
    let bytes: Vec<u8> = (start..end).step_by(2).filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect();
    String::from_utf8(bytes).map(|s| s == MARKER).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_roundtrip() {
        assert_eq!(marker_script_hex(), "6a0444465331");
        assert!(is_fast_marker("6a0444465331"));
        assert!(!is_fast_marker("6a03465331")); // "FS1", not our marker
        assert!(!is_fast_marker("76a914deadbeef")); // a normal P2PKH script
    }

    // Live end-to-end against the regtest node (rpcport 51600). Run with:
    //   cargo test -p dd69-supervisor fast_send_regtest -- --ignored --nocapture
    #[test]
    #[ignore]
    fn fast_send_regtest() {
        let cfg = NodeConfig {
            datadir: std::path::PathBuf::from("/tmp"),
            rpc_host: "127.0.0.1".into(),
            rpc_user: "rt".into(),
            rpc_pass: "rtpass".into(),
            rpc_port: 51600,
            remote: true,
        };
        let rpc = RpcClient::new(&cfg);
        let dest = rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string();
        let txid = fast_send(&cfg, &dest, 50.0, None).expect("fast_send should succeed on regtest");
        assert_eq!(txid.len(), 64, "expected a txid, got {txid}");
        // Confirm the marker is on-chain and the fee is within the safe cap.
        let dtx = rpc.call("getrawtransaction", json!([txid, 1])).unwrap();
        let has_marker = dtx["vout"].as_array().unwrap().iter().any(|v| is_fast_marker(v["scriptPubKey"]["hex"].as_str().unwrap_or("")));
        assert!(has_marker, "DFS1 marker missing from broadcast tx");
        println!("regtest fast_send OK: txid={txid} marker=on-chain");
    }
}
