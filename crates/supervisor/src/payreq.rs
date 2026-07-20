//! Payment requests — "please pay me X" delivered on-chain.
//!
//! # How a request reaches the payer
//!
//! The hard part is addressing: if a request were only an `OP_META` record, the
//! payer's wallet would have to scan every block looking for records aimed at
//! it. Instead a request transaction carries TWO outputs:
//!
//!   1. a tiny payment to the payer's own address (the "notification"), and
//!   2. the `OP_META` record describing what is being asked for.
//!
//! The payer's wallet already watches its own addresses, so the request arrives
//! through completely ordinary machinery — the same path any incoming payment
//! takes. No block scanning, no indexer, no new infrastructure. When the user
//! pays, the wallet spends that notification output as an input, so the dust
//! cleans itself up instead of accumulating in the UTXO set forever.
//!
//! Sending a request costs a real fee plus the notification, which is what
//! keeps this from becoming a spam channel: begging at scale costs real money.
//!
//! # Record format — DVXP type 0x05
//!
//! Shares the envelope defined in the chain repo's
//! `docs/POE-NFT-RECORD-FORMAT.md`, alongside PoE (0x01), NFDs (0x02), PoE
//! batches (0x03) and DMT tokens (0x04):
//!
//! ```text
//! "DVXP" | version 0x01 | type 0x05 | subtype | body
//! ```
//!
//! | subtype | meaning  | body                                              |
//! |---------|----------|---------------------------------------------------|
//! | 0x01    | REQUEST  | pay_to(21) | amount(8, LE sats) | expiry(4, LE) | memo(rest, UTF-8) |
//! | 0x02    | CANCEL   | request_txid(32)                                  |
//! | 0x03    | RECEIPT  | request_txid(32) | amount(8, LE sats)             |
//!
//! `pay_to` is the shared 21-byte `Address` encoding (version byte + hash160)
//! from `dvxp-core/codec.rs`. `amount` 0 means "any amount" (a donation link).
//! `expiry` 0 means no expiry. The 603-byte carrier leaves ~560 bytes of memo.
//!
//! # Deliberately NOT done here
//!
//! Requests are PUBLIC: anyone can see who billed whom for how much. Encrypting
//! the body to the payer would need their encryption key, which is exactly what
//! the NFD key-announce record (type 0x02 subtype 0x03) publishes — so the
//! private version is a v2 built on the NFD workstream's groundwork, not a
//! separate mechanism.
//!
//! A request is an INVITATION, never an authorisation. Nothing here can move
//! anyone's money; paying is always an explicit, separately-signed act by the
//! payer. That property is the whole security model and must survive any future
//! change to this file.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::{json, Value};

/// "DVXP" (44 56 58 50) | version 0x01 | type 0x05 (payment request), as hex.
const PREFIX: &str = "445658500105";

pub const SUB_REQUEST: u8 = 0x01;
pub const SUB_CANCEL: u8 = 0x02;
pub const SUB_RECEIPT: u8 = 0x03;

/// What the notification output carries. Small enough to be negligible, large
/// enough to clear the dust threshold so nodes will relay it.
pub const NOTIFY_DIVI: f64 = 0.0001;
/// Cap on the memo, so a request can never exceed the 603-byte data carrier.
pub const MAX_MEMO_BYTES: usize = 480;

