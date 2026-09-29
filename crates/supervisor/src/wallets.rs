//! Parallel wallets: extra wallets beside the node's own staking wallet.
//! docs/PARALLEL-WALLETS-PLAN.md, Phase 0.
//!
//! Each extra wallet has its OWN twelve words, made here, shown once for
//! backup, and restorable in any Divi wallet: keys follow the standard path
//! `m/44'/301'/0'/0/i` (BIP 39 + BIP 32), exactly as the node derives its
//! own. The node never holds these keys: it signs with a key handed to it
//! for one call (`signrawtransaction` with private keys) and forgets it.
//! Balances come from the address index, which knows every address.
//!
//! What is stored, in `wallets.json` under the app's data folder: the seed
//! ENCRYPTED (AES-256-GCM), labels, the next address index, and flags. The
//! encryption key is, by default, a random key kept in the operating
//! system's keychain (nothing extra to remember); a wallet may instead be
//! locked with its own password, from which the key is derived (PBKDF2, the
//! same routine the seed phrase uses).
//!
//! Nothing here logs a seed or a key.

use crate::base58;
use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use crate::seedphrase;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256, Sha512};
use std::path::PathBuf;

pub const MAX_WALLETS_PER_NODE: usize = 20;

/// Is the node on a test network? Decides address and key prefixes, so it
/// is asked of the node, never assumed.
pub fn is_testnet(cfg: &NodeConfig) -> bool {
    RpcClient::new(cfg)
        .call("getblockchaininfo", json!([]))
        .ok()
        .and_then(|v| v["chain"].as_str().map(|s| s != "main"))
        .unwrap_or(false)
}
/// BIP 44 coin type for DIVI mainnet; test networks use 1.
const COIN_TYPE_MAIN: u32 = 301;
const COIN_TYPE_TEST: u32 = 1;
const HARDENED: u32 = 0x8000_0000;
const WIF_MAIN: u8 = 212;
const WIF_TEST: u8 = 239;
const KR_SERVICE: &str = "io.diviproject.desktop69.wallets";
const KR_ACCOUNT: &str = "store-key";
const PBKDF2_ROUNDS: u32 = 200_000;

// ── BIP 32 ────────────────────────────────────────────────────────────────

fn hmac_sha512(key: &[u8], msg: &[u8]) -> [u8; 64] {
    const BLOCK: usize = 128;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..64].copy_from_slice(&Sha512::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let inner = Sha512::new().chain_update(ipad).chain_update(msg).finalize();
    let outer = Sha512::new().chain_update(opad).chain_update(inner).finalize();
    let mut out = [0u8; 64];
    out.copy_from_slice(&outer);
    out
}

#[derive(Clone)]
struct ExtKey {
    key: SecretKey,
    chain: [u8; 32],
}

impl ExtKey {
    fn master(seed: &[u8]) -> Result<ExtKey, String> {
        let i = hmac_sha512(b"Bitcoin seed", seed);
        let key = SecretKey::from_slice(&i[..32]).map_err(|_| "bad master key")?;
        let mut chain = [0u8; 32];
        chain.copy_from_slice(&i[32..]);
        Ok(ExtKey { key, chain })
    }
    fn child(&self, index: u32) -> Result<ExtKey, String> {
        let secp = Secp256k1::new();
        let mut data = Vec::with_capacity(37);
        if index & HARDENED != 0 {
            data.push(0);
            data.extend_from_slice(&self.key.secret_bytes());
        } else {
            data.extend_from_slice(&PublicKey::from_secret_key(&secp, &self.key).serialize());
        }
        data.extend_from_slice(&index.to_be_bytes());
        let i = hmac_sha512(&self.chain, &data);
        let tweak = secp256k1::Scalar::from_be_bytes(i[..32].try_into().unwrap()).map_err(|_| "bad child")?;
        let key = self.key.add_tweak(&tweak).map_err(|_| "bad child key")?;
        let mut chain = [0u8; 32];
        chain.copy_from_slice(&i[32..]);
        Ok(ExtKey { key, chain })
    }
}

