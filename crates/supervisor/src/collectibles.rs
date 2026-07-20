// NFD (Divi Collectibles) mint + view flow: ties the encryption core
// (crypto_nfd), record codec (nfd_record), and storage (nfd_storage) to the
// node over RPC. Transfer is Phase 5.
//
// Ownership is consistent by construction: a mint is funded from a UTXO, and
// that UTXO's address is BOTH the decrypting owner (its signmessage seeds the
// encryption key) and the chain owner (the funding input). Authenticity is
// enforced on view: the decrypted content must hash to the on-chain content_hash.

use crate::config::NodeConfig;
use crate::nfd_storage;
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
    /// Arweave id of the unencrypted public thumbnail, if the creator added one.
    pub thumb_ptr: Option<String>,
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

fn anchor_record(
    rpc: &RpcClient,
    utxo: &Value,
    record_hex: &str,
    fee_output: Option<(&str, f64)>,
) -> Result<String, String> {
    let amount = utxo["amount"].as_f64().unwrap_or(0.0);
    let treasury_fee = fee_output.map(|(_, f)| f).unwrap_or(0.0);
    let change = ((amount - FEE - treasury_fee) * 1e8).round() / 1e8;
    if change < 0.0 {
        return Err("Not enough DIVI to cover the network + treasury fee.".into());
    }
    // Change returns to the input's OWN address, so the owner address stays
    // funded and can authorize future transfers (spec §2b), instead of being
    // drained to a fresh change address on every mint/transfer.
    let change_addr = utxo["address"].as_str().ok_or("funding UTXO has no address")?.to_string();
    let inputs = json!([{ "txid": utxo["txid"], "vout": utxo["vout"] }]);

    // Build the outputs: change + optional treasury-fee payment + the data record.
    let outputs = |data_key: String, data_val: Value| -> serde_json::Map<String, Value> {
        let mut outs = serde_json::Map::new();
        let mut change_amt = change;
        if let Some((addr, fee)) = fee_output {
            let fee = (fee * 1e8).round() / 1e8; // round to duffs or createrawtransaction rejects
            if addr == change_addr {
                change_amt = ((change + fee) * 1e8).round() / 1e8; // same address -> merge
            } else {
                outs.insert(addr.to_string(), json!(fee));
            }
        }
        outs.insert(change_addr.clone(), json!(change_amt));
        outs.insert(data_key, data_val);
        outs
    };
    let raw = match rpc.call("createrawtransaction", json!([inputs, Value::Object(outputs("data".into(), json!(record_hex)))])) {
        Ok(v) => v,
        Err(_) => {
            let script = nfd_record::op_meta_script(record_hex);
            rpc.call("createrawtransaction", json!([inputs, Value::Object(outputs(script, json!(0)))]))?
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

/// Result of creating a collection: the anchoring txid IS the collection id.
pub struct CollectionOutcome {
    pub txid: String,
    pub meta_ptr: String,
}

/// How to mint an item INTO a collection. The item must be funded from — and is
/// owned by — the collection's creator, so the ledger's creator-only rule accepts
/// it. `traits_json` is the public ERC-721 attributes metadata.
pub struct CollectionMint<'a> {
    pub creator_addr: &'a str,
    pub collection_id: &'a str,
    pub traits_json: &'a [u8],
}

/// Create a collection (creator-only, optionally capped). The collection id is
/// the returned txid; the creator is `creator_addr` and MUST be the same address
/// that later mints items into it. `cover` is an optional public banner image.
pub fn create_collection(
    cfg: &NodeConfig,
    creator_addr: &str,
    name: &str,
    description: &str,
    cover: Option<(&[u8], &str)>,
    max_supply: u32,
) -> Result<CollectionOutcome, String> {
    let rpc = RpcClient::new(cfg);
    // A spendable UTXO on the creator address funds (and thereby authors) it.
    let utxo = pick_owner_utxo(&rpc, creator_addr)?;
    let storage = nfd_storage::for_node(&cfg.datadir);
    // Optional public cover -> a resolvable gateway URL inside the metadata JSON.
    let image = match cover {
        Some((bytes, ct)) => nfd_storage::gateway_url(&storage.put_public(bytes, ct)?).ok(),
        None => None,
    };
    let meta = json!({ "name": name, "description": description, "image": image });
    let meta_ptr = storage.put_public(meta.to_string().as_bytes(), "application/json")?;
    let record = nfd_record::encode_collection_create(max_supply, &meta_ptr)?;
    let txid = anchor_record(&rpc, &utxo, &record, None)?;
    Ok(CollectionOutcome { txid, meta_ptr })
}

/// Mint a collectible from `plaintext`. Owner = the funding UTXO's address.
/// `thumbnail` is an optional (bytes, content_type) public preview the creator
/// chose to publish — stored UNENCRYPTED on Arweave, its id anchored in the record.
/// `collection` mints the item into a collection (public traits + membership).
pub fn mint(
    cfg: &NodeConfig,
    plaintext: &[u8],
    thumbnail: Option<(&[u8], &str)>,
    collection: Option<CollectionMint>,
) -> Result<MintDraft, String> {
    let rpc = RpcClient::new(cfg);
    // Collection items fund from the creator (so creator-only passes); standalone
    // mints use the largest available UTXO.
    let utxo = match &collection {
        Some(cm) => pick_owner_utxo(&rpc, cm.creator_addr)?,
        None => pick_funding_utxo(&rpc)?,
    };
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
    let storage = nfd_storage::for_node(&cfg.datadir);
    let arweave_ptr = storage.put(&bundle)?;

    // Optional public preview: uploaded UNENCRYPTED with its image content type.
    // Non-fatal — the preview is optional, and the content bundle is already
    // stored, so a failed thumbnail must not abort (and orphan) the mint.
    let thumb_ptr = match thumbnail {
        Some((bytes, content_type)) => storage.put_public(bytes, content_type).ok(),
        None => None,
    };

    // Collection membership: publish the public traits JSON, anchor id + pointer.
    let traits_ptr = match &collection {
        Some(cm) => Some(storage.put_public(cm.traits_json, "application/json")?),
        None => None,
    };
    let coll_fields = match (&collection, &traits_ptr) {
        (Some(cm), Some(tp)) => Some((cm.collection_id, tp.as_str())),
        _ => None,
    };
    let record = nfd_record::encode_mint(
        &arweave_ptr,
        &content_hash,
        nfd_record::FLAG_ENCRYPTED,
        thumb_ptr.as_deref(),
        coll_fields,
    )?;
    // charge the configured NFD mint fee to the treasury (disabled until set)
    let fee = crate::fees::FeeConfig::load(cfg).nfd_mint_fee();
    let txid = anchor_record(&rpc, &utxo, &record, fee.as_ref().map(|(a, f)| (a.as_str(), *f)))?;
    Ok(MintDraft { txid, owner_addr, content_hash, arweave_ptr, thumb_ptr })
}

/// Fetch, decrypt, and AUTHENTICATE a collectible you own. Errors unless the
/// decrypted content hashes to the on-chain `content_hash`.
pub fn view(cfg: &NodeConfig, owner_addr: &str, arweave_ptr: &str, content_hash: &str) -> Result<Vec<u8>, String> {
    let bundle = nfd_storage::for_node(&cfg.datadir).get(arweave_ptr)?;
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

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn pubkey_from_hex(h: &str) -> Result<PublicKey, String> {
    let h = h.trim();
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("recipient key must be 32 bytes hex".into());
    }
    let mut b = [0u8; 32];
    for (i, byte) in b.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).map_err(|_| "bad key hex".to_string())?;
    }
    Ok(PublicKey::from(b))
}

