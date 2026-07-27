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
/// wallet-emptying FEE. This is a sanity bound on a number the user did not
/// choose.
pub const MAX_FEE_DIVI: f64 = 100_000.0;

/// Ceiling on a deliberate PAYMENT, such as buying a name from its owner.
///
/// ⚠ Kept separate from [`MAX_FEE_DIVI`] on purpose. Sharing one constant meant
/// a name listed above 100,000 DIVI could be advertised but never bought: the
/// buyer's own transaction refused to pay the price the seller had asked. A fee
/// is a number the software worked out and should be bounded tightly; a payment
/// is a number the user typed and read back on a confirmation screen.
pub const MAX_PAYMENT_DIVI: f64 = 1_000_000_000.0;

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

/// An amount of DIVI as whole satoshi-equivalents.
///
/// ⚠ Every comparison of money must go through this. DIVI amounts arrive from
/// the node as JSON doubles, and comparing doubles with a fudge factor is how a
/// correct payment gets rejected, or a payment one satoshi short gets accepted.
/// Integers have neither problem. Saturating rather than wrapping: an absurd
/// input becomes an absurd-but-bounded integer, never a small one.
pub fn to_sats(divi: f64) -> u64 {
    if !divi.is_finite() || divi <= 0.0 {
        return 0;
    }
    (divi * 1e8).round() as u64
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

/// Anything smaller than this is not worth an output: the node may refuse to
/// relay it as dust, and a change output nobody can spend is worse than simply
/// leaving the amount to the staker as extra fee.
pub const DUST_DIVI: f64 = 0.001;

/// Fee for a transaction of this shape, at the relay minimum per kilobyte.
///
/// Sizes are the standard conservative estimates: ~148 bytes per signed P2PKH
/// input, ~34 per output, ~10 of envelope, plus the record payload and its push
/// prefix. Over-estimating costs a fraction of a coin; under-estimating gets the
/// transaction dropped, so this rounds up.
pub fn size_fee(inputs: usize, outputs: usize, payload_len: usize, floor: f64) -> f64 {
    let bytes = 10 + inputs * 148 + outputs * 34 + payload_len + 4;
    let kb = bytes.div_ceil(1000).max(1) as f64;
    let want = round8(MIN_FEE_DIVI * kb);
    if want > floor {
        want
    } else {
        floor
    }
}

/// `"DVXP"` as it appears inside a raw block's hex.
pub const MAGIC_HEX: &str = "44565850";

/// Cheap pre-filter: could this raw block contain a DVXP record at all?
///
/// **This is what makes scanning affordable.** Divi's `getblock` returns only
/// transaction IDs, never the outputs, so finding a record properly costs one
/// extra RPC call per transaction in the block. The overwhelming majority of
/// blocks contain nothing but a coinbase and a coinstake and no records at all,
/// so we fetch the raw block once and look for the four magic bytes in its hex.
/// No match means the block provably has no record and can be skipped for the
/// cost of a single call.
///
/// A match does not mean there IS a record: the bytes can appear by chance, and
/// the hex search can straddle a byte boundary. That is fine and deliberate.
/// This function only ever has to avoid FALSE NEGATIVES; false positives cost
/// one wasted block of proper parsing and nothing else.
pub fn block_may_contain_record(raw_block_hex: &str) -> bool {
    raw_block_hex.contains(MAGIC_HEX)
}

/// The address best placed to author a sequence of records: the one holding the
/// largest spendable total.
///
/// Used when a flow will need SEVERAL records from the same author (reserve then
/// register, then edit), so the author is chosen once, deliberately, rather than
/// falling out of whichever coin the picker happened to like.
pub fn best_author_address(rpc: &RpcClient) -> Result<String, String> {
    let unspent = rpc.call("listunspent", json!([0]))?;
    let coins = unspent.as_array().ok_or("the node returned no coin list")?;
    let mut totals: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for c in coins {
        if !c["spendable"].as_bool().unwrap_or(true) {
            continue;
        }
        if let (Some(addr), Some(amt)) = (c["address"].as_str(), c["amount"].as_f64()) {
            *totals.entry(addr.to_string()).or_insert(0.0) += amt;
        }
    }
    totals
        .into_iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(addr, _)| addr)
        .ok_or_else(|| "No spendable DIVI in this wallet.".to_string())
}