/// The private key for address `index` of a wallet whose seed is `seed`
/// (the 64 bytes BIP 39 makes from the words), on main or test network.
pub fn derive(seed: &[u8], index: u32, testnet: bool) -> Result<SecretKey, String> {
    let coin = if testnet { COIN_TYPE_TEST } else { COIN_TYPE_MAIN };
    let k = ExtKey::master(seed)?
        .child(44 | HARDENED)?
        .child(coin | HARDENED)?
        .child(HARDENED)? // account 0
        .child(0)? // external
        .child(index)?;
    Ok(k.key)
}

fn hash160(data: &[u8]) -> [u8; 20] {
    use ripemd::Ripemd160;
    let sha = Sha256::digest(data);
    let r = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&r);
    out
}

/// The P2PKH address of a key.
pub fn address_of(key: &SecretKey, testnet: bool) -> String {
    let secp = Secp256k1::new();
    let pub_ = PublicKey::from_secret_key(&secp, key).serialize();
    base58::payload_to_address(base58::KIND_P2PKH, &hash160(&pub_), testnet)
}

/// The key in the text form the node's `signrawtransaction` accepts (WIF,
/// compressed). Handed to the node for one call; never stored.
pub(crate) fn wif(key: &SecretKey, testnet: bool) -> String {
    let mut payload = key.secret_bytes().to_vec();
    payload.push(1); // compressed
    base58::encode_check(if testnet { WIF_TEST } else { WIF_MAIN }, &payload)
}

// ── words ─────────────────────────────────────────────────────────────────

fn new_entropy() -> [u8; 16] {
    let mut entropy = [0u8; 16];
    getrandom::getrandom(&mut entropy).expect("no source of randomness");
    entropy
}

/// Twelve fresh words (128 bits of entropy plus the BIP 39 checksum).
pub fn new_words() -> Vec<String> {
    words_from_entropy(&new_entropy())
}

/// The entropy behind a valid phrase of 12 words (16 bytes) or 24 words
/// (32 bytes); the checksum is verified by `seedphrase::check` before this
/// is called. New wallets are always 12; 24 is accepted so a phrase from an
/// older wallet can be brought in.
fn entropy_from_words(words: &[String]) -> Option<Vec<u8>> {
    let bytes = match words.len() { 12 => 16, 24 => 32, _ => return None };
    let mut bits: Vec<u8> = Vec::with_capacity(words.len() * 11);
    for w in words {
        let i = crate::bip39_words::WORDS.binary_search(&w.as_str()).ok()?;
        for b in (0..11).rev() { bits.push(((i >> b) & 1) as u8); }
    }
    let mut e = vec![0u8; bytes];
    for (i, bit) in bits.iter().take(bytes * 8).enumerate() { e[i / 8] |= bit << (7 - (i % 8)); }
    Some(e)
}

/// 16 bytes of entropy make 12 words, 32 make 24 (BIP 39).
fn words_from_entropy(entropy: &[u8]) -> Vec<String> {
    let hash = Sha256::digest(entropy);
    let checksum_bits = entropy.len() / 4;
    let mut bits: Vec<u8> = Vec::with_capacity(entropy.len() * 8 + checksum_bits);
    for b in entropy {
        for i in (0..8).rev() {
            bits.push((b >> i) & 1);
        }
    }
    for i in (8 - checksum_bits..8).rev() {
        bits.push((hash[0] >> i) & 1);
    }
    (0..bits.len() / 11)
        .map(|w| {
            let mut idx = 0usize;
            for b in &bits[w * 11..w * 11 + 11] {
                idx = (idx << 1) | (*b as usize);
            }
            crate::bip39_words::WORDS[idx].to_string()
        })
        .collect()
}

