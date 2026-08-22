//! Market Maker — secure exchange-credential storage and connection checks.
//!
//! Slice 2A of the Market Maker feature. The user's *trade-only* exchange API
//! keys are kept in the OS keychain (the same `keyring` crate the wallet already
//! uses for "remember password"), one entry per exchange slug. The secret never
//! leaves this backend: the UI can ask us to save keys or to verify them, but it
//! only ever receives balances back — never the key itself.
//!
//! Bitrue uses Binance-style HMAC-SHA256 request signing. We do that with the
//! `sha2` crate already in the tree (HMAC and hex are hand-rolled below), so this
//! module adds no new dependency and no new supply-chain surface.

use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MM_SERVICE: &str = "DiviDesktop69-MarketMaker";

// Some exchanges (NonKYC) sit behind Cloudflare, which blocks non-browser agents
// with a 1010 error, so requests carry a browser-like User-Agent.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- credential storage (OS keychain, one entry per exchange slug) ----

struct Creds {
    key: String,
    secret: String,
    passphrase: String,
}

/// Save the trade-only API credentials for one exchange into the OS keychain.
/// Stored as a small JSON blob so we can add a passphrase (some exchanges need
/// one) without changing the storage shape.
pub fn save(slug: &str, key: &str, secret: &str, passphrase: &str) -> Result<(), String> {
    if key.trim().is_empty() || secret.trim().is_empty() {
        return Err("API key and secret are both required.".to_string());
    }
    let blob = serde_json::json!({
        "key": key.trim(),
        "secret": secret.trim(),
        "passphrase": passphrase.trim(),
    })
    .to_string();
    keyring::Entry::new(MM_SERVICE, slug)
        .and_then(|e| e.set_password(&blob))
        .map_err(|e| e.to_string())
}

fn load(slug: &str) -> Option<Creds> {
    let blob = keyring::Entry::new(MM_SERVICE, slug).ok()?.get_password().ok()?;
    let v: serde_json::Value = serde_json::from_str(&blob).ok()?;
    Some(Creds {
        key: v.get("key")?.as_str()?.to_string(),
        secret: v.get("secret")?.as_str()?.to_string(),
        passphrase: v.get("passphrase").and_then(|x| x.as_str()).unwrap_or("").to_string(),
    })
}

/// Whether keys are stored for this exchange (used to show connected state).
pub fn has(slug: &str) -> bool {
    load(slug).is_some()
}

