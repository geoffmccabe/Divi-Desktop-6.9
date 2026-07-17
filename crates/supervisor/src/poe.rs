// Proof-of-Existence: anchor a document's SHA-256 hash on the Divi chain in an
// OP_META output, and verify a prior anchor. The document itself never reaches
// here -- the UI hashes it client-side and passes only the 32-byte hash -- so
// this module is pure hex + RPC, no file I/O and no crypto deps.
//
// Record format (shared "DVXP" envelope, see Divi-Blockchain_6.9
// docs/POE-NFT-RECORD-FORMAT.md):
//   OP_META(0x6a) PUSH(payload)
//   payload = "DVXP"(4) | version(1) | type(1)=PoE | hashAlg(1)=SHA256 | hash(32)

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::{json, Value};

// "DVXP" | version 1 | type 0x01 (PoE) | alg 0x01 (SHA-256), as hex.
const RECORD_PREFIX: &str = "44565850010101";

pub struct Proof {
    pub matched: bool,
    pub confirmations: i64,
    pub block_time: Option<i64>,
}

fn is_sha256_hex(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Anchor `hash_hex` (a 32-byte SHA-256, 64 hex chars) on-chain. Returns the txid.
pub fn timestamp(cfg: &NodeConfig, hash_hex: &str) -> Result<String, String> {
    let hash_hex = hash_hex.trim().to_lowercase();
    if !is_sha256_hex(&hash_hex) {
        return Err("That doesn't look like a SHA-256 hash.".into());
    }
    let rpc = RpcClient::new(cfg);

    // Pick the largest spendable output to cover the tiny anchor fee.
    let unspent = rpc.call("listunspent", json!([]))?;
    let utxo = unspent
        .as_array()
        .and_then(|a| {
            a.iter().max_by(|x, y| {
                let ax = x["amount"].as_f64().unwrap_or(0.0);
                let ay = y["amount"].as_f64().unwrap_or(0.0);
                ax.partial_cmp(&ay).unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .ok_or("You need a small amount of DIVI to pay the anchor fee.")?;

    let amount = utxo["amount"].as_f64().unwrap_or(0.0);
    let fee = 0.0001_f64;
    if amount < fee {
        return Err("Not enough funds for the anchor fee.".into());
    }
    let change = ((amount - fee) * 1e8).round() / 1e8;
    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();

    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);
    // "data" makes divid wrap the payload in an OP_META output automatically.
    let mut outputs = serde_json::Map::new();
    outputs.insert(change_addr, json!(change));
    outputs.insert("data".into(), json!(format!("{}{}", RECORD_PREFIX, hash_hex)));

    let raw = rpc.call("createrawtransaction", json!([inputs, Value::Object(outputs)]))?;
    let signed = rpc.call("signrawtransaction", json!([raw]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("Could not sign the anchor transaction.".into());
    }
    let txid = rpc
        .call("sendrawtransaction", json!([signed["hex"]]))?
        .as_str()
        .ok_or("the node did not return a transaction id")?
        .to_string();
    Ok(txid)
}

/// Parse a PoE record out of an OP_META scriptPubKey hex; returns the anchored
/// 32-byte hash (hex) or None. Bounds-checked against arbitrary/truncated data.
fn parse_poe_hash(script_hex: &str) -> Option<String> {
    let s = script_hex;
    if s.len() < 4 || !s.starts_with("6a") {
        return None;
    }
    // push length (single-byte push, or OP_PUSHDATA1 = 0x4c)
    let (payload_off, plen) = match &s[2..4] {
        "4c" => {
            if s.len() < 6 {
                return None;
            }
            (6usize, usize::from_str_radix(&s[4..6], 16).ok()?)
        }
        b => {
            let n = usize::from_str_radix(b, 16).ok()?;
            if n > 75 {
                return None;
            }
            (4usize, n)
        }
    };
    let payload = s.get(payload_off..payload_off + plen * 2)?; // *2: hex chars
    // magic "DVXP"(4) | ver(1) | type(1)=PoE | alg(1) | hash(32) => 39 bytes => 78 hex
    if payload.len() < 78 || !payload.starts_with("44565850") || &payload[10..12] != "01" {
        return None;
    }
    Some(payload[14..78].to_lowercase())
}

/// Verify that `txid` anchors `hash_hex`. Returns whether it matches plus its
/// confirmation depth and block time (the "existed by" timestamp).
pub fn verify(cfg: &NodeConfig, txid: &str, hash_hex: &str) -> Result<Proof, String> {
    let hash_hex = hash_hex.trim().to_lowercase();
    if !is_sha256_hex(&hash_hex) {
        return Err("That doesn't look like a SHA-256 hash.".into());
    }
    let rpc = RpcClient::new(cfg);
    let tx = rpc.call("getrawtransaction", json!([txid, 1]))?;
    let confirmations = tx["confirmations"].as_i64().unwrap_or(0);
    let block_time = tx["blocktime"].as_i64();

    let anchored = tx["vout"].as_array().and_then(|vouts| {
        vouts.iter().find_map(|v| {
            v["scriptPubKey"]["hex"]
                .as_str()
                .and_then(parse_poe_hash)
        })
    });
    Ok(Proof {
        matched: anchored.as_deref() == Some(hash_hex.as_str()),
        confirmations,
        block_time,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_poe_output() {
        let hash = "4caad21afba16c5d9ceda9cb297665040e3b88daa82201dc6b62d0d88423a061";
        let script = format!("6a27{}{}", RECORD_PREFIX, hash);
        assert_eq!(parse_poe_hash(&script).as_deref(), Some(hash));
    }

    #[test]
    fn rejects_malformed_and_foreign_outputs() {
        for bad in ["", "6a", "6a02445658", "6a2700", "ff00", "6a2744565850"] {
            assert_eq!(parse_poe_hash(bad), None, "should reject {bad}");
        }
    }

    #[test]
    fn rejects_non_sha256() {
        assert!(!is_sha256_hex("abc"));
        assert!(is_sha256_hex(&"a".repeat(64)));
    }
}