/// Validate a recipient address and return its PACKED 21-byte form as hex
/// (kind byte + 20-byte hash160) — the shared address encoding used across the
/// overlay protocols. v1 accepts standard P2PKH recipients only.
fn address_to_packed(rpc: &RpcClient, addr: &str) -> Result<String, String> {
    let v = rpc.call("validateaddress", json!([addr]))?;
    if !v["isvalid"].as_bool().unwrap_or(false) {
        return Err("recipient address is not valid".into());
    }
    let spk = v["scriptPubKey"].as_str().ok_or("could not read the recipient's script")?;
    // P2PKH scriptPubKey is exactly 76 a9 14 <20-byte hash> 88 ac (50 hex chars).
    if spk.len() == 50 && spk.starts_with("76a914") && spk.ends_with("88ac") {
        Ok(format!("00{}", &spk[6..46]).to_lowercase()) // kind 0x00 = P2PKH
    } else {
        Err("recipient must be a standard (P2PKH) address".into())
    }
}

/// Largest spendable UTXO belonging to `owner_addr` — spending it is how a
/// transfer proves the sender is the current owner.
fn pick_owner_utxo(rpc: &RpcClient, owner_addr: &str) -> Result<Value, String> {
    let unspent = rpc.call("listunspent", json!([]))?;
    unspent
        .as_array()
        .and_then(|a| {
            a.iter()
                .filter(|u| u["address"].as_str() == Some(owner_addr) && u["amount"].as_f64().unwrap_or(0.0) >= FEE)
                .max_by(|x, y| {
                    let ax = x["amount"].as_f64().unwrap_or(0.0);
                    let ay = y["amount"].as_f64().unwrap_or(0.0);
                    ax.partial_cmp(&ay).unwrap_or(std::cmp::Ordering::Equal)
                })
        })
        .cloned()
        .ok_or_else(|| format!("The owner address {owner_addr} has no spendable DIVI — top it up to transfer."))
}