// ── the store ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AddressEntry {
    pub index: u32,
    pub address: String,
    pub label: String,
    /// Vault staking wanted for this address (docs, Phase 2).
    pub vault: bool,
    /// Funding transactions for this address's vault that the node has not
    /// yet been told to stake: `addvault` needs the funding confirmed, so
    /// they wait here until wallet_vaults::settle registers them.
    #[serde(default)]
    pub vault_pending: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WalletEntry {
    pub id: String,
    pub label: String,
    pub created: i64,
    /// AES-256-GCM: 12-byte nonce then ciphertext of the 16 bytes of entropy
    /// the words are made from (the words, and so the keys, come back from it).
    pub seed_enc: String,
    /// "keychain" or "password"; with "password", `salt` is set.
    pub lock: String,
    pub salt: String,
    pub next_index: u32,
    pub addresses: Vec<AddressEntry>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Store {
    pub wallets: Vec<WalletEntry>,
}

fn store_path(node_id: &str) -> PathBuf {
    crate::config::dd69_datadir().join(format!("wallets-{node_id}.json"))
}

pub fn load(node_id: &str) -> Store {
    std::fs::read_to_string(store_path(node_id))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub(crate) fn save(node_id: &str, store: &Store) -> Result<(), String> {
    let p = store_path(node_id);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    // Write beside, then rename: the file holds every sealed seed, so a crash
    // or full disk mid-write must leave the old copy, never a truncated one.
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).map_err(|e| format!("cannot replace {}: {e}", p.display()))?;
    Ok(())
}

/// The default store key: random, made once, kept in the OS keychain.
fn keychain_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KR_SERVICE, KR_ACCOUNT).map_err(|e| e.to_string())?;
    if let Ok(hex) = entry.get_password() {
        if let Some(k) = hex_to_32(&hex) {
            return Ok(k);
        }
    }
    let mut k = [0u8; 32];
    getrandom::getrandom(&mut k).map_err(|e| e.to_string())?;
    entry
        .set_password(&k.iter().map(|b| format!("{b:02x}")).collect::<String>())
        .map_err(|e| format!("the keychain refused to keep the wallet key: {e}"))?;
    Ok(k)
}

fn hex_to_32(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn password_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let bytes = seedphrase::pbkdf2_sha512(password.as_bytes(), salt, PBKDF2_ROUNDS, 32);
    let mut k = [0u8; 32];
    k.copy_from_slice(&bytes);
    k
}

fn seal(key: &[u8; 32], plain: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
    let ct = cipher.encrypt(Nonce::from_slice(&nonce), plain).map_err(|_| "could not encrypt")?;
    let mut all = nonce.to_vec();
    all.extend_from_slice(&ct);
    Ok(base64_encode(&all))
}

fn open(key: &[u8; 32], sealed: &str) -> Result<Vec<u8>, String> {
    let all = base64_decode(sealed).ok_or("stored wallet is unreadable")?;
    if all.len() < 13 {
        return Err("stored wallet is unreadable".into());
    }
    let cipher = Aes256Gcm::new(key.into());
    cipher
        .decrypt(Nonce::from_slice(&all[..12]), &all[12..])
        .map_err(|_| "wrong password, or the stored wallet is damaged".to_string())
}

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// What the interface gets back when a wallet is made: the words, shown
/// ONCE, and the wallet as stored.
pub struct Created {
    pub words: Vec<String>,
    pub wallet: WalletEntry,
}

/// Make a new wallet for `node_id`, with `label`, locked either with the
/// keychain key or with `password`. Its first address is made at once.
pub fn create(node_id: &str, label: &str, password: Option<&str>, testnet: bool) -> Result<Created, String> {
    let mut store = load(node_id);
    if store.wallets.len() >= MAX_WALLETS_PER_NODE {
        return Err(format!("A node can have at most {MAX_WALLETS_PER_NODE} wallets."));
    }
    let entropy = new_entropy();
    let words = words_from_entropy(&entropy);
    let seed = seedphrase::to_seed_bytes(&words, "");
    let (lock, salt, key) = match password {
        Some(p) if !p.is_empty() => {
            let mut s = [0u8; 16];
            getrandom::getrandom(&mut s).map_err(|e| e.to_string())?;
            ("password".to_string(), base64_encode(&s), password_key(p, &s))
        }
        _ => ("keychain".to_string(), String::new(), keychain_key()?),
    };
    let seed_enc = seal(&key, &entropy)?;
    let first = derive(&seed, 0, testnet)?;
    let id = format!("w{}", now());
    let wallet = WalletEntry {
        id: id.clone(),
        label: if label.trim().is_empty() { "New wallet".into() } else { label.trim().to_string() },
        created: now(),
        seed_enc,
        lock,
        salt,
        next_index: 1,
        addresses: vec![AddressEntry { index: 0, address: address_of(&first, testnet), label: String::new(), vault: true, vault_pending: Vec::new() }],
    };
    store.wallets.push(wallet.clone());
    save(node_id, &store)?;
    Ok(Created { words, wallet })
}