#[derive(Debug, Clone)]
pub struct PaymentRequest {
    /// Transaction carrying the request.
    pub txid: String,
    /// Where the money should be sent.
    pub pay_to: String,
    /// Satoshis requested; 0 means the payer chooses.
    pub amount_sats: u64,
    /// Unix seconds after which it should not be paid; 0 means no expiry.
    pub expiry: u32,
    pub memo: String,
    pub confirmations: i64,
    pub time: i64,
    /// The notification output we received, so paying can spend it.
    pub notify_vout: Option<u32>,
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Build the record payload for a request. `pay_to_hash` is the 21-byte address
/// encoding; the caller resolves it from a Divi address via the node.
pub fn encode_request(pay_to_hash: &[u8], amount_sats: u64, expiry: u32, memo: &str) -> Result<String, String> {
    if pay_to_hash.len() != 21 {
        return Err("payment address must encode to 21 bytes".into());
    }
    let memo_bytes = memo.as_bytes();
    if memo_bytes.len() > MAX_MEMO_BYTES {
        return Err(format!("The note is too long (max {MAX_MEMO_BYTES} characters)."));
    }
    let mut body = Vec::with_capacity(33 + memo_bytes.len());
    body.push(SUB_REQUEST);
    body.extend_from_slice(pay_to_hash);
    body.extend_from_slice(&amount_sats.to_le_bytes());
    body.extend_from_slice(&expiry.to_le_bytes());
    body.extend_from_slice(memo_bytes);
    Ok(format!("{PREFIX}{}", hex_of(&body)))
}

/// Pull a request out of an `OP_META` scriptPubKey. Returns None for anything
/// that isn't one of ours — bounds-checked against truncated or hostile data,
/// since this parses bytes any stranger can put on the chain.
pub fn parse_request(script_hex: &str) -> Option<(String, u64, u32, String)> {
    let s = script_hex;
    if !s.starts_with("6a") || s.len() < 4 {
        return None;
    }
    // single-byte push, or OP_PUSHDATA1
    let payload_hex = match &s[2..4] {
        "4c" => {
            if s.len() < 6 {
                return None;
            }
            &s[6..]
        }
        _ => &s[4..],
    };
    if !payload_hex.starts_with(PREFIX) {
        return None;
    }
    let body = unhex(&payload_hex[PREFIX.len()..])?;
    // subtype(1) + address(21) + amount(8) + expiry(4)
    if body.len() < 34 || body[0] != SUB_REQUEST {
        return None;
    }
    let pay_to = hex_of(&body[1..22]);
    let amount = u64::from_le_bytes(body[22..30].try_into().ok()?);
    let expiry = u32::from_le_bytes(body[30..34].try_into().ok()?);
    // A hostile memo must never break the UI, so lossy-decode rather than fail.
    let memo = String::from_utf8_lossy(&body[34..]).trim().to_string();
    Some((pay_to, amount, expiry, memo))
}

/// The 21-byte address encoding for a Divi address, via the node so we never
/// reimplement base58 or guess the version byte.
fn address_bytes(rpc: &RpcClient, address: &str) -> Result<Vec<u8>, String> {
    let v = rpc.call("validateaddress", json!([address]))?;
    if !v["isvalid"].as_bool().unwrap_or(false) {
        return Err("That isn't a valid Divi address.".into());
    }
    // The node hands back the 20-byte hash160 in the scriptPubKey; prefix the
    // version byte the shared codec expects.
    let spk = v["scriptPubKey"].as_str().unwrap_or("");
    // P2PKH: 76 a9 14 <20 bytes> 88 ac
    if spk.len() == 50 && spk.starts_with("76a914") {
        let mut out = vec![0x00u8];
        out.extend_from_slice(&unhex(&spk[6..46]).ok_or("bad address encoding")?);
        return Ok(out);
    }
    // P2SH: a9 14 <20 bytes> 87
    if spk.len() == 46 && spk.starts_with("a914") {
        let mut out = vec![0x05u8];
        out.extend_from_slice(&unhex(&spk[4..44]).ok_or("bad address encoding")?);
        return Ok(out);
    }
    Err("Only standard Divi addresses can be used in a payment request.".into())
}

/// Send a payment request to `payer_address`, asking for `amount_divi` to
/// `pay_to_address`.
///
/// Builds one transaction with the notification output and the record. Returns
/// the request's transaction id, which is also its identity for cancels and
/// receipts.
pub fn create(
    cfg: &NodeConfig,
    payer_address: &str,
    pay_to_address: &str,
    amount_divi: f64,
    expiry: u32,
    memo: &str,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let round8 = |v: f64| (v * 1e8).round() / 1e8;

    if !amount_divi.is_finite() || amount_divi < 0.0 {
        return Err("That isn't a valid amount.".into());
    }
    // Validate BOTH addresses before spending anything: a typo in either one
    // would otherwise send a real notification nobody can act on.
    let pay_to_hash = address_bytes(&rpc, pay_to_address.trim())?;
    let payer_ok = rpc
        .call("validateaddress", json!([payer_address.trim()]))?["isvalid"]
        .as_bool()
        .unwrap_or(false);
    if !payer_ok {
        return Err("The address you're requesting payment FROM isn't valid.".into());
    }

    let amount_sats = (round8(amount_divi) * 1e8).round() as u64;
    let record_hex = encode_request(&pay_to_hash, amount_sats, expiry, memo)?;

    // Fund it: one input big enough for the notification plus the fee.
    let fee = crate::poe::MIN_FEE_DIVI;
    let need = round8(NOTIFY_DIVI + fee);
    let unspent = rpc.call("listunspent", json!([]))?;
    let utxo = unspent
        .as_array()
        .and_then(|a| {
            a.iter()
                .filter(|u| u["amount"].as_f64().unwrap_or(0.0) >= need)
                .min_by(|x, y| {
                    let ax = x["amount"].as_f64().unwrap_or(0.0);
                    let ay = y["amount"].as_f64().unwrap_or(0.0);
                    ax.partial_cmp(&ay).unwrap_or(std::cmp::Ordering::Equal)
                })
        })
        .ok_or_else(|| {
            format!("You need about {need} DIVI spendable to send a payment request.")
        })?;

    let in_amount = utxo["amount"].as_f64().unwrap_or(0.0);
    let change = round8(in_amount - NOTIFY_DIVI - fee);
    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();

    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);
    let build = |use_data: bool| -> Result<Value, String> {
        let mut outs = serde_json::Map::new();
        outs.insert(payer_address.trim().to_string(), json!(NOTIFY_DIVI));
        if change > 0.0 {
            // Guard the same collision poe.rs hit: if the node handed us a
            // change address equal to the payer's, merge instead of overwrite.
            if change_addr == payer_address.trim() {
                outs.insert(change_addr.clone(), json!(round8(change + NOTIFY_DIVI)));
            } else {
                outs.insert(change_addr.clone(), json!(change));
            }
        }
        if use_data {
            outs.insert("data".into(), json!(record_hex));
        } else {
            let script = format!("6a{:02x}{}", record_hex.len() / 2, record_hex);
            outs.insert(script, json!(0));
        }
        rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)]))
    };

    let raw = match build(true) {
        Ok(v) => v,
        Err(_) => build(false)?,
    };
    let signed = rpc.call("signrawtransaction", json!([raw]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("Could not sign the request transaction.".into());
    }
    rpc.call("sendrawtransaction", json!([signed["hex"]]))?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "the node did not return a transaction id".into())
}

