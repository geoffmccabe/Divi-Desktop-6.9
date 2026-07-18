//! Wallet password / encryption, over the node RPC, plus an OS-native "remember
//! password" store so staking can silently auto-resume on launch.
//!
//! The real security is the Divi core's wallet encryption — it encrypts the
//! private keys on disk. Our app has no separate password; it drives the node's
//! encryptwallet / walletpassphrase / walletlock. Staking-only unlock
//! (walletpassphrase pass 0 true) lets the wallet sign staking blocks 24/7 while
//! still refusing to send without the password.
//!
//! "Remember password" uses the OS credential store via the `keyring` crate:
//!   macOS   → Keychain
//!   Windows → Credential Manager
//!   Linux   → Secret Service (GNOME Keyring / KWallet)
//! It is opt-in: convenient (silent auto-unlock for staking) but the passphrase
//! becomes retrievable to anyone who compromises the machine.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

const KR_SERVICE: &str = "DiviDesktop69";
const KR_ACCOUNT: &str = "wallet-passphrase";

pub struct WalletStatus {
    pub encrypted: bool,
    pub unlocked: bool,
    pub staking_only: bool,
    pub status: String, // raw encryption_status: unencrypted/unlocked/locked/locked-anonymization
}

/// Current lock state, from getwalletinfo.
pub fn status(cfg: &NodeConfig) -> WalletStatus {
    let rpc = RpcClient::new(cfg);
    let w = rpc.call("getwalletinfo", json!([])).unwrap_or(json!({}));
    let status = w["encryption_status"].as_str().unwrap_or("unencrypted").to_string();
    let encrypted = status != "unencrypted";
    // "locked-anonymization" is Divi's name for staking-only unlock (can stake,
    // can't send). Treat it as unlocked-for-staking.
    let unlocked = matches!(status.as_str(), "unencrypted" | "unlocked");
    let staking_only = status == "locked-anonymization";
    WalletStatus { encrypted, unlocked, staking_only, status }
}

/// Unlock the wallet. `staking_only` = true keeps sends locked; `seconds` = 0
/// means "until locked" (used for 24/7 staking).
pub fn unlock(cfg: &NodeConfig, pass: &str, staking_only: bool, seconds: i64) -> Result<(), String> {
    RpcClient::new(cfg)
        .call("walletpassphrase", json!([pass, seconds, staking_only]))
        .map(|_| ())
}

pub fn lock(cfg: &NodeConfig) -> Result<(), String> {
    RpcClient::new(cfg).call("walletlock", json!([])).map(|_| ())
}

pub fn change_passphrase(cfg: &NodeConfig, old: &str, new: &str) -> Result<(), String> {
    RpcClient::new(cfg)
        .call("walletpassphrasechange", json!([old, new]))
        .map(|_| ())
}

/// First-time encryption. Modern Divi reloads the wallet in place (no node
/// restart) and returns a short message. The keypool is flushed, so the caller
/// should have the user confirm a fresh seed backup first.
pub fn encrypt(cfg: &NodeConfig, pass: &str) -> Result<String, String> {
    RpcClient::new(cfg)
        .call("encryptwallet", json!([pass]))
        .map(|v| v.as_str().unwrap_or("Wallet encrypted.").to_string())
}

/// The BIP39 seed words (dumphdinfo → mnemonic) for the forced backup. Requires
/// the wallet to be unlocked when it is already encrypted.
pub fn seed_words(cfg: &NodeConfig) -> Result<String, String> {
    let v = RpcClient::new(cfg).call("dumphdinfo", json!([]))?;
    v["mnemonic"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "This wallet has no recoverable seed phrase.".to_string())
}

// ---- OS credential store (opt-in "remember password") --------------------

pub fn remember(pass: &str) -> Result<(), String> {
    keyring::Entry::new(KR_SERVICE, KR_ACCOUNT)
        .and_then(|e| e.set_password(pass))
        .map_err(|e| e.to_string())
}

pub fn recall() -> Option<String> {
    keyring::Entry::new(KR_SERVICE, KR_ACCOUNT).ok()?.get_password().ok()
}

pub fn forget() -> Result<(), String> {
    let e = keyring::Entry::new(KR_SERVICE, KR_ACCOUNT).map_err(|e| e.to_string())?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a non-existent entry is a no-op success for our purposes.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