/// A recipient shares this so a sender can transfer to them: their address plus
/// the encryption pubkey derived from it. (Until the indexer can look this up
/// on-chain, it's exchanged directly.)
pub struct ReceiveCode {
    pub address: String,
    pub enc_pubkey: String,
}

/// Produce my receive code for `my_addr`.
pub fn receive_code(cfg: &NodeConfig, my_addr: &str) -> Result<ReceiveCode, String> {
    let rpc = RpcClient::new(cfg);
    let (_sk, pk) = owner_keypair(&rpc, my_addr)?;
    Ok(ReceiveCode { address: my_addr.to_string(), enc_pubkey: to_hex(pk.as_bytes()) })
}

/// Result of a transfer: the anchoring txid + the pointer to the re-wrapped key.
pub struct TransferOutcome {
    pub txid: String,
    pub wrapkey_ptr: String,
}

/// Transfer an NFD you own to a recipient (their address + encryption pubkey).
/// Re-wraps the content key to them, publishes it, and anchors a TRANSFER record
/// funded from your owner address (which authorizes it in the ledger).
pub fn transfer(
    cfg: &NodeConfig,
    owner_addr: &str,
    mint_txid: &str,
    recipient_addr: &str,
    recipient_enc_pubkey: &str,
) -> Result<TransferOutcome, String> {
    let rpc = RpcClient::new(cfg);
    let recipient_pub = pubkey_from_hex(recipient_enc_pubkey)?;
    let recipient_packed = address_to_packed(&rpc, recipient_addr)?;

    // The bundle pointer comes from the on-chain mint record (authoritative).
    let arweave_ptr = match read_record(cfg, mint_txid)? {
        Some(nfd_record::NfdRecord::Mint { arweave_ptr, .. }) => arweave_ptr,
        _ => return Err("no NFD mint record was found for that transaction".into()),
    };
    // Re-wrap the content key from the bundle's current wrapping to the recipient.
    let storage = nfd_storage::for_node(&cfg.datadir);
    let bundle = storage.get(&arweave_ptr)?;
    let (_content_blob, wrapped_ck) = unpack_bundle(&bundle)?;
    let (my_sk, _my_pk) = owner_keypair(&rpc, owner_addr)?;
    let new_wrapped = crypto_nfd::rewrap(&wrapped_ck, &my_sk, &recipient_pub)?;
    let wrapkey_ptr = storage.put(&new_wrapped)?; // opaque (it's already ciphertext)

    let record = nfd_record::encode_transfer(mint_txid, &recipient_packed, &wrapkey_ptr)?;
    let utxo = pick_owner_utxo(&rpc, owner_addr)?;
    let txid = anchor_record(&rpc, &utxo, &record, None)?; // transfers charge no treasury fee
    Ok(TransferOutcome { txid, wrapkey_ptr })
}

/// Claim (fetch + decrypt + authenticate) a collectible transferred to you.
/// The `arweave_ptr` and `content_hash` are taken from the ON-CHAIN mint record
/// (looked up by `mint_txid`), never from the sender's claim code — so a sender
/// can't hand a code pointing at different content than the record proves.
/// Uses the re-wrapped key at `wrapkey_ptr`, not the bundle's original wrapping.
pub fn claim(
    cfg: &NodeConfig,
    my_addr: &str,
    mint_txid: &str,
    wrapkey_ptr: &str,
) -> Result<Vec<u8>, String> {
    let (arweave_ptr, content_hash) = match read_record(cfg, mint_txid)? {
        Some(nfd_record::NfdRecord::Mint { arweave_ptr, content_hash, .. }) => (arweave_ptr, content_hash),
        _ => return Err("no NFD mint record was found for that transaction".into()),
    };
    let storage = nfd_storage::for_node(&cfg.datadir);
    let bundle = storage.get(&arweave_ptr)?;
    let (content_blob, _old_wrapped) = unpack_bundle(&bundle)?;
    let new_wrapped = storage.get(wrapkey_ptr)?;
    let rpc = RpcClient::new(cfg);
    let (sk, _pk) = owner_keypair(&rpc, my_addr)?;
    let salted = crypto_nfd::decrypt_content(&content_blob, &new_wrapped, &sk)?;
    if sha256_hex(&salted) != content_hash.to_lowercase() {
        return Err("content does not match the on-chain mint record — not authentic".into());
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
