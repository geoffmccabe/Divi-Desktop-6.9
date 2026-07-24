// Proof-of-Existence: anchor a document's SHA-256 hash on the Divi chain and
// verify a prior anchor. The document itself never reaches here -- the UI hashes
// it client-side and passes only the 32-byte hash -- so this module is pure hex
// + RPC, no file I/O and no crypto deps.
//
// Two on-chain forms, and we PREFER the soft-fork one:
//   1. Native OP_POE (the soft fork). When the node exposes the createpoe /
//      verifypoe RPCs, we use them directly -- the node builds/validates/indexes
//      the anchor itself. This is the intended path once the soft fork ships.
//   2. Forkless OP_META "DVXP" record (works on today's node). Used as a fallback
//      until the node has the OP_POE RPCs. Verifiers accept both forms, exactly
//      as the chain spec (docs/SOFTFORK-OPCODES.md, "Migration") requires.
//
// Forkless record format (shared "DVXP" envelope, see Divi-Blockchain_6.9
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

/// Smallest anchor fee the node will relay.
pub const MIN_FEE_DIVI: f64 = 0.0001;
/// Hard ceiling so a broken price feed can never turn a $1 quote into a
/// wallet-emptying fee. Well above any sane anchor cost.
pub const MAX_FEE_DIVI: f64 = 100_000.0;

/// What an anchor costs and where that value goes.
///
/// The anchor price is split: a share is paid to a configured address, and the
/// remainder is simply left unspent so the staker who mines the block collects
/// it as the transaction fee. Note this split is enforced by THIS app, not by
/// consensus — the chain has no notion of it.
#[derive(Default)]
pub struct AnchorCost {
    /// Left to the block's staker as the transaction fee.
    pub fee_divi: Option<f64>,
    /// Address receiving the configured share, if one is set.
    pub payout_addr: Option<String>,
    /// Amount sent to `payout_addr`.
    pub payout_divi: Option<f64>,
}

/// Anchor `hash_hex` (a 32-byte SHA-256, 64 hex chars) on-chain. Returns the txid.
///
/// Amounts in `cost` are clamped; anything missing or out of range falls back to
/// the relay minimum, so a broken price quote can never silently overspend.
pub fn timestamp(cfg: &NodeConfig, hash_hex: &str, cost: AnchorCost) -> Result<String, String> {
    let hash_hex = hash_hex.trim().to_lowercase();
    if !is_sha256_hex(&hash_hex) {
        return Err("That doesn't look like a SHA-256 hash.".into());
    }
    let rpc = RpcClient::new(cfg);

    // ⚠ Which on-chain form to use is NOT just "whichever the node supports".
    //
    // An OP_POE output is unrecognised by nodes that predate the soft fork, so
    // they treat the transaction as non-standard and DROP IT rather than relay
    // it. Today essentially the whole mainnet is such nodes. An anchor built
    // that way would very likely never reach a staker and never confirm — the
    // user would be told their file was timestamped while the proof quietly
    // never happened. Regtest hides this completely, because there the one node
    // mines its own transactions.
    //
    // So: use the native form only where it can actually propagate (regtest and
    // testnet), or when someone knowingly opts in. On mainnet stay with the
    // forkless OP_META record, which every node relays today. Once the upgraded
    // node is widely deployed this gate is the single thing to flip.
    let native_ok = match std::env::var("DIVI_POE_NATIVE").ok().as_deref() {
        Some("1") => true,
        Some("0") => false,
        _ => !is_mainnet(&rpc),
    };

    if native_ok {
        if let Some(id) = try_native_anchor(&rpc, &hash_hex)? {
            return Ok(id);
        }
    }

    timestamp_forkless(&rpc, &hash_hex, cost)
}

/// True unless the node clearly says it is on something other than mainnet.
/// Unknown / unreachable is treated AS mainnet — the cautious direction, since
/// guessing wrong there is what silently loses a proof.
fn is_mainnet(rpc: &RpcClient) -> bool {
    match rpc.call("getblockchaininfo", json!([])) {
        Ok(v) => match v["chain"].as_str() {
            Some(c) => c == "main",
            None => true,
        },
        Err(_) => true,
    }
}

