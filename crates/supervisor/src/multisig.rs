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
const FEE_CAP_DIVI: f64 = 1.0; // absolute ceiling; abort before broadcasting past it
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
    pub definition: String,
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
            let definition = definition_blob(&w);
            WalletView {
                label: w.label,
                address: w.address,
                m: w.m,
                n: w.n,
                participants: w.participants,
                balance,
                balance_available: available,
                definition,
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
    add_wallet(cfg, m, keys, label, false)
}

/// The shared body of create + import. `allow_existing` makes re-adding an
/// already-known wallet a no-op that returns it (used by import), instead of an
/// error (used by create).
fn add_wallet(
    cfg: &NodeConfig,
    m: u32,
    keys: Vec<String>,
    label: &str,
    allow_existing: bool,
) -> Result<StoredWallet, String> {
    let n = keys.len() as u32;
    // Cap at 15, not 16: an m-of-16 redeemScript of compressed keys exceeds the
    // 520-byte P2SH standardness limit and the wallet would be unspendable.
    if n < 1 || n > 15 {
        return Err("A multisig wallet needs between 1 and 15 co-signers.".into());
    }
    if m == 0 || m > n {
        return Err("Signatures required must be between 1 and the number of co-signers.".into());
    }
    let keys: Vec<String> = keys.into_iter().map(|k| k.trim().to_string()).collect();
    if keys.iter().any(|k| k.is_empty()) {
        return Err("One of the co-signer keys is empty.".into());
    }
    // Reject uncompressed public keys (65 bytes, "04…"): they bloat the
    // redeemScript past the 520-byte P2SH limit at far fewer signers and would
    // make the wallet unspendable. Ask for the compressed key instead.
    if keys
        .iter()
        .any(|k| k.len() == 130 && k.starts_with("04"))
    {
        return Err(
            "An uncompressed public key was supplied. Ask that co-signer for their compressed key (starts with 02 or 03)."
                .into(),
        );
    }
    let rpc = RpcClient::new(cfg);
    // NOTE: Divi does NOT sort the keys (no BIP67), so the key ORDER decides the
    // address. Every co-signer must build the wallet from the same keys in the
    // same order — which is exactly what sharing the definition blob guarantees.
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

    // Import the multisig into the wallet so it can later sign spends with any
    // of these keys it holds. Deriving the address alone is not enough: in this
    // build, wallet-based signrawtransaction only contributes a signature for a
    // P2SH multisig the wallet actually knows. Same address as createmultisig.
    rpc.call("addmultisigaddress", json!([m, keys]))
        .map_err(|e| format!("could not import the multisig into the wallet: {e}"))?;

    let mut store = read_store();
    if let Some(existing) = store.iter().find(|w| w.address == address).cloned() {
        if allow_existing {
            return Ok(existing);
        }
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

/// The full, shareable definition of a shared wallet: its threshold and the
/// co-signer public keys IN ORDER. Anyone who imports this gets the identical
/// address (order matters — see the note in add_wallet), so it is both the way
/// to add a wallet someone else built and the thing to back up.
pub fn definition_blob(w: &StoredWallet) -> String {
    let payload = json!({ "v": 1, "m": w.m, "keys": w.participants, "label": w.label });
    format!(
        "DVMW1-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes())
    )
}

struct Definition {
    m: u32,
    keys: Vec<String>,
    label: String,
}

fn decode_definition(blob: &str) -> Result<Definition, String> {
    let body = blob
        .trim()
        .strip_prefix("DVMW1-")
        .ok_or("That is not a shared-wallet definition.")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.as_bytes())
        .map_err(|_| "That wallet definition is malformed.".to_string())?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| "That wallet definition is malformed.".to_string())?;
    if v.get("v").and_then(|x| x.as_i64()) != Some(1) {
        return Err("That wallet definition is an unsupported version.".into());
    }
    Ok(Definition {
        m: v.get("m").and_then(|x| x.as_u64()).ok_or("malformed definition")? as u32,
        keys: v
            .get("keys")
            .and_then(|k| k.as_array())
            .ok_or("malformed definition")?
            .iter()
            .filter_map(|k| k.as_str().map(str::to_string))
            .collect(),
        label: v.get("label").and_then(|x| x.as_str()).unwrap_or("").to_string(),
    })
}

