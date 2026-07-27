//! Pin Code Send = on-chain ESCROW via Divi's native HTLC. Coins are locked so
//! the receiver can SEE them committed (amount, bound to their key, refundable
//! to the sender only after a timelock) but cannot claim without the release
//! code the sender shares separately. This is a real escrow: the sender can't
//! pull the funds back during the window, and only the intended receiver, with
//! the code, can take them.
//!
//! The whole fund/claim/refund flow was validated on regtest before this was
//! written; see reference_divi_htlc_escrow_recipe. Uses only standard RPCs plus
//! one byte-level fixup the Divi signer requires (it leaves an OP_0 placeholder
//! where the revealed code goes).
//!
//! redeemScript (HTLC, SHA-256 hashlock so we need no ripemd dependency):
//!   OP_SHA256 <H=sha256(code)> OP_EQUAL
//!   OP_IF   <recipientPKH>
//!   OP_ELSE <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <senderPKH>
//!   OP_ENDIF OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use base64::Engine;
use serde_json::json;
use sha2::{Digest, Sha256};

const ESCROW_FEE: f64 = 0.0001;

pub struct EscrowCreated {
    pub ticket: String,
    pub txid: String,
    pub vout: u32,
    pub amount: f64,
}

pub struct EscrowStatus {
    pub funded: bool,
    pub claimed: bool,
    pub amount: f64,       // receivable (locked value minus the claim fee)
    pub confirmations: i64,
    pub recipient: String, // who it's for
    pub sender: String,    // who it's from
    pub locktime: u32,     // unix time the sender can refund after
}

fn sha256_hex(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    hex_of(&h.finalize())
}
fn hex_of(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn round8(v: f64) -> f64 {
    (v * 1e8).round() / 1e8
}

/// CScriptNum minimal little-endian push of a positive locktime.
fn locktime_push(lt: u32) -> String {
    let mut bytes = lt.to_le_bytes().to_vec();
    while bytes.len() > 1 && *bytes.last().unwrap() == 0 {
        bytes.pop();
    }
    // If the high bit of the top byte is set, append 0x00 so it stays positive.
    if bytes.last().map(|b| b & 0x80 != 0).unwrap_or(false) {
        bytes.push(0);
    }
    format!("{:02x}{}", bytes.len(), hex_of(&bytes))
}

/// The HTLC redeemScript hex for these parties/hash/timelock.
fn build_redeem(h_hex: &str, recipient_pkh: &str, sender_pkh: &str, locktime: u32) -> String {
    format!(
        "a820{h}87 63 14{r}67 {lt}b17514{s}68 78a988ac",
        h = h_hex,
        r = recipient_pkh,
        s = sender_pkh,
        lt = locktime_push(locktime)
    )
    .replace(' ', "")
}

/// The 20-byte pubkey-hash of a Divi P2PKH address, read from its scriptPubKey
/// (76a914<20>88ac) as the node reports it. Works for any address, ours or not.
fn pkh_of(rpc: &RpcClient, addr: &str) -> Result<String, String> {
    let v = rpc.call("validateaddress", json!([addr]))?;
    if v["isvalid"].as_bool() != Some(true) {
        return Err("That recipient address is not valid.".into());
    }
    let spk = v["scriptPubKey"].as_str().ok_or("could not read the address script")?;
    if spk.len() < 46 || !spk.starts_with("76a914") || !spk.ends_with("88ac") {
        return Err("That address is not a standard payable address.".into());
    }
    Ok(spk[6..46].to_string())
}

fn encode_ticket(redeem: &str, txid: &str, vout: u32, recipient: &str, sender: &str, amount: f64, locktime: u32) -> String {
    let payload = format!("escrow.v1|{redeem}|{txid}|{vout}|{recipient}|{sender}|{amount}|{locktime}");
    format!("DVE1-{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.as_bytes()))
}

struct Ticket {
    redeem: String,
    txid: String,
    vout: u32,
    recipient: String,
    sender: String,
    amount: f64,
    locktime: u32,
}
fn decode_ticket(t: &str) -> Result<Ticket, String> {
    let body = t.trim().strip_prefix("DVE1-").ok_or("That is not a Pin Code Send ticket.")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.as_bytes())
        .map_err(|_| "That ticket is malformed.".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "That ticket is malformed.".to_string())?;
    let p: Vec<&str> = text.split('|').collect();
    if p.len() != 8 || p[0] != "escrow.v1" {
        return Err("That ticket is an unsupported version.".into());
    }
    Ok(Ticket {
        redeem: p[1].to_string(),
        txid: p[2].to_string(),
        vout: p[3].parse().map_err(|_| "malformed ticket".to_string())?,
        recipient: p[4].to_string(),
        sender: p[5].to_string(),
        amount: p[6].parse().map_err(|_| "malformed ticket".to_string())?,
        locktime: p[7].parse().map_err(|_| "malformed ticket".to_string())?,
    })
}

/// Create an escrow: lock `amount` to `recipient`, refundable to us after
/// `locktime`, unlockable only by revealing `code`. The sender pays the fee, so
/// the receiver gets the full `amount`. `code` is a long random release code
/// (generated in the UI); it is NOT stored on-chain or in the ticket.
pub fn create(
    cfg: &NodeConfig,
    recipient: &str,
    amount: f64,
    code: &str,
    locktime: u32,
    passphrase: Option<&str>,
) -> Result<EscrowCreated, String> {
    if amount <= 0.0 {
        return Err("Amount must be greater than zero.".into());
    }
    let rpc = RpcClient::new(cfg);
    let recipient_pkh = pkh_of(&rpc, recipient)?;
    let h = sha256_hex(code.as_bytes());

    if let Some(p) = passphrase {
        rpc.call("walletpassphrase", json!([p, 120, false])).map_err(|e| format!("Unlock failed: {e}"))?;
    }
    let result = (|| {
        // A sender-owned address for the refund branch (we hold its key).
        let sender = rpc
            .call("getnewaddress", json!(["escrow"]))?
            .as_str()
            .ok_or("node did not return an address")?
            .to_string();
        let sender_pkh = pkh_of(&rpc, &sender)?;
        let redeem = build_redeem(&h, &recipient_pkh, &sender_pkh, locktime);
        let p2sh = rpc
            .call("decodescript", json!([redeem]))?
            .get("p2sh")
            .and_then(|v| v.as_str())
            .ok_or("could not derive the lock address")?
            .to_string();
        // Sender pays the fee: fund amount + the future claim fee.
        let funded = round8(amount + ESCROW_FEE);
        let txid = rpc
            .call("sendtoaddress", json!([p2sh, funded]))?
            .as_str()
            .ok_or("node did not return a transaction id")?
            .to_string();
        let vout = find_vout(&rpc, &txid, &p2sh).ok_or("could not locate the locked output")?;
        Ok(EscrowCreated {
            ticket: encode_ticket(&redeem, &txid, vout, recipient, &sender, amount, locktime),
            txid,
            vout,
            amount,
        })
    })();
    if let Some(p) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([p, 0, true]));
    }
    result
}

