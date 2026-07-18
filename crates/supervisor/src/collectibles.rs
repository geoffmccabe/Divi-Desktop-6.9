// NFD (Divi Collectibles) mint + view flow: ties the encryption core
// (crypto_nfd), record codec (nfd_record), and storage (nfd_storage) to the
// node over RPC. Transfer is Phase 5.
//
// Ownership is consistent by construction: a mint is funded from a UTXO, and
// that UTXO's address is BOTH the decrypting owner (its signmessage seeds the
// encryption key) and the chain owner (the funding input). Authenticity is
// enforced on view: the decrypted content must hash to the on-chain content_hash.

use crate::config::NodeConfig;
use crate::nfd_storage::{LocalDir, Storage};
use crate::rpc::RpcClient;
use crate::{crypto_nfd, nfd_record};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const FEE: f64 = 0.0001;
const SALT_LEN: usize = 16;

/// Result of a mint. The encrypted bundle lives in storage under `arweave_ptr`;
/// the caller keeps this handle to list/view later.
pub struct MintDraft {
    pub txid: String,
    pub owner_addr: String,
    pub content_hash: String,
    pub arweave_ptr: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn rand_salt() -> Result<[u8; SALT_LEN], String> {
    let mut b = [0u8; SALT_LEN];
    getrandom::getrandom(&mut b).map_err(|e| e.to_string())?;
    Ok(b)
}

/// bundle = 4-byte LE len(content_blob) | content_blob | wrapped_ck
fn pack_bundle(content_blob: &[u8], wrapped_ck: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + content_blob.len() + wrapped_ck.len());
    out.extend_from_slice(&(content_blob.len() as u32).to_le_bytes());
    out.extend_from_slice(content_blob);
    out.extend_from_slice(wrapped_ck);
    out
}

fn unpack_bundle(bundle: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    if bundle.len() < 4 {
        return Err("corrupt bundle".into());
    }
    let n = u32::from_le_bytes([bundle[0], bundle[1], bundle[2], bundle[3]]) as usize;
    let rest = &bundle[4..];
    if n > rest.len() {
        return Err("corrupt bundle".into());
    }
    Ok((rest[..n].to_vec(), rest[n..].to_vec()))
}

/// The owner's X25519 encryption keypair, from a deterministic signmessage
/// signature. The node's real private key is never exposed.
fn owner_keypair(rpc: &RpcClient, owner_addr: &str) -> Result<(StaticSecret, PublicKey), String> {
    let sig = rpc.call("signmessage", json!([owner_addr, crypto_nfd::key_domain_phrase()]))?;
    let sig_b64 = sig
        .as_str()
        .ok_or("the node did not return a signature (is the owner's key in this wallet?)")?;
    let sig_bytes = STANDARD
        .decode(sig_b64)
        .map_err(|_| "could not decode the signature".to_string())?;
    Ok(crypto_nfd::derive_enc_keypair(&sig_bytes))
}

/// Largest spendable UTXO that has a plain address; it becomes the owner.
fn pick_funding_utxo(rpc: &RpcClient) -> Result<Value, String> {
    let unspent = rpc.call("listunspent", json!([]))?;
    unspent
        .as_array()
        .and_then(|a| {
            a.iter()
                .filter(|u| u["address"].is_string() && u["amount"].as_f64().unwrap_or(0.0) >= FEE)
                .max_by(|x, y| {
                    let ax = x["amount"].as_f64().unwrap_or(0.0);
                    let ay = y["amount"].as_f64().unwrap_or(0.0);
                    ax.partial_cmp(&ay).unwrap_or(std::cmp::Ordering::Equal)
                })
        })
        .cloned()
        .ok_or_else(|| "You need a small amount of DIVI to mint.".to_string())
}