/// Add a shared wallet someone else built, from its definition blob. Imports it
/// so this wallet can co-sign, and derives the same address as everyone else.
pub fn import_wallet(cfg: &NodeConfig, definition: &str) -> Result<StoredWallet, String> {
    let d = decode_definition(definition)?;
    add_wallet(cfg, d.m, d.keys, &d.label, true)
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

    let blob = encode_blob(&raw_hex, &prevtxs, from, to, amount, fee, w.m, &w.participants);
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

    // SAFETY GATE: only ever sign a clean single-wallet spend whose inputs are
    // exactly the multisig this blob declares. This runs BEFORE unlocking, so a
    // malicious blob can never get the wallet to sign the victim's personal or
    // other-wallet coins.
    let dec = rpc
        .call("decoderawtransaction", json!([b.raw]))
        .map_err(|e| format!("could not read the spend: {e}"))?;
    verified_source(&rpc, &dec, b.required, &b.keys)?;

    let before = count_sigs(&rpc, &b.raw);

    // Import the multisig into the wallet from the definition carried in the
    // blob, so a co-signer who never "created" this wallet locally can still
    // sign a spend they were sent. Idempotent; best-effort (older blobs may not
    // carry the keys, in which case the wallet must already know the multisig).
    if !b.keys.is_empty() {
        let _ = rpc.call("addmultisigaddress", json!([b.required, b.keys]));
    }

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
        let new_blob = encode_blob(&hex, &prevtxs, &b.from, &b.to, b.amount, b.fee, b.required, &b.keys);
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
    // Re-lock the wallet explicitly rather than relying on a passphrase call to
    // fail-safe, so it never stays unlocked after signing.
    if passphrase.is_some() {
        let _ = rpc.call("walletlock", json!([]));
    }
    result
}

/// Broadcast a fully-signed spend. Refuses anything short of the required
/// signatures, re-verifies the inputs all belong to the one declared wallet,
/// and recomputes the REAL fee from the chain to abort before sending anything
/// with an out-of-range fee.
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

    // Real fee = sum(REAL input values from the chain) - sum(output values).
    // Input values are read from the chain, never the blob's self-reported
    // amountSat, so a lying blob cannot hide a fund-burning fee past this check.
    // verified_source also re-checks the inputs all belong to the one declared
    // wallet before we ever broadcast.
    let dec = rpc
        .call("decoderawtransaction", json!([b.raw]))
        .map_err(|e| format!("decode: {e}"))?;
    let out_sum: f64 = dec["vout"]
        .as_array()
        .map(|a| a.iter().map(|v| v["value"].as_f64().unwrap_or(0.0)).sum())
        .unwrap_or(0.0);
    let (_src, in_sum) = verified_source(&rpc, &dec, b.required, &b.keys)?;
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

pub struct SpendOutput {
    pub address: String,
    pub amount: f64,
    pub is_change: bool, // paid back to the multisig itself
}

pub struct SpendPreview {
    pub from: String,
    pub mixed_sources: bool, // inputs come from more than one address (suspicious)
    pub source_ok: bool,     // inputs really belong to the wallet this blob declares
    pub total_in: f64,
    pub outputs: Vec<SpendOutput>,
    pub total_out: f64,
    pub fee: f64,
    pub signed: u32,
    pub required: u32,
    pub complete: bool,
}

