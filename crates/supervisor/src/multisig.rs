//! Native N-of-M multisig for DD69, built on Divi's standard P2SH
//! OP_CHECKMULTISIG. The core has `createmultisig` + the raw-transaction
//! toolchain and a `signrawtransaction` that merges one signer's signature at a
//! time. There is no PSBT and no `combinerawtransaction` in this build, so a
//! spend travels between co-signers as a self-contained text blob until it has
//! enough signatures, then it is broadcast.
//!
//! Balances and coin selection for a shared address the wallet does not FULLY
//! own come from the address index (`getaddressbalance` / `getaddressutxos`),
//! which DD69 now enables: a partially-owned multisig is not "spendable" to the
//! wallet, so `listunspent` would not show it.
//!
//! Nothing here holds a private key. Signing is done by the node against keys
//! already in the user's wallet; a participant who holds none of the M keys can
//! read and propose a spend but cannot add a signature to it.

use crate::config::{dd69_config_dir, NodeConfig};
use crate::rpc::RpcClient;
use base64::Engine;
use serde_json::{json, Value};

const DUST_DIVI: f64 = 0.0001;
const FEE_CAP_DIVI: f64 = 5.0; // absolute ceiling; abort before broadcasting past it
const RELAY_SATS_PER_BYTE: f64 = 10.0; // matches the node relay fee (0.0001/kB)

fn round8(v: f64) -> f64 {
    (v * 1e8).round() / 1e8
}
fn sat_to_divi(s: i64) -> f64 {
    round8(s as f64 / 1e8)
}
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ── Local store of the multisig wallets this app knows about ─────────────────
// Just metadata (address, redeemScript, participants). No secrets: the keys
// live in the node's wallet, not here.

#[derive(Clone)]
pub struct StoredWallet {
    pub label: String,
    pub address: String,
    pub redeem_script: String,
    pub m: u32,
    pub n: u32,
    pub participants: Vec<String>,
    pub created_at: i64,
}

fn store_path() -> std::path::PathBuf {
    dd69_config_dir().join("multisig.json")
}