/// Requests addressed to this wallet, newest first.
///
/// Walks recent RECEIVED transactions — the notification output is what makes
/// them show up — and reads any request record they carry. Only transactions
/// the wallet was actually paid in are examined, so this stays cheap and needs
/// no chain scan.
pub fn inbox(cfg: &NodeConfig, count: i64) -> Result<Vec<PaymentRequest>, String> {
    let rpc = RpcClient::new(cfg);
    let txs = rpc.call("listtransactions", json!(["*", count.clamp(1, 500), 0]))?;
    let empty = vec![];
    let arr = txs.as_array().unwrap_or(&empty);

    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for t in arr.iter().rev() {
        if t["category"].as_str() != Some("receive") {
            continue;
        }
        let txid = match t["txid"].as_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        if seen.contains(&txid) {
            continue;
        }
        seen.push(txid.clone());

        let full = match rpc.call("getrawtransaction", json!([txid, 1])) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let vout = match full["vout"].as_array() {
            Some(v) => v,
            None => continue,
        };
        let mut found: Option<(String, u64, u32, String)> = None;
        let mut notify_vout: Option<u32> = None;
        for o in vout {
            let spk = o["scriptPubKey"]["hex"].as_str().unwrap_or("");
            if found.is_none() {
                if let Some(r) = parse_request(spk) {
                    found = Some(r);
                    continue;
                }
            }
            // The output paying us is the notification; remember it so paying
            // can consume it rather than leaving dust behind.
            if notify_vout.is_none() && o["value"].as_f64().unwrap_or(0.0) > 0.0 {
                if let Some(n) = o["n"].as_u64() {
                    notify_vout = Some(n as u32);
                }
            }
        }
        if let Some((pay_to, amount_sats, expiry, memo)) = found {
            out.push(PaymentRequest {
                txid,
                pay_to,
                amount_sats,
                expiry,
                memo,
                confirmations: t["confirmations"].as_i64().unwrap_or(0),
                time: t["time"].as_i64().unwrap_or(0),
                notify_vout,
            });
        }
    }
    out.reverse();
    Ok(out)
}

/// The address a request wants paying to, rendered back into a Divi address.
/// Kept node-side so we never reimplement base58 encoding.
pub fn pay_to_address(cfg: &NodeConfig, pay_to_hash_hex: &str) -> Option<String> {
    let rpc = RpcClient::new(cfg);
    let bytes = unhex(pay_to_hash_hex)?;
    if bytes.len() != 21 {
        return None;
    }
    let script = if bytes[0] == 0x05 {
        format!("a914{}87", hex_of(&bytes[1..]))
    } else {
        format!("76a914{}88ac", hex_of(&bytes[1..]))
    };
    let v = rpc.call("decodescript", json!([script])).ok()?;
    v["addresses"][0]
        .as_str()
        .or_else(|| v["address"].as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_request() {
        let addr = [0x00u8; 21];
        let hexrec = encode_request(&addr, 12_345_678, 1_800_000_000, "Invoice 42").unwrap();
        // Wrap as the node would: OP_META + single-byte push.
        let script = format!("6a{:02x}{}", hexrec.len() / 2, hexrec);
        let (pay_to, amount, expiry, memo) = parse_request(&script).expect("parses");
        assert_eq!(pay_to, hex_of(&addr));
        assert_eq!(amount, 12_345_678);
        assert_eq!(expiry, 1_800_000_000);
        assert_eq!(memo, "Invoice 42");
    }

    #[test]
    fn rejects_foreign_and_truncated_records() {
        // A PoE record must not be mistaken for a payment request.
        assert!(parse_request("6a2544565850010101deadbeef").is_none());
        // Truncated body.
        assert!(parse_request(&format!("6a04{PREFIX}")).is_none());
        // Not an OP_META output at all.
        assert!(parse_request("76a914aabb88ac").is_none());
        // Well-formed envelope, body one byte short of the fixed fields.
        let short = format!("{PREFIX}01{}", "00".repeat(32));
        assert!(parse_request(&format!("6a{:02x}{}", short.len() / 2, short)).is_none());
    }

    #[test]
    fn rejects_an_oversized_memo() {
        let addr = [0u8; 21];
        let memo = "x".repeat(MAX_MEMO_BYTES + 1);
        assert!(encode_request(&addr, 1, 0, &memo).is_err());
    }
}