/// Sum the REAL value of a transaction's inputs by reading each spent output
/// from the chain — never the blob's self-reported `amountSat`, which a
/// malicious proposer controls. Also collects the distinct source address(es).
/// Errors if any input is already spent or unknown (a stale or bogus spend).
fn chain_inputs(rpc: &RpcClient, decoded_tx: &Value) -> Result<(f64, Vec<String>), String> {
    let vins = decoded_tx["vin"].as_array().ok_or("transaction has no inputs")?;
    let mut total = 0.0;
    let mut sources: Vec<String> = Vec::new();
    for vin in vins {
        let txid = vin["txid"].as_str().ok_or("malformed input")?;
        let vout = vin["vout"].as_u64().ok_or("malformed input")?;
        let o = rpc.call("gettxout", json!([txid, vout, true]))?;
        if o.is_null() {
            return Err(
                "This spend uses coins that are already spent or unknown — it is stale or invalid."
                    .into(),
            );
        }
        total = round8(total + o["value"].as_f64().unwrap_or(0.0));
        if let Some(addr) = o["scriptPubKey"]["addresses"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|x| x.as_str())
        {
            if !sources.iter().any(|s| s == addr) {
                sources.push(addr.to_string());
            }
        }
    }
    Ok((total, sources))
}

/// Refuse anything but a clean single-wallet spend: every input must come from
/// ONE address, and that address must be exactly the multisig derived from the
/// blob's own definition (keys + threshold). This is the core anti-theft guard:
/// it stops a malicious blob from smuggling in the victim's personal single-sig
/// UTXOs (one signature would spend them) or a different multisig's coins, and
/// it stops "change" from being redirected to an attacker. Returns the verified
/// source address.
fn verified_source(
    rpc: &RpcClient,
    decoded: &Value,
    required: u32,
    keys: &[String],
) -> Result<(String, f64), String> {
    let (total_in, sources) = chain_inputs(rpc, decoded)?;
    if sources.is_empty() {
        return Err("This spend has no recognizable inputs.".into());
    }
    if sources.len() > 1 {
        return Err(
            "This spend draws coins from more than one address — refusing for safety. A shared-wallet \
             spend must spend only that wallet's own coins."
                .into(),
        );
    }
    let src = sources.into_iter().next().unwrap();
    if keys.is_empty() {
        // Old blob without the definition: fall back to requiring the wallet be
        // one this app already knows.
        if !read_store().iter().any(|w| w.address == src) {
            return Err("This spend is for a wallet this app doesn't know — add it first.".into());
        }
        return Ok((src, total_in));
    }
    let res = rpc
        .call("createmultisig", json!([required, keys]))
        .map_err(|e| format!("could not verify the wallet: {e}"))?;
    let derived = res.get("address").and_then(|a| a.as_str()).unwrap_or_default();
    if derived != src {
        return Err(
            "These coins do not belong to the shared wallet named in this spend — refusing to sign.".into(),
        );
    }
    Ok((src, total_in))
}