/// Anchor via the node's native OP_POE RPC. Ok(None) = this node doesn't have it.
fn try_native_anchor(rpc: &RpcClient, hash_hex: &str) -> Result<Option<String>, String> {
    if let Some(v) = rpc.call_optional("createpoe", json!([hash_hex, false]))? {
        // createpoe returns the txid (string), or an object carrying it.
        if let Some(id) = v.as_str() {
            return Ok(Some(id.to_string()));
        }
        if let Some(id) = v["txid"].as_str() {
            return Ok(Some(id.to_string()));
        }
        return Err("the node accepted the anchor but returned no transaction id".into());
    }
    Ok(None)
}

/// Build the forkless OP_META "DVXP" anchor by hand (used until the node ships
/// the native OP_POE RPCs).
fn timestamp_forkless(
    rpc: &RpcClient,
    hash_hex: &str,
    cost: AnchorCost,
) -> Result<String, String> {
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

    let round8 = |v: f64| (v * 1e8).round() / 1e8;
    let amount = utxo["amount"].as_f64().unwrap_or(0.0);

    // Clamp rather than trust: an out-of-range request becomes the minimum.
    let fee = match cost.fee_divi {
        Some(f) if f.is_finite() && (MIN_FEE_DIVI..=MAX_FEE_DIVI).contains(&f) => round8(f),
        _ => MIN_FEE_DIVI,
    };

    // The configured share, paid as a real output. Only honoured when the
    // address actually validates on this chain — a typo must not burn funds.
    let payout = match (&cost.payout_addr, cost.payout_divi) {
        (Some(addr), Some(v))
            if !addr.trim().is_empty() && v.is_finite() && v > 0.0 && v <= MAX_FEE_DIVI =>
        {
            let valid = rpc
                .call("validateaddress", json!([addr.trim()]))
                .ok()
                .and_then(|r| r["isvalid"].as_bool())
                .unwrap_or(false);
            if valid {
                Some((addr.trim().to_string(), round8(v)))
            } else {
                return Err("The configured payout address isn't a valid Divi address.".into());
            }
        }
        _ => None,
    };
    let payout_divi = payout.as_ref().map(|(_, v)| *v).unwrap_or(0.0);

    let spend = fee + payout_divi;
    if amount < spend {
        return Err(format!(
            "Not enough funds to anchor ({spend} DIVI needed). Your largest single coin is {amount} DIVI."
        ));
    }
    let change = round8(amount - spend);
    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();

    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);
    let record_hex = format!("{}{}", RECORD_PREFIX, hash_hex);

    // Outputs are keyed by address, so a payout to our own change address would
    // collide and silently drop one of them. Merge instead.
    let add_outs = |outs: &mut serde_json::Map<String, Value>| {
        if let Some((addr, v)) = &payout {
            if addr == &change_addr {
                outs.insert(addr.clone(), json!(round8(change + v)));
            } else {
                outs.insert(addr.clone(), json!(*v));
                outs.insert(change_addr.clone(), json!(change));
            }
        } else {
            outs.insert(change_addr.clone(), json!(change));
        }
    };

    // Prefer the "data" convention (divid wraps it in OP_META for us). Some
    // builds reject it ("value is type str, expected real") -- fall back to a
    // raw OP_META script output: 0x6a + single-byte push length + payload.
    let mut outs = serde_json::Map::new();
    add_outs(&mut outs);
    outs.insert("data".into(), json!(record_hex));
    let raw = match rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)])) {
        Ok(v) => v,
        Err(_) => {
            let script = format!("6a{:02x}{}", record_hex.len() / 2, record_hex);
            let mut outs = serde_json::Map::new();
            add_outs(&mut outs);
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

    // Prefer the native soft-fork RPC: the node checks the anchor against its
    // own OP_POE index and returns {matched, confirmations, blocktime}.
    if let Some(v) = rpc.call_optional("verifypoe", json!([txid, hash_hex]))? {
        return Ok(Proof {
            matched: v["matched"].as_bool().unwrap_or(false),
            confirmations: v["confirmations"].as_i64().unwrap_or(0),
            block_time: v["blocktime"].as_i64().or_else(|| v["block_time"].as_i64()),
        });
    }

    // Forkless fallback: read the tx and match the OP_META "DVXP" record. (Before
    // the soft fork, only OP_META anchors can exist, so this is complete.)
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