/// Restore a wallet from its words (any shape, checked), locked as `create`.
pub fn restore(node_id: &str, label: &str, phrase: &str, password: Option<&str>, testnet: bool) -> Result<WalletEntry, String> {
    let words = seedphrase::normalize(phrase);
    seedphrase::check(&words)?;
    let mut store = load(node_id);
    if store.wallets.len() >= MAX_WALLETS_PER_NODE {
        return Err(format!("A node can have at most {MAX_WALLETS_PER_NODE} wallets."));
    }
    let entropy = entropy_from_words(&words).ok_or("a wallet here needs a 12- or 24-word phrase")?;
    let seed = seedphrase::to_seed_bytes(&words, "");
    let first = derive(&seed, 0, testnet)?;
    let first_addr = address_of(&first, testnet);
    if store.wallets.iter().any(|w| w.addresses.first().map(|a| a.address.as_str()) == Some(first_addr.as_str())) {
        return Err("That wallet is already here.".into());
    }
    let (lock, salt, key) = match password {
        Some(p) if !p.is_empty() => {
            let mut s = [0u8; 16];
            getrandom::getrandom(&mut s).map_err(|e| e.to_string())?;
            ("password".to_string(), base64_encode(&s), password_key(p, &s))
        }
        _ => ("keychain".to_string(), String::new(), keychain_key()?),
    };
    let wallet = WalletEntry {
        id: format!("w{}", now()),
        label: if label.trim().is_empty() { "Restored wallet".into() } else { label.trim().to_string() },
        created: now(),
        seed_enc: seal(&key, &entropy)?,
        lock,
        salt,
        next_index: 1,
        addresses: vec![AddressEntry { index: 0, address: first_addr, label: String::new(), vault: true, vault_pending: Vec::new() }],
    };
    store.wallets.push(wallet.clone());
    save(node_id, &store)?;
    Ok(wallet)
}

/// The words of a wallet, unlocked with the keychain or with `password`.
fn unlock_words(w: &WalletEntry, password: Option<&str>) -> Result<Vec<String>, String> {
    let key = if w.lock == "password" {
        let p = password.ok_or("This wallet has its own password.")?;
        let salt = base64_decode(&w.salt).ok_or("stored wallet is unreadable")?;
        password_key(p, &salt)
    } else {
        keychain_key()?
    };
    let entropy = open(&key, &w.seed_enc)?;
    if entropy.len() != 16 && entropy.len() != 32 {
        return Err("stored wallet is unreadable".into());
    }
    Ok(words_from_entropy(&entropy))
}

/// The seed of a wallet (64 bytes), unlocked the same way.
pub(crate) fn unlock_seed(w: &WalletEntry, password: Option<&str>) -> Result<Vec<u8>, String> {
    Ok(seedphrase::to_seed_bytes(&unlock_words(w, password)?, ""))
}

/// Make the next address for a wallet.
pub fn new_address(node_id: &str, wallet_id: &str, label: &str, password: Option<&str>, testnet: bool) -> Result<AddressEntry, String> {
    let mut store = load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let seed = unlock_seed(w, password)?;
    let key = derive(&seed, w.next_index, testnet)?;
    let entry = AddressEntry { index: w.next_index, address: address_of(&key, testnet), label: label.trim().to_string(), vault: true, vault_pending: Vec::new() };
    w.next_index += 1;
    w.addresses.push(entry.clone());
    save(node_id, &store)?;
    Ok(entry)
}

