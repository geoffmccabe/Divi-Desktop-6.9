//! Shared plumbing for every Divi overlay record the wallet writes or reads.
//!
//! Divi's `OP_RETURN` is called `OP_META` (opcode `0x6a`) and carries up to 603
//! bytes measured over the whole script, which is 7.5x Bitcoin's 80. Four
//! protocols ride in it and more will follow:
//!
//! | type | protocol |
//! |------|----------|
//! | 0x01 | Proof of Existence |
//! | 0x02 | NFD / Divi Collectibles |
//! | 0x03 | PoE Merkle batch |
//! | 0x04 | DMT / Divi Meta Tokens |
//! | 0x05 | Divi Names (human readable addresses) |
//!
//! Before this module each feature grew its own copy of "pick a coin, build the
//! data output, sign, broadcast" and its own copy of the script-push parser.
//! That is three chances to get the push encoding subtly wrong and three places
//! to fix the duplicate-output bug below. Everything protocol-agnostic lives
//! here; the per-protocol part is only the payload bytes.
//!
//! Record ENCODING is not here on purpose. It lives in the vendored
//! `name-registry` / `dvxp-core` crates, which are byte-identical to the chain
//! repo, so the wallet cannot drift from the indexer.

use crate::rpc::RpcClient;
use serde_json::{json, Value};

/// Divi's OP_RETURN opcode.
pub const OP_META: u8 = 0x6a;

/// `MAX_OP_META_RELAY` measured over the whole script. The payload budget is
/// this minus the opcode and its push prefix.
pub const MAX_SCRIPT_BYTES: usize = 603;

/// Largest payload that reliably relays: 603 minus the `OP_META` byte and a
/// two-byte PUSHDATA1 prefix, rounded down to a round number for headroom.
pub const MAX_PAYLOAD_BYTES: usize = 596;

/// Smallest transaction fee the node will relay.
pub const MIN_FEE_DIVI: f64 = 0.0001;

/// Hard ceiling so a broken price feed can never turn a small quote into a
/// wallet-emptying fee.
pub const MAX_FEE_DIVI: f64 = 100_000.0;

/// A real (spendable) output the record transaction must also pay, such as a
/// registration fee to the treasury or a payment to a seller.
#[derive(Debug, Clone)]
pub struct Payment {
    pub address: String,
    pub divi: f64,
}

pub fn round8(v: f64) -> f64 {
    (v * 1e8).round() / 1e8
}