/// What a ticket holder can see without the code: the committed amount, how many
/// confirmations, who it's for/from, and when the sender could refund.
pub fn status(cfg: &NodeConfig, ticket: &str) -> Result<EscrowStatus, String> {
    let t = decode_ticket(ticket)?;
    let rpc = RpcClient::new(cfg);
    let utxo = rpc.call("gettxout", json!([t.txid, t.vout, true]))?;
    if utxo.is_null() {
        return Ok(EscrowStatus {
            funded: false,
            claimed: true,
            amount: 0.0,
            confirmations: 0,
            recipient: t.recipient,
            sender: t.sender,
            locktime: t.locktime,
        });
    }
    let value = utxo["value"].as_f64().unwrap_or(0.0);
    Ok(EscrowStatus {
        funded: true,
        claimed: false,
        amount: round8((value - ESCROW_FEE).max(0.0)),
        confirmations: utxo["confirmations"].as_i64().unwrap_or(0),
        recipient: t.recipient,
        sender: t.sender,
        locktime: t.locktime,
    })
}

/// Recipient claims by revealing the code. Signs with the recipient's own key
/// (must be their wallet, unlocked) and fills the code into the placeholder the
/// Divi signer leaves. Sends to a fresh address in their wallet.
pub fn claim(cfg: &NodeConfig, ticket: &str, code: &str, passphrase: Option<&str>) -> Result<String, String> {
    let t = decode_ticket(ticket)?;
    let rpc = RpcClient::new(cfg);
    let utxo = rpc.call("gettxout", json!([t.txid, t.vout, true]))?;
    if utxo.is_null() {
        return Err("This escrow has already been claimed (or was never funded).".into());
    }
    let value = utxo["value"].as_f64().ok_or("could not read the locked value")?;
    let spk = utxo["scriptPubKey"]["hex"].as_str().ok_or("could not read the lock script")?.to_string();
    if value <= ESCROW_FEE {
        return Err("The locked amount is too small to claim.".into());
    }

    if let Some(p) = passphrase {
        rpc.call("walletpassphrase", json!([p, 120, false])).map_err(|e| format!("Unlock failed: {e}"))?;
    }
    let result = (|| {
        // The recipient's private key (their wallet must own the ticket's
        // recipient address). Passed explicitly so the node loads the
        // redeemScript and signs the IF branch.
        let rwif = rpc
            .call("dumpprivkey", json!([t.recipient]))?
            .as_str()
            .ok_or("this wallet does not hold the key for this escrow")?
            .to_string();
        let dest = rpc.call("getnewaddress", json!([]))?.as_str().ok_or("no address")?.to_string();
        let send_value = round8(value - ESCROW_FEE);
        let raw = rpc
            .call("createrawtransaction", json!([[{"txid": t.txid, "vout": t.vout}], {dest: send_value}]))?
            .as_str()
            .ok_or("could not build the claim")?
            .to_string();
        let prevtxs = json!([{"txid": t.txid, "vout": t.vout, "scriptPubKey": spk, "redeemScript": t.redeem}]);
        let signed = rpc.call("signrawtransaction", json!([raw, prevtxs, [rwif]]))?;
        let signed_hex = signed["hex"].as_str().ok_or("signing produced nothing")?.to_string();
        let filled = fill_preimage(&rpc, &signed_hex, &t.redeem, code.as_bytes())?;
        let sent = rpc
            .call("sendrawtransaction", json!([filled]))?
            .as_str()
            .ok_or("the node did not confirm the broadcast")?
            .to_string();
        Ok(sent)
    })();
    if let Some(p) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([p, 0, true]));
    }
    result
}