/// Rename a wallet, or one of its addresses, or set an address's vault flag.
pub fn set_label(node_id: &str, wallet_id: &str, address: Option<&str>, label: &str) -> Result<(), String> {
    let mut store = load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    match address {
        None => w.label = label.trim().to_string(),
        Some(a) => {
            let e = w.addresses.iter_mut().find(|e| e.address == a).ok_or("no such address")?;
            e.label = label.trim().to_string();
        }
    }
    save(node_id, &store)
}

pub fn set_vault(node_id: &str, wallet_id: &str, address: &str, on: bool) -> Result<(), String> {
    let mut store = load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let e = w.addresses.iter_mut().find(|e| e.address == address).ok_or("no such address")?;
    e.vault = on;
    save(node_id, &store)
}

/// The words of a wallet, for the owner's own backup. Unlocks first.
pub fn words_of(node_id: &str, wallet_id: &str, password: Option<&str>) -> Result<Vec<String>, String> {
    let store = load(node_id);
    let w = store.wallets.iter().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    unlock_words(w, password)
}

/// Forget a wallet (its record only; the coins stay on the chain and the
/// words restore it). Refuses while it holds coins unless `force`.
pub fn remove(node_id: &str, wallet_id: &str, cfg: &NodeConfig, force: bool) -> Result<(), String> {
    let mut store = load(node_id);
    let idx = store.wallets.iter().position(|w| w.id == wallet_id).ok_or("no such wallet")?;
    if !force {
        let w = &store.wallets[idx];
        let plain = balance(cfg, w).map(|b| b.divi).unwrap_or(0.0);
        let vaulted: f64 = crate::wallet_vaults::balances(cfg, w).map(|v| v.iter().map(|x| x.1).sum()).unwrap_or(0.0);
        if plain + vaulted > 0.0 {
            return Err(format!("This wallet still holds {} DIVI{}. Move them out first, or remove anyway.", plain + vaulted, if vaulted > 0.0 { " (some of it staking in a vault)" } else { "" }));
        }
    }
    store.wallets.remove(idx);
    save(node_id, &store)
}

/// After a restore only address 0 is known. Look ahead along the chain for
/// addresses this seed used before (gap of 20, as other wallets do) and add
/// them, so coins at later addresses are not invisible.
pub fn discover(cfg: &NodeConfig, node_id: &str, wallet_id: &str, password: Option<&str>, testnet: bool) -> Result<usize, String> {
    let mut store = load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let seed = unlock_seed(w, password)?;
    let rpc = RpcClient::new(cfg);
    let mut added = 0;
    let mut gap = 0;
    let mut i = w.next_index;
    while gap < 20 && i < w.next_index + 200 {
        let key = derive(&seed, i, testnet)?;
        let addr = address_of(&key, testnet);
        let used = rpc
            .call("getaddresstxids", json!([{ "addresses": [addr.clone()] }]))
            .ok()
            .and_then(|v| v.as_array().map(|a| !a.is_empty()))
            .unwrap_or(false)
            || rpc
                .call("getaddresstxids", json!([{ "addresses": [addr.clone()] }, true]))
                .ok()
                .and_then(|v| v.as_array().map(|a| !a.is_empty()))
                .unwrap_or(false);
        if used {
            for j in w.next_index..=i {
                let k = derive(&seed, j, testnet)?;
                w.addresses.push(AddressEntry { index: j, address: address_of(&k, testnet), label: String::new(), vault: true, vault_pending: Vec::new() });
                added += 1;
            }
            w.next_index = i + 1;
            gap = 0;
        } else {
            gap += 1;
        }
        i += 1;
    }
    if added > 0 {
        save(node_id, &store)?;
    }
    Ok(added)
}

// ── balances ───────────────────────────────────────────────────────────────

pub struct Balance {
    pub divi: f64,
    pub by_address: Vec<(String, f64)>,
}