/// Remove the stored keys for one exchange. Succeeds even if none were stored.
pub fn clear(slug: &str) -> Result<(), String> {
    let e = keyring::Entry::new(MM_SERVICE, slug).map_err(|e| e.to_string())?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---- HMAC-SHA256 + hex, using sha2 already in the tree (no new crate) ----

fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    // Standard HMAC (RFC 2104) over SHA-256's 64-byte block size.
    let mut block = [0u8; 64];
    if key.len() > 64 {
        let mut h = Sha256::new();
        h.update(key);
        block[..32].copy_from_slice(&h.finalize());
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= block[i];
        opad[i] ^= block[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_digest);

    let mut out = [0u8; 32];
    out.copy_from_slice(&outer.finalize());
    out
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// Exchanges return numeric fields as either JSON numbers or strings; accept both.
fn num(v: &serde_json::Value) -> Option<f64> {
    if let Some(f) = v.as_f64() {
        return Some(f);
    }
    v.as_str().and_then(|s| s.parse().ok())
}

// ---- connection test: prove the keys work by reading balances ----

/// One asset's balance on the exchange. Plain type (no serde) — `main.rs` maps it
/// to its own serializable DTO for the UI, mirroring the wallet's Balance pattern.
pub struct BalanceRow {
    pub asset: String,
    pub free: f64,
    pub locked: f64,
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

// Bitrue (Binance-style): signed GET /api/v1/account. The query string is signed
// with HMAC-SHA256 (secret as key); the API key rides in the X-MBX-APIKEY header.
fn bitrue_balances(rest_url: &str, c: &Creds) -> Result<Vec<BalanceRow>, String> {
    let query = format!("recvWindow=5000&timestamp={}", now_ms());
    let sig = hex(&hmac_sha256(c.secret.as_bytes(), query.as_bytes()));
    let url = format!(
        "{}/api/v1/account?{}&signature={}",
        rest_url.trim_end_matches('/'),
        query,
        sig
    );
    let resp = ureq::get(&url)
        .set("X-MBX-APIKEY", &c.key)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => {
                let body = r.into_string().unwrap_or_default();
                format!("Exchange rejected the keys (HTTP {code}). {body}")
            }
            other => format!("Could not reach the exchange: {other}"),
        })?;
    let text = resp.into_string().map_err(|e| format!("Unreadable reply: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Bad reply: {e}"))?;
    let arr = v
        .get("balances")
        .and_then(|b| b.as_array())
        .ok_or_else(|| "The exchange reply had no balances.".to_string())?;

    let mut out = Vec::new();
    for b in arr {
        let asset = b.get("asset").and_then(|a| a.as_str()).unwrap_or("").to_uppercase();
        let free = b.get("free").and_then(num).unwrap_or(0.0);
        let locked = b.get("locked").and_then(num).unwrap_or(0.0);
        if free > 0.0 || locked > 0.0 {
            out.push(BalanceRow { asset, free, locked });
        }
    }
    Ok(out)
}

// NonKYC (HitBTC/Xeggex-style): headers X-API-KEY / X-API-NONCE / X-API-SIGN,
// where the signature is HMAC-SHA256 (hex) over apiKey + full_url + body + nonce.
// GET has an empty body. Verified live against /balances. Fields: available/held.
fn nonkyc_balances(rest_url: &str, c: &Creds) -> Result<Vec<BalanceRow>, String> {
    let url = format!("{}/balances", rest_url.trim_end_matches('/'));
    let nonce = now_ms().to_string();
    let message = format!("{}{}{}{}", c.key, url, "", nonce); // body is empty for GET
    let sign = hex(&hmac_sha256(c.secret.as_bytes(), message.as_bytes()));
    let resp = ureq::get(&url)
        .set("X-API-KEY", &c.key)
        .set("X-API-NONCE", &nonce)
        .set("X-API-SIGN", &sign)
        .set("User-Agent", UA)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => {
                let body = r.into_string().unwrap_or_default();
                format!("Exchange rejected the keys (HTTP {code}). {body}")
            }
            other => format!("Could not reach the exchange: {other}"),
        })?;
    let text = resp.into_string().map_err(|e| format!("Unreadable reply: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Bad reply: {e}"))?;
    let arr = v.as_array().ok_or_else(|| "The exchange reply wasn't a balance list.".to_string())?;

    let mut out = Vec::new();
    for b in arr {
        let asset = b.get("asset").and_then(|a| a.as_str()).unwrap_or("").to_uppercase();
        let free = b.get("available").and_then(num).unwrap_or(0.0);
        let locked = b.get("held").and_then(num).unwrap_or(0.0);
        if free > 0.0 || locked > 0.0 {
            out.push(BalanceRow { asset, free, locked });
        }
    }
    Ok(out)
}

/// Load the stored keys for `slug` and verify them by reading account balances.
/// `connector` selects the API family and `rest_url` comes from the catalog. A
/// read-only check — it never places or cancels anything.
pub fn test_connection(slug: &str, connector: &str, rest_url: &str) -> Result<Vec<BalanceRow>, String> {
    let c = load(slug).ok_or_else(|| "No keys saved for this exchange yet.".to_string())?;
    match connector {
        "binance_like" => bitrue_balances(rest_url, &c),
        "nonkyc" => nonkyc_balances(rest_url, &c),
        other => Err(format!("The \"{other}\" connector isn't wired up yet — coming next.")),
    }
}