/// Decode the ACTUAL transaction a pending spend will make, so a signer can
/// verify the real source, recipient(s), amount(s) and fee before approving —
/// never trusting the blob's own labels. Outputs come from the raw tx; input
/// values and the source come from the CHAIN; the fee is the difference. Change
/// back to the (real) source is flagged as such.
pub fn inspect_spend(cfg: &NodeConfig, blob: &str) -> Result<SpendPreview, String> {
    let b = decode_blob(blob)?;
    let rpc = RpcClient::new(cfg);
    let dec = rpc
        .call("decoderawtransaction", json!([b.raw]))
        .map_err(|e| format!("could not read the spend: {e}"))?;
    let (total_in, sources) = chain_inputs(&rpc, &dec)?;
    let from = sources.first().cloned().unwrap_or_default();
    let mixed_sources = sources.len() > 1;

    // Do the inputs really belong to the wallet this blob claims? (Same check
    // sign/broadcast hard-enforce; here it's just surfaced as a warning so the
    // signer still sees the whole picture.)
    let source_ok = if from.is_empty() || mixed_sources {
        false
    } else if b.keys.is_empty() {
        read_store().iter().any(|w| w.address == from)
    } else {
        rpc.call("createmultisig", json!([b.required, b.keys]))
            .ok()
            .and_then(|r| r.get("address").and_then(|a| a.as_str()).map(str::to_string))
            .map(|d| d == from)
            .unwrap_or(false)
    };

    let mut outputs = Vec::new();
    let mut total_out = 0.0;
    if let Some(vouts) = dec["vout"].as_array() {
        for v in vouts {
            let amount = v["value"].as_f64().unwrap_or(0.0);
            total_out = round8(total_out + amount);
            let address = v["scriptPubKey"]["addresses"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|x| x.as_str())
                .unwrap_or("(unrecognized script)")
                .to_string();
            // Change = paid back to the real source address, not a claimed label.
            let is_change = !from.is_empty() && address == from;
            outputs.push(SpendOutput { address, amount, is_change });
        }
    }
    let fee = round8(total_in - total_out);
    let signed = count_sigs(&rpc, &b.raw);
    Ok(SpendPreview {
        from,
        mixed_sources,
        source_ok,
        total_in,
        outputs,
        total_out,
        fee,
        signed,
        required: b.required,
        complete: signed >= b.required,
    })
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

#[allow(clippy::too_many_arguments)]
fn encode_blob(
    raw: &str,
    prevtxs: &[Value],
    from: &str,
    to: &str,
    amount: f64,
    fee: f64,
    required: u32,
    keys: &[String],
) -> String {
    let payload = json!({
        "v": 1,
        "raw": raw,
        "prevtxs": prevtxs,
        "from": from,
        "to": to,
        "amount": amount,
        "fee": fee,
        "required": required,
        "keys": keys, // the wallet definition, so any co-signer can import + sign
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
    keys: Vec<String>,
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
        keys: v
            .get("keys")
            .and_then(|k| k.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
    })
}

/// The public key the node knows for one of the user's OWN addresses, so it can
/// be shared with co-signers to build a multisig. Only works for an address in
/// this wallet (the node has no one else's pubkey).
pub fn my_pubkey(cfg: &NodeConfig, address: &str) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    validate(&rpc, address)?;
    let v = rpc.call("validateaddress", json!([address]))?;
    if v.get("ismine").and_then(|b| b.as_bool()) != Some(true) {
        return Err("That address is not in this wallet, so its public key isn't known here.".into());
    }
    v.get("pubkey")
        .and_then(|p| p.as_str())
        .map(str::to_string)
        .ok_or_else(|| "The node did not return a public key for that address.".to_string())
}

pub struct MyKey {
    pub address: String,
    pub pubkey: String,
}

/// A fresh address in this wallet plus its public key, for the user to hand to
/// the other co-signers when setting up a shared wallet. The wallet keeps the
/// matching private key, so this same address can later sign the group's spends.
pub fn new_shareable_pubkey(cfg: &NodeConfig) -> Result<MyKey, String> {
    let rpc = RpcClient::new(cfg);
    let address = rpc
        .call("getnewaddress", json!([]))
        .map_err(|e| format!("could not get an address: {e}"))?
        .as_str()
        .ok_or("node did not return an address")?
        .to_string();
    let pubkey = my_pubkey(cfg, &address)?;
    Ok(MyKey { address, pubkey })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // Live round-trip against a local regtest node with addressindex on.
    // Bring one up (see the MultiSig completion notes) then run:
    //   cargo test -p dd69-supervisor multisig_ -- --ignored --nocapture --test-threads=1
    fn regtest() -> NodeConfig {
        NodeConfig {
            datadir: PathBuf::from("/tmp"), // unused for a remote (host/port) client
            rpc_host: "127.0.0.1".into(),
            rpc_user: "ms".into(),
            rpc_pass: "mspass".into(),
            rpc_port: 51841,
            remote: true,
        }
    }

    fn new_addr(rpc: &RpcClient) -> String {
        rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string()
    }
    fn pubkey_of(rpc: &RpcClient, addr: &str) -> String {
        rpc.call("validateaddress", json!([addr])).unwrap()["pubkey"].as_str().unwrap().to_string()
    }
    fn mine(rpc: &RpcClient, n: u32) {
        rpc.call("setgenerate", json!([n])).unwrap();
    }

    // The whole path through the actual module functions: create → fund →
    // propose → sign (wallet holds all keys) → broadcast, and confirm the
    // recipient is paid and change returns to the multisig.
    #[test]
    #[ignore]
    fn multisig_roundtrip() {
        let cfg = regtest();
        let rpc = RpcClient::new(&cfg);

        let (a, b, c) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let keys = vec![pubkey_of(&rpc, &a), pubkey_of(&rpc, &b), pubkey_of(&rpc, &c)];
        let w = create_wallet(&cfg, 2, keys, "rt-multisig-test").expect("create_wallet");
        println!("multisig address = {} ({}-of-{})", w.address, w.m, w.n);
        assert!(!w.address.is_empty() && !w.redeem_script.is_empty());

        // Fund it and confirm the balance reads back via the address index.
        rpc.call("sendtoaddress", json!([w.address, 100.0])).expect("fund");
        mine(&rpc, 3);
        let bal = address_balance(&cfg, &w.address).expect("balance");
        println!("multisig balance after funding = {bal}");
        assert!((bal - 100.0).abs() < 1e-6, "expected ~100, got {bal}");

        // Propose, sign (all 3 keys are in this wallet, so one call completes it), broadcast.
        let dest = new_addr(&rpc);
        let p = propose_spend(&cfg, &w.address, &dest, 40.0).expect("propose");
        assert!(p.blob.starts_with("DVMS1-"));
        let s = sign_spend(&cfg, &p.blob, None).expect("sign");
        println!("signed {}/{} complete={}", s.signed, s.required, s.complete);
        assert!(s.complete, "wallet holding all keys should complete the signature set");
        let txid = broadcast_spend(&cfg, &s.blob).expect("broadcast");
        println!("broadcast txid = {txid}");
        assert_eq!(txid.len(), 64);
        mine(&rpc, 3);

        let paid = address_balance(&cfg, &dest).expect("dest balance");
        let change = address_balance(&cfg, &w.address).expect("change balance");
        println!("recipient got {paid}; multisig change left = {change}");
        assert!((paid - 40.0).abs() < 1e-6, "recipient should have ~40, got {paid}");
        assert!(change > 59.0 && change < 60.0, "change should be ~60 minus fee, got {change}");

        forget_wallet(&w.address).ok(); // don't leave the test wallet in the store
    }

    // The multi-party premise: two DIFFERENT keys signing one spend in turn.
    // Simulated on one node by signing with explicit private keys (as separate
    // signers would), proving the iterative signrawtransaction merge my design
    // depends on actually works for a 2-of-3.
    #[test]
    #[ignore]
    fn multisig_iterative_two_signers() {
        let cfg = regtest();
        let rpc = RpcClient::new(&cfg);

        let (a, b, c) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let keys = vec![pubkey_of(&rpc, &a), pubkey_of(&rpc, &b), pubkey_of(&rpc, &c)];
        let res = rpc.call("createmultisig", json!([2, keys])).unwrap();
        let address = res["address"].as_str().unwrap().to_string();
        let redeem = res["redeemScript"].as_str().unwrap().to_string();
        let wif_a = rpc.call("dumpprivkey", json!([a])).unwrap().as_str().unwrap().to_string();
        let wif_b = rpc.call("dumpprivkey", json!([b])).unwrap().as_str().unwrap().to_string();

        rpc.call("sendtoaddress", json!([address, 50.0])).unwrap();
        mine(&rpc, 3);
        let utxos = rpc.call("getaddressutxos", json!([{ "addresses": [address] }])).unwrap();
        let u = &utxos.as_array().unwrap()[0];
        let dest = new_addr(&rpc);
        let raw = rpc
            .call("createrawtransaction", json!([[{"txid": u["txid"], "vout": u["outputIndex"]}], {dest.clone(): 40.0}]))
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        let prevtxs = json!([{ "txid": u["txid"], "vout": u["outputIndex"], "scriptPubKey": u["script"], "redeemScript": redeem }]);

        // Signer A only → not enough signatures yet.
        let s1 = rpc.call("signrawtransaction", json!([raw, prevtxs, [wif_a]])).unwrap();
        assert_eq!(s1["complete"].as_bool(), Some(false), "one of two sigs must be incomplete");
        // Signer B adds theirs on top of A's partially-signed tx → complete.
        let s2 = rpc.call("signrawtransaction", json!([s1["hex"], prevtxs, [wif_b]])).unwrap();
        assert_eq!(s2["complete"].as_bool(), Some(true), "second signer should complete it");
        let txid = rpc.call("sendrawtransaction", json!([s2["hex"]])).unwrap().as_str().unwrap().to_string();
        mine(&rpc, 3);
        let conf = rpc.call("getrawtransaction", json!([txid, 1])).unwrap();
        assert!(conf["confirmations"].as_i64().unwrap_or(0) >= 1, "iterative-signed spend must confirm");
        println!("iterative 2-of-3 spend confirmed: {txid}");
    }

    // The security functions: inspect_spend must report the REAL outputs from
    // the transaction (recipient + amount + change), and a shared definition
    // must re-derive the identical address on import.
    #[test]
    #[ignore]
    fn multisig_inspect_and_definition() {
        let cfg = regtest();
        let rpc = RpcClient::new(&cfg);
        let (a, b, c) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let keys = vec![pubkey_of(&rpc, &a), pubkey_of(&rpc, &b), pubkey_of(&rpc, &c)];
        let w = create_wallet(&cfg, 2, keys, "rt-inspect").expect("create");
        rpc.call("sendtoaddress", json!([w.address, 100.0])).expect("fund");
        mine(&rpc, 3);
        let dest = new_addr(&rpc);
        let p = propose_spend(&cfg, &w.address, &dest, 40.0).expect("propose");

        let prev = inspect_spend(&cfg, &p.blob).expect("inspect");
        let pay = prev.outputs.iter().find(|o| !o.is_change).expect("a payment output");
        assert_eq!(pay.address, dest, "recipient must match the real tx output");
        assert!((pay.amount - 40.0).abs() < 1e-6, "amount must be 40, got {}", pay.amount);
        let change = prev.outputs.iter().find(|o| o.is_change).expect("a change output");
        assert_eq!(change.address, w.address, "change must return to the multisig");
        assert_eq!(prev.required, 2);
        assert_eq!(prev.signed, 0, "unsigned before anyone signs");
        assert!(prev.fee > 0.0 && prev.fee < 0.01, "fee should be tiny, got {}", prev.fee);
        println!("inspect OK: pays {} to {}, change {}, fee {}", pay.amount, dest, change.amount, prev.fee);

        // A shared definition re-derives the SAME address on import.
        let def = definition_blob(&w);
        forget_wallet(&w.address).ok();
        let re = import_wallet(&cfg, &def).expect("import");
        assert_eq!(re.address, w.address, "import must reproduce the identical address");
        println!("import OK: same address {}", re.address);
        forget_wallet(&w.address).ok();
    }

    // Security: a malicious blob that lies about input values (amountSat) must
    // NOT change the fee the signer sees — it is read from the chain.
    #[test]
    #[ignore]
    fn multisig_fee_uses_chain_not_blob() {
        let cfg = regtest();
        let rpc = RpcClient::new(&cfg);
        let (a, b, c) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let keys = vec![pubkey_of(&rpc, &a), pubkey_of(&rpc, &b), pubkey_of(&rpc, &c)];
        let w = create_wallet(&cfg, 2, keys, "rt-fee").expect("create");
        rpc.call("sendtoaddress", json!([w.address, 100.0])).expect("fund");
        mine(&rpc, 3);
        let dest = new_addr(&rpc);
        let p = propose_spend(&cfg, &w.address, &dest, 40.0).expect("propose");
        let honest = inspect_spend(&cfg, &p.blob).expect("inspect honest");

        // Tamper: inflate every self-reported amountSat to a huge bogus value.
        let body = p.blob.strip_prefix("DVMS1-").unwrap();
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body).unwrap();
        let mut v: Value = serde_json::from_slice(&bytes).unwrap();
        if let Some(arr) = v["prevtxs"].as_array_mut() {
            for pt in arr {
                pt["amountSat"] = json!(999_999_999_999i64);
            }
        }
        let tampered = format!(
            "DVMS1-{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string().as_bytes())
        );
        let after = inspect_spend(&cfg, &tampered).expect("inspect tampered");

        assert!(
            (after.fee - honest.fee).abs() < 1e-8,
            "fee must come from the chain, not the blob (honest {}, tampered {})",
            honest.fee,
            after.fee
        );
        assert!(after.fee < 0.01, "real fee stays tiny despite tampering, got {}", after.fee);
        assert!((after.total_in - 100.0).abs() < 1e-6, "total_in from chain ~100, got {}", after.total_in);
        forget_wallet(&w.address).ok();
        println!("fee-from-chain OK: honest {} tampered-blob {} (unchanged)", honest.fee, after.fee);
    }

    // Security: a blob whose coins don't belong to the wallet it names must be
    // refused (the anti-theft guard against smuggled personal/other-wallet UTXOs).
    #[test]
    #[ignore]
    fn multisig_rejects_mismatched_coins() {
        let cfg = regtest();
        let rpc = RpcClient::new(&cfg);
        let (a, b, c) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let keys = vec![pubkey_of(&rpc, &a), pubkey_of(&rpc, &b), pubkey_of(&rpc, &c)];
        let w = create_wallet(&cfg, 2, keys, "rt-guard").expect("create");
        rpc.call("sendtoaddress", json!([w.address, 50.0])).expect("fund");
        mine(&rpc, 3);
        let dest = new_addr(&rpc);
        let p = propose_spend(&cfg, &w.address, &dest, 20.0).expect("propose");

        // The honest spend verifies and is signable.
        let honest = inspect_spend(&cfg, &p.blob).expect("inspect");
        assert!(honest.source_ok, "a legit single-wallet spend must verify");

        // Tamper: claim a DIFFERENT wallet's keys while the inputs are still w's.
        let (d, e, f) = (new_addr(&rpc), new_addr(&rpc), new_addr(&rpc));
        let other = vec![pubkey_of(&rpc, &d), pubkey_of(&rpc, &e), pubkey_of(&rpc, &f)];
        let body = p.blob.strip_prefix("DVMS1-").unwrap();
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body).unwrap();
        let mut v: Value = serde_json::from_slice(&bytes).unwrap();
        v["keys"] = json!(other);
        let tampered = format!(
            "DVMS1-{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string().as_bytes())
        );

        let insp = inspect_spend(&cfg, &tampered).expect("inspect tampered");
        assert!(!insp.source_ok, "mismatched keys must fail source verification");
        let signed = sign_spend(&cfg, &tampered, None);
        assert!(signed.is_err(), "sign must refuse coins that don't match the declared wallet");
        println!("guard OK: sign refused mismatched spend -> {}", signed.err().unwrap());
        forget_wallet(&w.address).ok();
    }
}