/// Sender reclaims after the timelock (the refund branch; no code needed).
pub fn refund(cfg: &NodeConfig, ticket: &str, passphrase: Option<&str>) -> Result<String, String> {
    let t = decode_ticket(ticket)?;
    let rpc = RpcClient::new(cfg);
    let utxo = rpc.call("gettxout", json!([t.txid, t.vout, true]))?;
    if utxo.is_null() {
        return Err("Nothing to refund: this escrow is already spent.".into());
    }
    let value = utxo["value"].as_f64().ok_or("could not read the locked value")?;
    let spk = utxo["scriptPubKey"]["hex"].as_str().ok_or("could not read the lock script")?.to_string();

    if let Some(p) = passphrase {
        rpc.call("walletpassphrase", json!([p, 120, false])).map_err(|e| format!("Unlock failed: {e}"))?;
    }
    let result = (|| {
        let swif = rpc
            .call("dumpprivkey", json!([t.sender]))?
            .as_str()
            .ok_or("this wallet does not hold the refund key")?
            .to_string();
        let dest = rpc.call("getnewaddress", json!([]))?.as_str().ok_or("no address")?.to_string();
        let send_value = round8(value - ESCROW_FEE);
        let raw = rpc
            .call("createrawtransaction", json!([[{"txid": t.txid, "vout": t.vout}], {dest: send_value}]))?
            .as_str()
            .ok_or("could not build the refund")?
            .to_string();
        // CLTV needs a non-final input sequence and nLockTime >= the script's
        // locktime, set before signing. Single-input tx layout: sequence is the
        // 4 bytes after the empty scriptSig at hex offset 84; nLockTime is the
        // final 4 bytes.
        if raw.len() < 100 {
            return Err("unexpected transaction layout".into());
        }
        let lt_le: String = t.locktime.to_le_bytes().iter().map(|b| format!("{b:02x}")).collect();
        let raw2 = format!("{}feffffff{}{}", &raw[..84], &raw[92..raw.len() - 8], lt_le);
        let prevtxs = json!([{"txid": t.txid, "vout": t.vout, "scriptPubKey": spk, "redeemScript": t.redeem}]);
        let signed = rpc.call("signrawtransaction", json!([raw2, prevtxs, [swif]]))?;
        if signed["complete"].as_bool() != Some(true) {
            return Err("Could not sign the refund (is the timelock reached?).".into());
        }
        let sent = rpc
            .call("sendrawtransaction", json!([signed["hex"].as_str().unwrap_or("")]))?
            .as_str()
            .ok_or("the node did not confirm the broadcast")?
            .to_string();
        Ok(sent)
    })();
    if let Some(p) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([p, 0, true]));
    }
    result
}

/// Replace the Divi signer's OP_0 preimage placeholder with the real revealed
/// code, and fix the scriptSig length. The signer emits
/// `<sig><pubkey> OP_0 <push redeemScript>`; we swap the OP_0 for `<push code>`.
fn fill_preimage(rpc: &RpcClient, signed_hex: &str, redeem: &str, code: &[u8]) -> Result<String, String> {
    let ss = rpc
        .call("decoderawtransaction", json!([signed_hex]))?
        .get("vin")
        .and_then(|v| v.get(0))
        .and_then(|v| v["scriptSig"]["hex"].as_str())
        .ok_or("could not read the claim signature")?
        .to_string();
    // redeemScript is >75 bytes, so it is pushed with OP_PUSHDATA1 (0x4c)+len.
    let push = format!("4c{:02x}", redeem.len() / 2);
    let placeholder = format!("00{push}{redeem}");
    if !ss.contains(&placeholder) {
        return Err("Could not complete the claim (unexpected signature shape).".into());
    }
    let preimage_push = format!("{:02x}{}", code.len(), hex_of(code));
    let new_ss = ss.replace(&placeholder, &format!("{preimage_push}{push}{redeem}"));
    // Fix the scriptSig length varint (both well under 253 bytes here).
    let old = format!("{:02x}{ss}", ss.len() / 2);
    let new = format!("{:02x}{new_ss}", new_ss.len() / 2);
    Ok(signed_hex.replacen(&old, &new, 1))
}

fn find_vout(rpc: &RpcClient, txid: &str, p2sh: &str) -> Option<u32> {
    for n in 0..4u32 {
        if let Ok(o) = rpc.call("gettxout", json!([txid, n, true])) {
            if o.is_null() {
                continue;
            }
            let matches = o["scriptPubKey"]["addresses"]
                .as_array()
                .map(|a| a.iter().any(|x| x.as_str() == Some(p2sh)))
                .unwrap_or(false);
            if matches {
                return Some(n);
            }
        }
    }
    None
}