/// Choose coins to fund a record transaction.
///
/// `minconf` is **0** deliberately. Each record spends the previous one's
/// unconfirmed change so a batch chains into the next block instead of stalling
/// at roughly one record per minute. Divi predates Bitcoin's mempool ancestor
/// limit and has none, so these chains are unbounded. This was found the hard
/// way while batch-minting collectibles.
///
/// Combines coins when it has to. Name registration fees run to tens of
/// thousands of DIVI, which a single coin very often will not cover, so a
/// one-coin-only selector would refuse transactions the wallet can easily
/// afford.
/// `from` pins **who authors the record**.
///
/// ⚠ This is not a preference, it is the whole authorisation model. Every
/// overlay protocol here identifies a record's author as the address funding
/// `vin[0]`. A wallet that picks coins freely will happily fund a record from
/// some unrelated change address, and the indexer will then correctly refuse it:
/// the reveal will not match its commit, and an edit will not match the name's
/// owner. The transaction succeeds, the fee is spent, and nothing happens. That
/// failure is invisible without a live chain, which is exactly how it survived
/// into a build once already.
///
/// Only the FIRST input has to come from `from`. The rest may come from
/// anywhere, so a 50,000 DIVI registration does not require one address to hold
/// the whole amount.
fn select_coins(
    rpc: &RpcClient,
    needed: f64,
    from: Option<&str>,
) -> Result<(Vec<Value>, f64), String> {
    let unspent = rpc.call("listunspent", json!([0]))?;
    let coins = unspent.as_array().ok_or("the node returned no coin list")?;
    let mut usable: Vec<&Value> = coins
        .iter()
        .filter(|c| c["spendable"].as_bool().unwrap_or(true))
        .filter(|c| c["amount"].as_f64().unwrap_or(0.0) > 0.0)
        .collect();

    // Largest first, so the fewest inputs are used and the transaction stays
    // small. Fewer inputs also means fewer signatures for a locked wallet.
    let by_size_desc = |a: &&Value, b: &&Value| {
        let av = a["amount"].as_f64().unwrap_or(0.0);
        let bv = b["amount"].as_f64().unwrap_or(0.0);
        bv.partial_cmp(&av).unwrap_or(std::cmp::Ordering::Equal)
    };
    usable.sort_by(by_size_desc);

    let mut chosen: Vec<Value> = Vec::new();
    let mut total = 0.0f64;

    if let Some(addr) = from {
        let first = usable
            .iter()
            .find(|c| c["address"].as_str() == Some(addr))
            .ok_or_else(|| format!(
                "The address that must authorise this ({addr}) has no DIVI to spend, so the change would not be recognised. Send it a small amount of DIVI and try again."
            ))?;
        total = round8(first["amount"].as_f64().unwrap_or(0.0));
        chosen.push((*first).clone());
        usable.retain(|c| {
            !(c["txid"] == first["txid"] && c["vout"] == first["vout"])
        });
        if total >= needed {
            return Ok((chosen, total));
        }
    } else if let Some(best) = usable
        .iter()
        // A single coin that covers it exactly-ish beats the biggest one: it
        // leaves large coins whole and staking.
        .filter(|c| c["amount"].as_f64().unwrap_or(0.0) >= needed)
        .min_by(|a, b| {
            let av = a["amount"].as_f64().unwrap_or(0.0);
            let bv = b["amount"].as_f64().unwrap_or(0.0);
            av.partial_cmp(&bv).unwrap_or(std::cmp::Ordering::Equal)
        })
    {
        let amount = best["amount"].as_f64().unwrap_or(0.0);
        return Ok((vec![(*best).clone()], amount));
    }

    for c in usable {
        chosen.push(c.clone());
        total = round8(total + c["amount"].as_f64().unwrap_or(0.0));
        if total >= needed {
            return Ok((chosen, total));
        }
    }
    let available = round8(total);
    Err(format!(
        "Not enough spendable DIVI. This needs {needed} DIVI and {available} DIVI is available."
    ))
}