fn anchor_record(rpc: &RpcClient, utxo: &Value, record_hex: &str) -> Result<String, String> {
    let amount = utxo["amount"].as_f64().unwrap_or(0.0);
    let change = ((amount - FEE) * 1e8).round() / 1e8;
    let change_addr = rpc
        .call("getnewaddress", json!([]))?
        .as_str()
        .ok_or("could not get a change address")?
        .to_string();
    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);

    let mut outs = serde_json::Map::new();
    outs.insert(change_addr.clone(), json!(change));
    outs.insert("data".into(), json!(record_hex));
    let raw = match rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)])) {
        Ok(v) => v,
        Err(_) => {
            let script = nfd_record::op_meta_script(record_hex);
            let mut outs = serde_json::Map::new();
            outs.insert(change_addr, json!(change));
            outs.insert(script, json!(0));
            rpc.call("createrawtransaction", json!([inputs, Value::Object(outs)]))?
        }
    };
    let signed = rpc.call("signrawtransaction", json!([raw]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("Could not sign the mint transaction.".into());
    }
    let txid = rpc
        .call("sendrawtransaction", json!([signed["hex"]]))?
        .as_str()
        .ok_or("the node did not return a transaction id")?
        .to_string();
    Ok(txid)
}

/// Mint a collectible from `plaintext`. Owner = the funding UTXO's address.
pub fn mint(cfg: &NodeConfig, plaintext: &[u8]) -> Result<MintDraft, String> {
    let rpc = RpcClient::new(cfg);
    let utxo = pick_funding_utxo(&rpc)?;
    let owner_addr = utxo["address"].as_str().ok_or("funding UTXO has no address")?.to_string();
    let (_sk, owner_pub) = owner_keypair(&rpc, &owner_addr)?;

    // Salt-prefix the plaintext. content_hash = sha256(salt||plaintext): the salt
    // is encrypted inside the bundle, so an outsider can't confirm which known
    // file this is, yet the owner can verify authenticity after decrypting.
    let salt = rand_salt()?;
    let mut salted = Vec::with_capacity(SALT_LEN + plaintext.len());
    salted.extend_from_slice(&salt);
    salted.extend_from_slice(plaintext);
    let content_hash = sha256_hex(&salted);

    let (content_blob, wrapped_ck) = crypto_nfd::encrypt_content(&salted, &owner_pub)?;
    let bundle = pack_bundle(&content_blob, &wrapped_ck);
    let arweave_ptr = LocalDir::under_datadir(&cfg.datadir).put(&bundle)?;

    let record = nfd_record::encode_mint(&arweave_ptr, &content_hash, 0x01)?;
    let txid = anchor_record(&rpc, &utxo, &record)?;
    Ok(MintDraft { txid, owner_addr, content_hash, arweave_ptr })
}

/// Fetch, decrypt, and AUTHENTICATE a collectible you own. Errors unless the
/// decrypted content hashes to the on-chain `content_hash`.
pub fn view(cfg: &NodeConfig, owner_addr: &str, arweave_ptr: &str, content_hash: &str) -> Result<Vec<u8>, String> {
    let bundle = LocalDir::under_datadir(&cfg.datadir).get(arweave_ptr)?;
    let (content_blob, wrapped_ck) = unpack_bundle(&bundle)?;
    let rpc = RpcClient::new(cfg);
    let (sk, _pk) = owner_keypair(&rpc, owner_addr)?;
    let salted = crypto_nfd::decrypt_content(&content_blob, &wrapped_ck, &sk)?;
    if sha256_hex(&salted) != content_hash.to_lowercase() {
        return Err("content does not match the on-chain record — not authentic".into());
    }
    if salted.len() < SALT_LEN {
        return Err("content is malformed".into());
    }
    Ok(salted[SALT_LEN..].to_vec())
}

/// Read the NFD record anchored by `txid`, if any (recovers arweave_ptr /
/// content_hash for view).
pub fn read_record(cfg: &NodeConfig, txid: &str) -> Result<Option<nfd_record::NfdRecord>, String> {
    let rpc = RpcClient::new(cfg);
    let tx = rpc.call("getrawtransaction", json!([txid, 1]))?;
    Ok(tx["vout"]
        .as_array()
        .and_then(|vouts| vouts.iter().find_map(|v| v["scriptPubKey"]["hex"].as_str().and_then(nfd_record::parse))))
}
