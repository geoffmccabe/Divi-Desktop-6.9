// NFD (Divi Collectibles) mint + view flow: ties the encryption core
// (crypto_nfd) and the record codec (nfd_record) to the node over RPC.
//
// Storage (Arweave) is STUBBED here: the encrypted bundle is returned to the
// caller and the on-chain `arweave_ptr` is a content-derived stand-in. Phase 3
// swaps in the real Divi-funded relay behind this same shape -- mint/view don't
// change. Ownership/transfer is Phase 5.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use crate::{crypto_nfd, nfd_record};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const FEE: f64 = 0.0001;

/// The result of minting: the on-chain txid plus the encrypted bundle that
/// (Phase 3) will live on Arweave. Held by the caller for now.
pub struct MintDraft {
    pub txid: String,
    pub content_hash: String, // SHA-256 of the plaintext (hex)
    pub arweave_ptr: String,  // 32-byte storage pointer (hex; stubbed for now)
    pub content_blob: Vec<u8>, // AES-GCM ciphertext (-> Arweave later)
    pub wrapped_ck: Vec<u8>,   // content key wrapped to the owner (-> Arweave later)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Derive the owner's X25519 encryption keypair from a deterministic
/// `signmessage` signature -- the node's real private key is never exposed.
fn owner_keypair(rpc: &RpcClient, owner_addr: &str) -> Result<(StaticSecret, PublicKey), String> {
    let sig = rpc.call("signmessage", json!([owner_addr, crypto_nfd::key_domain_phrase()]))?;
    let sig_b64 = sig.as_str().ok_or("the node did not return a signature")?;
    let sig_bytes = STANDARD
        .decode(sig_b64)
        .map_err(|_| "could not decode the signature".to_string())?;
    Ok(crypto_nfd::derive_enc_keypair(&sig_bytes))
}

/// Build + sign + broadcast an OP_META output carrying `record_hex`. Mirrors the
/// PoE anchor: fund from the largest UTXO, "data" convention with a raw-script
/// fallback for builds that reject it.
fn anchor_record(rpc: &RpcClient, record_hex: &str) -> Result<String, String> {
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
        .ok_or("You need a small amount of DIVI to mint.")?;
    let amount = utxo["amount"].as_f64().unwrap_or(0.0);
    if amount < FEE {
        return Err("Not enough funds for the mint fee.".into());
    }
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

/// Mint a collectible owned by `owner_addr`: encrypt the content to the owner,
/// (stub) store the bundle, anchor a type-0x02 MINT record. Returns the draft.
pub fn mint(cfg: &NodeConfig, owner_addr: &str, plaintext: &[u8]) -> Result<MintDraft, String> {
    let rpc = RpcClient::new(cfg);
    let (_sk, owner_pub) = owner_keypair(&rpc, owner_addr)?;
    let (content_blob, wrapped_ck) = crypto_nfd::encrypt_content(plaintext, &owner_pub)?;
    let content_hash = sha256_hex(plaintext);
    let arweave_ptr = sha256_hex(&content_blob); // STUB stand-in until Phase 3
    let record = nfd_record::encode_mint(&arweave_ptr, &content_hash, 0x01)?;
    let txid = anchor_record(&rpc, &record)?;
    Ok(MintDraft { txid, content_hash, arweave_ptr, content_blob, wrapped_ck })
}

/// Decrypt a collectible you own back to its original bytes (in-memory only).
pub fn view(cfg: &NodeConfig, owner_addr: &str, content_blob: &[u8], wrapped_ck: &[u8]) -> Result<Vec<u8>, String> {
    let rpc = RpcClient::new(cfg);
    let (sk, _pk) = owner_keypair(&rpc, owner_addr)?;
    crypto_nfd::decrypt_content(content_blob, wrapped_ck, &sk)
}

/// Read the NFD record anchored by `txid` off the chain, if any.
pub fn read_record(cfg: &NodeConfig, txid: &str) -> Result<Option<nfd_record::NfdRecord>, String> {
    let rpc = RpcClient::new(cfg);
    let tx = rpc.call("getrawtransaction", json!([txid, 1]))?;
    Ok(tx["vout"].as_array().and_then(|vouts| {
        vouts
            .iter()
            .find_map(|v| v["scriptPubKey"]["hex"].as_str().and_then(nfd_record::parse))
    }))
}