fn read_store() -> Vec<StoredWallet> {
    let text = match std::fs::read_to_string(store_path()) {
        Ok(t) => t,
        Err(_) => return vec![],
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    v.get("wallets")
        .and_then(|w| w.as_array())
        .map(|a| a.iter().filter_map(parse_stored).collect())
        .unwrap_or_default()
}

fn parse_stored(v: &Value) -> Option<StoredWallet> {
    Some(StoredWallet {
        label: v.get("label")?.as_str()?.to_string(),
        address: v.get("address")?.as_str()?.to_string(),
        redeem_script: v.get("redeemScript")?.as_str()?.to_string(),
        m: v.get("m")?.as_u64()? as u32,
        n: v.get("n")?.as_u64()? as u32,
        participants: v
            .get("participants")
            .and_then(|p| p.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        created_at: v.get("createdAt").and_then(|c| c.as_i64()).unwrap_or(0),
    })
}

fn write_store(wallets: &[StoredWallet]) -> Result<(), String> {
    let dir = dd69_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create config dir: {e}"))?;
    let arr: Vec<Value> = wallets
        .iter()
        .map(|w| {
            json!({
                "label": w.label,
                "address": w.address,
                "redeemScript": w.redeem_script,
                "m": w.m,
                "n": w.n,
                "participants": w.participants,
                "createdAt": w.created_at,
            })
        })
        .collect();
    let body = serde_json::to_string_pretty(&json!({ "wallets": arr }))
        .map_err(|e| format!("cannot encode the multisig store: {e}"))?;
    std::fs::write(store_path(), body).map_err(|e| format!("cannot write the multisig store: {e}"))
}

// ── Address balances (any address, via the address index) ────────────────────

/// Guard against the malformed-address RPC hang: never pass an address to
/// getaddress* without validating it first.
fn validate(rpc: &RpcClient, address: &str) -> Result<(), String> {
    let v = rpc
        .call("validateaddress", json!([address]))
        .map_err(|e| format!("could not check the address: {e}"))?;
    if v.get("isvalid").and_then(|b| b.as_bool()) != Some(true) {
        return Err("That is not a valid Divi address.".into());
    }
    Ok(())
}

/// Turn a raw RPC error into something honest for the UI when the address index
/// simply isn't ready yet (first launch after it was enabled runs a reindex).
fn index_hint(err: &str) -> String {
    if err.contains("address index not enabled")
        || err.contains("No information available for address")
    {
        "The node's address index isn't ready yet — it finishes building on the next node start, \
         and balances appear once it does."
            .into()
    } else {
        format!("could not read the balance: {err}")
    }
}

/// Confirmed balance of ANY address, in DIVI, via the address index.
pub fn address_balance(cfg: &NodeConfig, address: &str) -> Result<f64, String> {
    let rpc = RpcClient::new(cfg);
    validate(&rpc, address)?;
    let v = rpc
        .call("getaddressbalance", json!([{ "addresses": [address] }]))
        .map_err(|e| index_hint(&e))?;
    let sat = read_sat(&v["balance"]).ok_or("node did not return a balance")?;
    Ok(sat_to_divi(sat))
}

/// getaddress* return satoshi amounts that may arrive as a JSON number or, for
/// very large values, a string. Accept either.
fn read_sat(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

// ── Wallet lifecycle ─────────────────────────────────────────────────────────

pub struct WalletView {
    pub label: String,
    pub address: String,
    pub m: u32,
    pub n: u32,
    pub participants: Vec<String>,
    pub balance: f64,
    pub balance_available: bool,
    pub created_at: i64,
}

/// Every multisig wallet this app knows, each with a freshly read balance.
pub fn list_wallets(cfg: &NodeConfig) -> Vec<WalletView> {
    read_store()
        .into_iter()
        .map(|w| {
            let (balance, available) = match address_balance(cfg, &w.address) {
                Ok(b) => (b, true),
                Err(_) => (0.0, false),
            };
            WalletView {
                label: w.label,
                address: w.address,
                m: w.m,
                n: w.n,
                participants: w.participants,
                balance,
                balance_available: available,
                created_at: w.created_at,
            }
        })
        .collect()
}

/// Build an m-of-n P2SH multisig address from a set of co-signer keys. Each key
/// is either a hex public key or a Divi address whose pubkey the node knows.
/// Nothing is imported and no unlock is needed — this only derives the address
/// and its redeemScript, which we store so spends can be signed later.
pub fn create_wallet(
    cfg: &NodeConfig,
    m: u32,
    keys: Vec<String>,
    label: &str,
) -> Result<StoredWallet, String> {
    let n = keys.len() as u32;
    if n < 1 || n > 16 {
        return Err("A multisig wallet needs between 1 and 16 co-signers.".into());
    }
    if m == 0 || m > n {
        return Err("Signatures required must be between 1 and the number of co-signers.".into());
    }
    let keys: Vec<String> = keys.into_iter().map(|k| k.trim().to_string()).collect();
    if keys.iter().any(|k| k.is_empty()) {
        return Err("One of the co-signer keys is empty.".into());
    }
    let rpc = RpcClient::new(cfg);
    let res = rpc
        .call("createmultisig", json!([m, keys]))
        .map_err(|e| format!("could not build the multisig address: {e}"))?;
    let address = res
        .get("address")
        .and_then(|a| a.as_str())
        .ok_or("node did not return an address")?
        .to_string();
    let redeem = res
        .get("redeemScript")
        .and_then(|r| r.as_str())
        .ok_or("node did not return a redeem script")?
        .to_string();

    let mut store = read_store();
    if store.iter().any(|w| w.address == address) {
        return Err("That exact multisig wallet already exists here.".into());
    }
    let w = StoredWallet {
        label: if label.trim().is_empty() {
            "Multisig wallet".into()
        } else {
            label.trim().to_string()
        },
        address,
        redeem_script: redeem,
        m,
        n,
        participants: keys,
        created_at: now_secs(),
    };
    store.push(w.clone());
    write_store(&store)?;
    Ok(w)
}

/// Remove a wallet from this app's list. Local only — it never moves coins and
/// the wallet can be re-added from the same co-signer keys.
pub fn forget_wallet(address: &str) -> Result<(), String> {
    let mut store = read_store();
    let before = store.len();
    store.retain(|w| w.address != address);
    if store.len() == before {
        return Err("No such multisig wallet.".into());
    }
    write_store(&store)
}

// ── Spend proposal / signing / broadcast ─────────────────────────────────────

pub struct PendingSpend {
    pub blob: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub fee: f64,
    pub required: u32,
}

/// Rough on-the-wire size of a P2SH multisig spend, to set a sane fee. Each
/// input carries M signatures (~74 B each) plus the redeemScript, wrapped by
/// push opcodes; we over-estimate a little so a proposed spend confirms rather
/// than sticks in the mempool.
fn est_fee(inputs: usize, outputs: usize, m: u32, n: u32) -> f64 {
    let redeem = 3 + 34 * n as usize;
    let per_input = 40 + 4 + (m as usize) * 74 + redeem + 6;
    let size = 10 + inputs * per_input + outputs * 34;
    round8(size as f64 * RELAY_SATS_PER_BYTE / 1e8)
}

/// Propose a spend from a multisig wallet. Builds (but does NOT sign) a raw
/// transaction spending enough of the wallet's coins to pay `amount` plus fee,
/// with change returned to the multisig. The result is a text blob to hand to
/// the co-signers.
pub fn propose_spend(cfg: &NodeConfig, from: &str, to: &str, amount: f64) -> Result<PendingSpend, String> {
    if amount <= 0.0 {
        return Err("Amount must be greater than zero.".into());
    }
    let rpc = RpcClient::new(cfg);
    let w = read_store()
        .into_iter()
        .find(|w| w.address == from)
        .ok_or("That multisig wallet is not in this app.")?;
    validate(&rpc, to)?;

    let utxos = rpc
        .call("getaddressutxos", json!([{ "addresses": [from] }]))
        .map_err(|e| index_hint(&e))?;
    let mut coins = utxos.as_array().cloned().unwrap_or_default();
    if coins.is_empty() {
        return Err("This wallet has no spendable coins yet.".into());
    }
    // Largest-first selection to cover amount + estimated fee.
    coins.sort_by(|a, b| {
        read_sat(&b["satoshis"]).unwrap_or(0).cmp(&read_sat(&a["satoshis"]).unwrap_or(0))
    });
    let mut selected: Vec<&Value> = Vec::new();
    let mut total_sat: i64 = 0;
    for c in &coins {
        selected.push(c);
        total_sat += read_sat(&c["satoshis"]).unwrap_or(0);
        if sat_to_divi(total_sat) >= amount + est_fee(selected.len(), 2, w.m, w.n) {
            break;
        }
    }
    let fee = est_fee(selected.len(), 2, w.m, w.n);
    let total = sat_to_divi(total_sat);
    if total < amount + fee {
        return Err("Not enough coins in this wallet to cover the amount and the fee.".into());
    }
    if fee > FEE_CAP_DIVI {
        return Err("Estimated fee exceeds the safety cap.".into());
    }

    let inputs: Vec<Value> = selected
        .iter()
        .map(|u| json!({ "txid": u["txid"], "vout": u["outputIndex"] }))
        .collect();
    let change = round8(total - amount - fee);
    let mut outputs = serde_json::Map::new();
    outputs.insert(to.to_string(), json!(round8(amount)));
    if change >= DUST_DIVI {
        outputs.insert(from.to_string(), json!(change)); // change back to the multisig
    }
    let raw = rpc
        .call("createrawtransaction", json!([inputs, Value::Object(outputs)]))
        .map_err(|e| format!("could not build the spend: {e}"))?;
    let raw_hex = raw.as_str().ok_or("createrawtransaction returned no hex")?.to_string();

    // Everything a signer (and the final fee check) needs per input: the
    // scriptPubKey, our redeemScript, and the input's value.
    let prevtxs: Vec<Value> = selected
        .iter()
        .map(|u| {
            json!({
                "txid": u["txid"],
                "vout": u["outputIndex"],
                "scriptPubKey": u["script"],
                "redeemScript": w.redeem_script,
                "amountSat": read_sat(&u["satoshis"]).unwrap_or(0),
            })
        })
        .collect();

    let blob = encode_blob(&raw_hex, &prevtxs, from, to, amount, fee, w.m);
    Ok(PendingSpend {
        blob,
        from: from.to_string(),
        to: to.to_string(),
        amount,
        fee,
        required: w.m,
    })
}

pub struct SignResult {
    pub blob: String,
    pub complete: bool,
    pub added: bool, // did THIS wallet contribute a signature?
    pub signed: u32,
    pub required: u32,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub fee: f64,
}

/// Add this wallet's signature to a pending spend, if it holds one of the keys.
/// Returns the updated blob to pass to the next signer, and how many of the
/// required signatures are now present.
pub fn sign_spend(cfg: &NodeConfig, blob: &str, passphrase: Option<&str>) -> Result<SignResult, String> {
    let b = decode_blob(blob)?;
    let rpc = RpcClient::new(cfg);
    let before = count_sigs(&rpc, &b.raw);

    if let Some(p) = passphrase {
        rpc.call("walletpassphrase", json!([p, 120, false]))
            .map_err(|e| format!("Unlock failed: {e}"))?;
    }
    let result = (|| {
        let signed = rpc
            .call("signrawtransaction", json!([b.raw, b.prevtxs]))
            .map_err(|e| format!("signing failed: {e}"))?;
        let hex = signed
            .get("hex")
            .and_then(|h| h.as_str())
            .ok_or("signing produced nothing")?
            .to_string();
        let complete = signed.get("complete").and_then(|c| c.as_bool()).unwrap_or(false);
        let after = count_sigs(&rpc, &hex);
        let prevtxs = b.prevtxs.as_array().cloned().unwrap_or_default();
        let new_blob = encode_blob(&hex, &prevtxs, &b.from, &b.to, b.amount, b.fee, b.required);
        Ok(SignResult {
            blob: new_blob,
            complete,
            added: after > before,
            signed: after,
            required: b.required,
            from: b.from.clone(),
            to: b.to.clone(),
            amount: b.amount,
            fee: b.fee,
        })
    })();
    if let Some(p) = passphrase {
        let _ = rpc.call("walletpassphrase", json!([p, 0, true]));
    }
    result
}

/// Broadcast a fully-signed spend. Refuses anything short of the required
/// signatures, and recomputes the REAL fee from the inputs and outputs to abort
/// before sending anything with an out-of-range fee.
pub fn broadcast_spend(cfg: &NodeConfig, blob: &str) -> Result<String, String> {
    let b = decode_blob(blob)?;
    let rpc = RpcClient::new(cfg);

    let signed = count_sigs(&rpc, &b.raw);
    if signed < b.required {
        return Err(format!(
            "This spend has {signed} of the {} signatures it needs.",
            b.required
        ));
    }

    // Real fee = sum(input values) - sum(output values). Input values were
    // carried in prevtxs at proposal time; outputs are read back from the tx.
    let dec = rpc
        .call("decoderawtransaction", json!([b.raw]))
        .map_err(|e| format!("decode: {e}"))?;
    let out_sum: f64 = dec["vout"]
        .as_array()
        .map(|a| a.iter().map(|v| v["value"].as_f64().unwrap_or(0.0)).sum())
        .unwrap_or(0.0);
    let in_sum: f64 = b
        .prevtxs
        .as_array()
        .map(|a| a.iter().map(|p| sat_to_divi(read_sat(&p["amountSat"]).unwrap_or(0))).sum())
        .unwrap_or(0.0);
    let real_fee = round8(in_sum - out_sum);
    if !(0.0..=FEE_CAP_DIVI).contains(&real_fee) {
        return Err(format!(
            "Aborted before broadcast: the fee ({real_fee} DIVI) is outside the safe range."
        ));
    }

    let txid = rpc
        .call("sendrawtransaction", json!([b.raw]))
        .map_err(|e| classify_broadcast(&e))?;
    txid.as_str()
        .map(str::to_string)
        .ok_or_else(|| "the node did not confirm the broadcast".to_string())
}

fn classify_broadcast(err: &str) -> String {
    if err.contains("already in block chain")
        || err.contains("txn-already-known")
        || err.contains("already have")
    {
        "This spend was already broadcast.".into()
    } else {
        format!("The node rejected the broadcast: {err}")
    }
}

/// Count the signatures present on the first input of a (partially) signed
/// multisig transaction. The scriptSig reads `0 <sig> <sig> ... <redeemScript>`;
/// the signatures are the DER pushes between the leading OP_0 and the trailing
/// redeemScript.
fn count_sigs(rpc: &RpcClient, hex: &str) -> u32 {
    let dec = match rpc.call("decoderawtransaction", json!([hex])) {
        Ok(d) => d,
        Err(_) => return 0,
    };
    let asm = dec["vin"]
        .get(0)
        .and_then(|i| i["scriptSig"]["asm"].as_str())
        .unwrap_or("");
    let toks: Vec<&str> = asm.split_whitespace().collect();
    if toks.len() < 2 {
        return 0;
    }
    // Skip the leading OP_0 and the trailing redeemScript; count DER sig pushes.
    toks.iter()
        .skip(1)
        .take(toks.len().saturating_sub(2))
        .filter(|t| t.starts_with("30") && t.len() >= 100)
        .count() as u32
}

// ── Blob encoding (the shareable pending-spend) ──────────────────────────────

fn encode_blob(raw: &str, prevtxs: &[Value], from: &str, to: &str, amount: f64, fee: f64, required: u32) -> String {
    let payload = json!({
        "v": 1,
        "raw": raw,
        "prevtxs": prevtxs,
        "from": from,
        "to": to,
        "amount": amount,
        "fee": fee,
        "required": required,
    });
    format!(
        "DVMS1-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes())
    )
}

struct Blob {
    raw: String,
    prevtxs: Value,
    from: String,
    to: String,
    amount: f64,
    fee: f64,
    required: u32,
}

fn decode_blob(blob: &str) -> Result<Blob, String> {
    let body = blob
        .trim()
        .strip_prefix("DVMS1-")
        .ok_or("That is not a multisig spend.")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.as_bytes())
        .map_err(|_| "That spend is malformed.".to_string())?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| "That spend is malformed.".to_string())?;
    if v.get("v").and_then(|x| x.as_i64()) != Some(1) {
        return Err("That spend is an unsupported version.".into());
    }
    Ok(Blob {
        raw: v.get("raw").and_then(|x| x.as_str()).ok_or("malformed spend")?.to_string(),
        prevtxs: v.get("prevtxs").cloned().ok_or("malformed spend")?,
        from: v.get("from").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        to: v.get("to").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        amount: v.get("amount").and_then(|x| x.as_f64()).unwrap_or(0.0),
        fee: v.get("fee").and_then(|x| x.as_f64()).unwrap_or(0.0),
        required: v.get("required").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
    })
}