/// Hex for a bare `OP_META <push payload>` script.
///
/// Bitcoin script has three push forms and picking the wrong one produces a
/// script that parses as something else entirely rather than failing loudly, so
/// this is the single place the choice is made.
pub fn op_meta_script_hex(payload: &[u8]) -> String {
    let mut s = String::with_capacity(payload.len() * 2 + 8);
    s.push_str("6a");
    if payload.len() < 76 {
        s.push_str(&format!("{:02x}", payload.len()));
    } else if payload.len() <= 255 {
        s.push_str(&format!("4c{:02x}", payload.len()));
    } else {
        // PUSHDATA2, little-endian length.
        s.push_str(&format!("4d{:02x}{:02x}", payload.len() & 0xff, payload.len() >> 8));
    }
    for b in payload {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Pull the pushed payload out of an `OP_META` scriptPubKey hex, or `None` if
/// this output is not one. Bounds-checked against arbitrary and truncated data:
/// this parses bytes written by strangers, so it must never panic and must never
/// guess.
pub fn parse_op_meta_payload(script_hex: &str) -> Option<Vec<u8>> {
    let s = script_hex.trim();
    if s.len() < 4 || !s.starts_with("6a") {
        return None;
    }
    let (off, len) = match &s[2..4] {
        "4c" => {
            if s.len() < 6 {
                return None;
            }
            (6usize, usize::from_str_radix(&s[4..6], 16).ok()?)
        }
        "4d" => {
            if s.len() < 8 {
                return None;
            }
            let lo = usize::from_str_radix(&s[4..6], 16).ok()?;
            let hi = usize::from_str_radix(&s[6..8], 16).ok()?;
            (8usize, lo | (hi << 8))
        }
        b => {
            let n = usize::from_str_radix(b, 16).ok()?;
            // 0x4c..0x4f are push opcodes, not lengths; anything above is not a
            // direct push at all.
            if n > 75 {
                return None;
            }
            (4usize, n)
        }
    };
    let hex = s.get(off..off.checked_add(len.checked_mul(2)?)?)?;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        out.push(u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?);
    }
    Some(out)
}

/// Every DVXP payload carried by a transaction, given its verbose JSON.
///
/// Relay policy allows one data output per transaction, so in practice this
/// returns zero or one. It returns all of them anyway rather than assuming,
/// because assuming is how a parser gets surprised by a policy change.
pub fn payloads_in_tx(tx: &Value) -> Vec<Vec<u8>> {
    tx["vout"]
        .as_array()
        .map(|vouts| {
            vouts
                .iter()
                .filter_map(|v| v["scriptPubKey"]["hex"].as_str())
                .filter_map(parse_op_meta_payload)
                .filter(|p| p.len() >= 4 && &p[0..4] == b"DVXP")
                .collect()
        })
        .unwrap_or_default()
}

/// Choose a coin to fund a record transaction.
///
/// `minconf` is **0** deliberately. Each record spends the previous one's
/// unconfirmed change so a batch chains into the next block instead of stalling
/// at roughly one record per minute. Divi predates Bitcoin's mempool ancestor
/// limit and has none, so these chains are unbounded. This was found the hard
/// way while batch-minting collectibles.
fn pick_funding_coin(rpc: &RpcClient, needed: f64) -> Result<Value, String> {
    let unspent = rpc.call("listunspent", json!([0]))?;
    let coins = unspent.as_array().ok_or("the node returned no coin list")?;
    // Smallest coin that still covers the cost, so large coins stay whole and
    // available for staking. Falls back to the largest if none is big enough,
    // which then produces the honest "not enough funds" message below.
    let best = coins
        .iter()
        .filter(|c| c["spendable"].as_bool().unwrap_or(true))
        .filter(|c| c["amount"].as_f64().unwrap_or(0.0) >= needed)
        .min_by(|a, b| {
            let av = a["amount"].as_f64().unwrap_or(0.0);
            let bv = b["amount"].as_f64().unwrap_or(0.0);
            av.partial_cmp(&bv).unwrap_or(std::cmp::Ordering::Equal)
        });
    match best {
        Some(c) => Ok(c.clone()),
        None => {
            let largest = coins
                .iter()
                .filter_map(|c| c["amount"].as_f64())
                .fold(0.0f64, f64::max);
            Err(format!(
                "Not enough DIVI in a single coin. This needs {needed} DIVI and your largest coin is {largest} DIVI. Send some DIVI to yourself to combine coins, then try again."
            ))
        }
    }
}

/// Build, sign and broadcast a transaction carrying `payload` in an `OP_META`
/// output, plus any real `payments`. Returns the txid.
pub fn broadcast_record(
    rpc: &RpcClient,
    payload: &[u8],
    payments: &[Payment],
    fee_divi: f64,
) -> Result<String, String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "This record is {} bytes and the chain accepts at most {MAX_PAYLOAD_BYTES}.",
            payload.len()
        ));
    }

    let fee = if fee_divi.is_finite() && (MIN_FEE_DIVI..=MAX_FEE_DIVI).contains(&fee_divi) {
        round8(fee_divi)
    } else {
        MIN_FEE_DIVI
    };

    // Validate every destination before spending anything. A typo in a fee
    // address must be an error, never a burn.
    let mut total_payments = 0.0f64;
    for p in payments {
        let addr = p.address.trim();
        if addr.is_empty() || !p.divi.is_finite() || p.divi <= 0.0 || p.divi > MAX_FEE_DIVI {
            return Err("A payment in this record has an invalid address or amount.".into());
        }
        let valid = rpc
            .call("validateaddress", json!([addr]))
            .ok()
            .and_then(|r| r["isvalid"].as_bool())
            .unwrap_or(false);
        if !valid {
            return Err(format!("{addr} is not a valid Divi address, so nothing was sent."));
        }
        total_payments += round8(p.divi);
    }

    let needed = round8(fee + total_payments);
    let utxo = pick_funding_coin(rpc, needed)?;
    let amount = utxo["amount"].as_f64().unwrap_or(0.0);
    let change = round8(amount - needed);

    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();

    // ⚠ Divi's createrawtransaction REJECTS a duplicate output address
    // ("Invalid parameter, duplicated address"), and the outputs object is keyed
    // by address anyway, so two payments to the same place would silently
    // overwrite each other. Merge by address, always.
    let build_outputs = || {
        let mut outs: serde_json::Map<String, Value> = serde_json::Map::new();
        let mut add = |addr: &str, v: f64| {
            let prev = outs.get(addr).and_then(|x| x.as_f64()).unwrap_or(0.0);
            outs.insert(addr.to_string(), json!(round8(prev + v)));
        };
        for p in payments {
            add(p.address.trim(), round8(p.divi));
        }
        if change > 0.0 {
            add(&change_addr, change);
        }
        outs
    };

    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);
    let payload_hex: String = payload.iter().map(|b| format!("{b:02x}")).collect();

    // Prefer the "data" convention, which lets divid wrap the payload in
    // OP_META itself. Some builds reject it, so fall back to handing over the
    // finished script.
    let mut outs = build_outputs();
    outs.insert("data".into(), json!(payload_hex));
    let raw = match rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)])) {
        Ok(v) => v,
        Err(_) => {
            let mut outs = build_outputs();
            outs.insert(op_meta_script_hex(payload), json!(0));
            rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)]))?
        }
    };

    let signed = rpc.call("signrawtransaction", json!([raw]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("Could not sign the transaction. If your wallet is locked, unlock it and try again.".into());
    }
    rpc.call("sendrawtransaction", json!([signed["hex"]]))?
        .as_str()
        .ok_or_else(|| "the node did not return a transaction id".to_string())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_forms_roundtrip_at_every_boundary() {
        for len in [0usize, 1, 74, 75, 76, 200, 255, 256, MAX_PAYLOAD_BYTES] {
            let payload: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            let script = op_meta_script_hex(&payload);
            assert_eq!(
                parse_op_meta_payload(&script),
                Some(payload),
                "push form broke at length {len}"
            );
        }
    }

    /// The three push forms must be chosen at the right boundaries. 75 is the
    /// last direct push; 76 must become PUSHDATA1; 256 must become PUSHDATA2.
    #[test]
    fn push_prefix_matches_the_length() {
        assert!(op_meta_script_hex(&[0u8; 75]).starts_with("6a4b"));
        assert!(op_meta_script_hex(&[0u8; 76]).starts_with("6a4c4c"));
        assert!(op_meta_script_hex(&[0u8; 255]).starts_with("6a4cff"));
        assert!(op_meta_script_hex(&[0u8; 256]).starts_with("6a4d0001"));
    }

    #[test]
    fn rejects_malformed_and_foreign_scripts() {
        for bad in ["", "6a", "6a4c", "6a4d00", "ff00", "76a914", "6a05aabb"] {
            assert_eq!(parse_op_meta_payload(bad), None, "should reject {bad}");
        }
    }

    /// A length byte in the 0x4c..0x4f range is an opcode, not a length. Reading
    /// it as one would return the wrong bytes and silently mis-decode a record.
    #[test]
    fn opcode_bytes_are_not_treated_as_lengths() {
        assert_eq!(parse_op_meta_payload("6a4e00000001aa"), None);
        assert_eq!(parse_op_meta_payload("6a51aa"), None);
    }

    #[test]
    fn finds_only_dvxp_payloads_in_a_transaction() {
        let dvxp = op_meta_script_hex(b"DVXP\x01\x05\x01hello");
        let other = op_meta_script_hex(b"not a divi record");
        let tx = json!({"vout": [
            {"scriptPubKey": {"hex": "76a914aabb88ac"}},
            {"scriptPubKey": {"hex": other}},
            {"scriptPubKey": {"hex": dvxp}},
        ]});
        let found = payloads_in_tx(&tx);
        assert_eq!(found.len(), 1);
        assert_eq!(&found[0][0..4], b"DVXP");
    }

    #[test]
    fn a_transaction_with_no_outputs_is_not_an_error() {
        assert!(payloads_in_tx(&json!({})).is_empty());
        assert!(payloads_in_tx(&json!({"vout": []})).is_empty());
    }

    #[test]
    fn rounding_keeps_eight_decimals() {
        assert_eq!(round8(0.123456789), 0.12345679);
        assert_eq!(round8(1.0), 1.0);
    }
}
