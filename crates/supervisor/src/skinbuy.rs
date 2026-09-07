//! Skins Gallery purchases — one immediate, buyer-initiated payment with an
//! on-chain memo tag, so it can be found again later by scanning the buyer's
//! own transaction history (see the roadmap's Phase 6).
//!
//! Deliberately NOT `payreq.rs`: a payment request is an invitation the payer
//! separately decides to fulfill later. A Buy button is the opposite shape —
//! the buyer initiates and wants to pay right now, in response to their own
//! click. So this builds one raw transaction directly: pay the seller, tag it
//! with a plain-text memo via an OP_RETURN-style data output. No notification
//! output is needed (unlike `payreq.rs`) since the buyer's own wallet already
//! sees its own outgoing payment through ordinary machinery.
//!
//! The memo is a plain tag, not a registered DVXP record type — this is a
//! marker for the buyer's own future scan, not a protocol-level asset. Format:
//! `"SKINBUY1:" | skin id/slug (UTF-8, rest of the memo)`.

use crate::rpc::RpcClient;
use crate::config::NodeConfig;
use serde_json::json;

/// Cap on the memo (well under the ~80-byte OP_RETURN norm most nodes relay).
pub const MAX_MEMO_BYTES: usize = 64;
const TAG: &str = "SKINBUY1:";

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Buys a skin: sends `amount_divi` to `pay_to_address` in one transaction,
/// tagged with `skin_ref` (the skin's id or slug) so the payment can be
/// recognised again later. Returns the broadcast txid.
pub fn buy(
    cfg: &NodeConfig,
    pay_to_address: &str,
    amount_divi: f64,
    skin_ref: &str,
    passphrase: Option<&str>,
) -> Result<String, String> {
    if !amount_divi.is_finite() || amount_divi <= 0.0 {
        return Err("That isn't a valid amount.".into());
    }
    let rpc = RpcClient::new(cfg);
    let round8 = |v: f64| (v * 1e8).round() / 1e8;

    let pay_to = pay_to_address.trim().to_string();
    let payer_ok = rpc
        .call("validateaddress", json!([pay_to]))?["isvalid"]
        .as_bool()
        .unwrap_or(false);
    if !payer_ok {
        return Err("The seller's address isn't valid.".into());
    }

    let mut memo = format!("{TAG}{skin_ref}");
    if memo.len() > MAX_MEMO_BYTES {
        memo.truncate(MAX_MEMO_BYTES);
    }
    let memo_hex = hex_of(memo.as_bytes());

    let amount = round8(amount_divi);
    let fee = crate::poe::MIN_FEE_DIVI;
    let need = round8(amount + fee);

    // Just-in-time full unlock (120s window) only when a password was supplied.
    if let Some(pass) = passphrase {
        rpc.call("walletpassphrase", json!([pass, 120, false]))
            .map_err(|e| format!("Unlock failed: {e}"))?;
    }

    let result = (|| -> Result<String, String> {
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
            .ok_or_else(|| format!("You need about {need} DIVI spendable to buy this."))?
            .clone();

        let in_amount = utxo["amount"].as_f64().unwrap_or(0.0);
        let change = round8(in_amount - amount - fee);
        let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);

        let build = |use_data: bool| -> Result<serde_json::Value, String> {
            let mut outs = serde_json::Map::new();
            outs.insert(pay_to.clone(), json!(amount));
            if change > 0.0 {
                let change_addr = rpc
                    .call("getnewaddress", json!([]))?
                    .as_str()
                    .ok_or("could not get a change address")?
                    .to_string();
                if change_addr == pay_to {
                    // Same collision guard as payreq.rs: merge rather than overwrite.
                    outs.insert(pay_to.clone(), json!(round8(amount + change)));
                } else {
                    outs.insert(change_addr, json!(change));
                }
            }
            if use_data {
                outs.insert("data".into(), json!(memo_hex));
            } else {
                let script = format!("6a{:02x}{}", memo_hex.len() / 2, memo_hex);
                outs.insert(script, json!(0));
            }
            rpc.call("createrawtransaction", json!([inputs, serde_json::Value::Object(outs)]))
        };

        let raw = match build(true) {
            Ok(v) => v,
            Err(_) => build(false)?,
        };
        let signed = rpc.call("signrawtransaction", json!([raw]))?;
        if !signed["complete"].as_bool().unwrap_or(false) {
            return Err("Could not sign the purchase transaction.".into());
        }
        rpc.call("sendrawtransaction", json!([signed["hex"]]))?
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "the node did not return a transaction id".into())
    })();

    // Whether the send succeeded or not, re-lock spends afterward.
    if let Some(pass) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([pass, 0, true]));
    }

    result
}