/// What a broadcast record turned into on chain.
pub struct Sent {
    pub txid: String,
    /// The address that funded `vin[0]`, which is who the indexer will treat as
    /// the record's author. Callers that care about authorship must record it.
    pub author: Option<String>,
}

/// Build, sign and broadcast a transaction carrying `payload` in an `OP_META`
/// output, plus any real `payments`.
///
/// `from` pins who authors the record; see [`select_coins`]. Pass `None` only
/// for records where authorship genuinely does not matter.
pub fn broadcast_record(
    rpc: &RpcClient,
    payload: &[u8],
    payments: &[Payment],
    fee_divi: f64,
    from: Option<&str>,
) -> Result<Sent, String> {
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
        if addr.is_empty() || !p.divi.is_finite() || p.divi <= 0.0 || p.divi > MAX_PAYMENT_DIVI {
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

    // ⚠ The relay minimum is per KILOBYTE, not per transaction. A record that
    // needs several inputs to cover a large registration fee is a big
    // transaction, and paying the flat minimum would get it dropped with a
    // confusing "absurdly low fee" error. Select coins, size the fee to the
    // result, and re-select if the bigger fee changed what is needed. Two
    // rounds settle it; the third is a backstop, not an expectation.
    let mut fee = fee;
    let mut needed = round8(fee + total_payments);
    let (mut utxos, mut funded) = select_coins(rpc, needed, from)?;
    for _ in 0..3 {
        let sized = size_fee(utxos.len(), payments.len() + 1, payload.len(), fee);
        if sized <= fee {
            break;
        }
        fee = sized;
        needed = round8(fee + total_payments);
        if funded >= needed {
            break;
        }
        let (u, f) = select_coins(rpc, needed, from)?;
        utxos = u;
        funded = f;
    }

    // Change below the dust threshold is left to the staker as extra fee rather
    // than written as an output the node may refuse to relay.
    let mut change = round8(funded - needed);
    if change < DUST_DIVI {
        change = 0.0;
    }

    // ⚠ When a record has a pinned author, change goes BACK to that address.
    // A fresh change address would drain the author, and the very next record
    // in the sequence (a reveal after its commit, an edit after another edit)
    // could no longer be funded by the address the rules require. That is not a
    // tidy-wallet preference; it is what makes a two-step flow possible at all.
    let change_addr = if change <= 0.0 {
        String::new()
    } else if let Some(author) = from {
        author.to_string()
    } else {
        rpc.call("getnewaddress", json!([]))?
            .as_str()
            .ok_or("could not get a change address")?
            .to_string()
    };

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

    let inputs = Value::Array(
        utxos
            .iter()
            .map(|u| json!({ "txid": u["txid"], "vout": u["vout"] }))
            .collect(),
    );
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
    let author = utxos
        .first()
        .and_then(|u| u["address"].as_str())
        .map(|s| s.to_string());
    let txid = rpc
        .call("sendrawtransaction", json!([signed["hex"]]))?
        .as_str()
        .ok_or_else(|| "the node did not return a transaction id".to_string())?
        .to_string();
    Ok(Sent { txid, author })
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

    /// The relay minimum is per kilobyte. A one-input record pays the floor; a
    /// transaction big enough to cross a kilobyte pays more, or it gets dropped.
    #[test]
    fn fee_scales_with_transaction_size() {
        let small = size_fee(1, 2, 40, MIN_FEE_DIVI);
        assert_eq!(small, MIN_FEE_DIVI);
        let big = size_fee(20, 2, 400, MIN_FEE_DIVI);
        assert!(big > small, "a 20-input transaction must pay more than the flat minimum");
        // Never below the caller's floor.
        assert_eq!(size_fee(1, 1, 10, 5.0), 5.0);
    }

    #[test]
    fn the_magic_prefilter_has_no_false_negatives() {
        let payload = b"DVXP\x01\x05\x02payload";
        let script = op_meta_script_hex(payload);
        let fake_block = format!("00000020aabbcc{script}ffee");
        assert!(block_may_contain_record(&fake_block));
        assert!(!block_may_contain_record("00000020aabbccddeeff112233"));
    }

    #[test]
    fn rounding_keeps_eight_decimals() {
        assert_eq!(round8(0.123456789), 0.12345679);
        assert_eq!(round8(1.0), 1.0);
    }
}