/// Confirmed balance of a wallet, address by address, from the address index.
pub fn balance(cfg: &NodeConfig, w: &WalletEntry) -> Result<Balance, String> {
    let rpc = RpcClient::new(cfg);
    let mut by_address = Vec::new();
    let mut total = 0.0;
    for a in &w.addresses {
        let v = rpc.call("getaddressbalance", json!([{ "addresses": [a.address] }]))?;
        let sat = v["balance"].as_i64().or_else(|| v["balance"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0);
        let divi = sat as f64 / 100_000_000.0;
        total += divi;
        by_address.push((a.address.clone(), divi));
    }
    Ok(Balance { divi: total, by_address })
}

// ── sending ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub(crate) struct Utxo {
    pub(crate) address: String,
    pub(crate) txid: String,
    #[serde(rename = "outputIndex")]
    pub(crate) output_index: u32,
    pub(crate) satoshis: i64,
    pub(crate) script: String,
}

/// Send `amount` DIVI from a wallet to `to`. Coins are gathered across the
/// wallet's addresses, change returns to the wallet's first address, the
/// node signs with keys handed over for this one call, and broadcasts.
pub fn send(cfg: &NodeConfig, node_id: &str, wallet_id: &str, to: &str, amount: f64, password: Option<&str>, testnet: bool) -> Result<String, String> {
    if !(amount > 0.0) || !amount.is_finite() {
        return Err("Enter an amount.".into());
    }
    let store = load(node_id);
    let w = store.wallets.iter().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let seed = unlock_seed(w, password)?;
    let rpc = RpcClient::new(cfg);
    rpc.call("validateaddress", json!([to])).ok().and_then(|v| v["isvalid"].as_bool()).filter(|b| *b).ok_or("That is not a Divi address.")?;

    let addrs: Vec<String> = w.addresses.iter().map(|a| a.address.clone()).collect();
    let v = rpc.call("getaddressutxos", json!([{ "addresses": addrs }]))?;
    let mut utxos: Vec<Utxo> = serde_json::from_value(v).map_err(|_| "could not read the wallet's coins")?;
    utxos.sort_by(|a, b| b.satoshis.cmp(&a.satoshis));
    // Coins staking in the wallet's vaults can be spent by the owner too, so
    // nobody has to unstake before sending. Plain coins go first; vault coins
    // only if needed, and what is left of them goes back into the vault.
    let vaddrs: Vec<String> = w.addresses.iter().map(|a| a.address.clone()).collect();
    let vv = rpc.call("getaddressutxos", json!([{ "addresses": vaddrs }, true])).unwrap_or(json!([]));
    let mut vault_utxos: Vec<Utxo> = serde_json::from_value(vv).unwrap_or_default();
    vault_utxos.retain(|u| u.script.len() == 100 && u.script.starts_with("6314"));
    vault_utxos.sort_by(|a, b| b.satoshis.cmp(&a.satoshis));
    let plain_total: i64 = utxos.iter().map(|u| u.satoshis).sum();
    let vault_total: i64 = vault_utxos.iter().map(|u| u.satoshis).sum();
    utxos.extend(vault_utxos);

    // Select, largest first, until amount + fee is covered.
    let mut inputs: Vec<&Utxo> = Vec::new();
    let mut have: i64 = 0;
    let want_sat = (amount * 100_000_000.0).round() as i64;
    let mut fee_sat: i64 = 0;
    for u in &utxos {
        inputs.push(u);
        have += u.satoshis;
        fee_sat = (crate::dvxp::size_fee(inputs.len(), 2, 0, crate::dvxp::MIN_FEE_DIVI) * 100_000_000.0).round() as i64;
        if have >= want_sat + fee_sat {
            break;
        }
    }
    if have < want_sat + fee_sat {
        return Err(format!("Not enough in this wallet: {} DIVI available ({} of it staking).", (plain_total + vault_total) as f64 / 100_000_000.0, vault_total as f64 / 100_000_000.0));
    }
    let change_sat = have - want_sat - fee_sat;
    // Change goes back where the last-added coin came from: into the vault
    // if a vault coin was needed (so the remainder keeps staking), else to
    // the wallet's first address.
    let vault_change = inputs.last().filter(|u| u.script.starts_with("6314")).map(|u| u.script.clone());
    let change_to = w.addresses[0].address.clone();

    let ins: Vec<serde_json::Value> = inputs.iter().map(|u| json!({ "txid": u.txid, "vout": u.output_index })).collect();
    let mut outs = serde_json::Map::new();
    outs.insert(to.to_string(), json!(want_sat as f64 / 100_000_000.0));
    if change_sat > 0 {
        if let Some(script) = vault_change {
            outs.insert(script, json!(change_sat as f64 / 100_000_000.0));
        } else if change_to == to {
            // createrawtransaction refuses a duplicate output address: fold in.
            outs.insert(to.to_string(), json!((want_sat + change_sat) as f64 / 100_000_000.0));
        } else {
            outs.insert(change_to.clone(), json!(change_sat as f64 / 100_000_000.0));
        }
    }
    let raw = rpc.call("createrawtransaction", json!([ins, outs]))?;
    let raw = raw.as_str().ok_or("the node did not build the transaction")?.to_string();

    // Keys for exactly the addresses spent, handed over for this call.
    let mut keys: Vec<String> = Vec::new();
    let mut prev: Vec<serde_json::Value> = Vec::new();
    for u in &inputs {
        let entry = w.addresses.iter().find(|a| a.address == u.address).ok_or("a coin belongs to no address of this wallet")?;
        let key = derive(&seed, entry.index, testnet)?;
        let k = wif(&key, testnet);
        if !keys.contains(&k) {
            keys.push(k);
        }
        prev.push(json!({ "txid": u.txid, "vout": u.output_index, "scriptPubKey": u.script }));
    }
    let signed = rpc.call("signrawtransaction", json!([raw, prev, keys]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("the transaction could not be fully signed".into());
    }
    let hex = signed["hex"].as_str().ok_or("no signed transaction")?.to_string();
    let txid = rpc.call("sendrawtransaction", json!([hex]))?;
    Ok(txid.as_str().unwrap_or("").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // BIP 32 test vector 1: seed 000102...0f, m/0H/1/2H/2/1000000000.
    #[test]
    fn bip32_vector_one() {
        let seed: Vec<u8> = (0u8..16).collect();
        let m = ExtKey::master(&seed).unwrap();
        assert_eq!(
            m.key.secret_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35"
        );
        let k = m.child(HARDENED).unwrap().child(1).unwrap().child(2 | HARDENED).unwrap().child(2).unwrap().child(1_000_000_000).unwrap();
        assert_eq!(
            k.key.secret_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "471b76e389e528d6de6d816857e012c5455051cad6660850e58372a6c3e6e7c8"
        );
    }

    // BIP 39 reference: all-zero entropy is "abandon" x11 "about".
    #[test]
    fn words_from_zero_entropy_are_the_reference_phrase() {
        let w = words_from_entropy(&[0u8; 16]);
        assert_eq!(w.join(" "), "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
        let fresh = new_words();
        assert_eq!(fresh.len(), 12);
        assert!(seedphrase::check(&fresh).is_ok());
        let e = entropy_from_words(&fresh).unwrap();
        assert_eq!(words_from_entropy(&e), fresh);
        // 24 words round-trip too (32 zero bytes is the reference "abandon" x23 "art").
        let w24 = words_from_entropy(&[0u8; 32]);
        assert_eq!(w24.len(), 24);
        assert_eq!(w24.last().map(|s| s.as_str()), Some("art"));
        assert!(seedphrase::check(&w24).is_ok());
        assert_eq!(entropy_from_words(&w24).unwrap(), vec![0u8; 32]);
    }

    // A Divi address from a known key: the mainnet prefix 'D', the WIF prefix.
    #[test]
    fn address_and_wif_have_divi_prefixes() {
        let key = SecretKey::from_slice(&[7u8; 32]).unwrap();
        let a = address_of(&key, false);
        assert!(a.starts_with('D'), "{a}");
        let w = wif(&key, false);
        let (v, payload) = base58::decode_check(&w).unwrap();
        assert_eq!(v, WIF_MAIN);
        assert_eq!(payload.len(), 33);
        assert_eq!(payload[32], 1);
    }

    #[test]
    fn sealed_seed_opens_with_the_same_key_and_not_another() {
        let k = [3u8; 32];
        let s = seal(&k, b"secret").unwrap();
        assert_eq!(open(&k, &s).unwrap(), b"secret");
        assert!(open(&[4u8; 32], &s).is_err());
    }
}
