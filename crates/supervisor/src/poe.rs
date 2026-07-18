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

// Anchor economics, in satoshis so the arithmetic is exact.
const FEE_SATS: i64 = 10_000; // 0.0001 DIVI
const MIN_CHANGE_SATS: i64 = 1_000; // keep change comfortably above dust

fn is_sha256_hex(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A JSON amount (DIVI, up to 8 decimals) as integer satoshis.
fn to_sats(v: &Value) -> i64 {
    (v.as_f64().unwrap_or(0.0) * 1e8).round() as i64
}

/// Anchor `hash_hex` (a 32-byte SHA-256, 64 hex chars) on-chain. Returns the txid.
pub fn timestamp(cfg: &NodeConfig, hash_hex: &str) -> Result<String, String> {
    let hash_hex = hash_hex.trim().to_lowercase();
    if !is_sha256_hex(&hash_hex) {
        return Err("That doesn't look like a SHA-256 hash.".into());
    }
    let rpc = RpcClient::new(cfg);

    // Pick the SMALLEST spendable output that still covers the fee plus a
    // non-dust change. Smallest-sufficient leaves the big coins (and any stake
    // riding on them) untouched, keeps the amount small enough that satoshi math
    // stays exact, and never builds a dust/zero-change tx the node would reject.
    let need_sats = FEE_SATS + MIN_CHANGE_SATS;
    let unspent = rpc.call("listunspent", json!([]))?;
    let utxo = unspent
        .as_array()
        .and_then(|a| {
            a.iter()
                .filter(|u| {
                    u["spendable"].as_bool().unwrap_or(false) && to_sats(&u["amount"]) >= need_sats
                })
                .min_by_key(|u| to_sats(&u["amount"]))
        })
        .ok_or("You need a little spendable DIVI (about 0.0002) to anchor a timestamp.")?;

    let change_sats = to_sats(&utxo["amount"]) - FEE_SATS; // >= MIN_CHANGE_SATS by selection
    let change = change_sats as f64 / 1e8;

    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();
    // The change (the whole input minus the fee) returns here, so make sure the
    // node agrees this address is really ours before we sign the input away --
    // a tampered/proxied node can't redirect the funds without failing this.
    let val = rpc.call("validateaddress", json!([change_addr]))?;
    if !val["ismine"].as_bool().unwrap_or(false) {
        return Err("Change address is not owned by this wallet; aborting for safety.".into());
    }

    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);
    let record_hex = format!("{}{}", RECORD_PREFIX, hash_hex);

    // Prefer the "data" convention (divid wraps it in OP_META for us). Some
    // builds reject it ("value is type str, expected real") -- fall back to a
    // raw OP_META script output: 0x6a + single-byte push length + payload.
    let mut outs = serde_json::Map::new();
    outs.insert(change_addr.clone(), json!(change));
    outs.insert("data".into(), json!(record_hex));
    let raw = match rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)])) {
        Ok(v) => v,
        Err(_) => {
            let script = format!("6a{:02x}{}", record_hex.len() / 2, record_hex);
            let mut outs = serde_json::Map::new();
            outs.insert(change_addr, json!(change));
            outs.insert(script, json!(0));
            rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)]))?
        }
    };
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
    // magic "DVXP"(4) | ver(1)=01 | type(1)=01 PoE | alg(1)=01 SHA-256 | hash(32)
    // => 39 bytes => 78 hex. Pin version and hash-algorithm too, so a record with
    // a different layout/algorithm can't be read as a SHA-256 v1 PoE match.
    if payload.len() < 78
        || !payload.starts_with("44565850") // "DVXP"
        || &payload[8..10] != "01" // version 1
        || &payload[10..12] != "01" // type PoE
        || &payload[12..14] != "01"
    // hashAlg SHA-256
    {
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

    // Scan EVERY output for a matching anchor -- a transaction may carry more
    // than one PoE record, and checking only the first would falsely report a
    // genuine anchor in a later output as "no match".
    let matched = tx["vout"]
        .as_array()
        .map(|vouts| {
            vouts.iter().any(|v| {
                v["scriptPubKey"]["hex"]
                    .as_str()
                    .and_then(parse_poe_hash)
                    .as_deref()
                    == Some(hash_hex.as_str())
            })
        })
        .unwrap_or(false);
    Ok(Proof {
        matched,
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
    fn rejects_wrong_version_type_or_alg() {
        let hash = "a".repeat(64);
        // wrong version(02..), wrong type(..02..), wrong alg(..02) each rejected
        for prefix in ["44565850020101", "44565850010201", "44565850010102"] {
            let script = format!("6a27{}{}", prefix, hash);
            assert_eq!(parse_poe_hash(&script), None, "should reject prefix {prefix}");
        }
        // the fully-correct DVXP/v1/PoE/SHA-256 record still parses
        let good = format!("6a27{}{}", RECORD_PREFIX, hash);
        assert_eq!(parse_poe_hash(&good).as_deref(), Some(hash.as_str()));
    }

    #[test]
    fn rejects_non_sha256() {
        assert!(!is_sha256_hex("abc"));
        assert!(is_sha256_hex(&"a".repeat(64)));
    }
}
