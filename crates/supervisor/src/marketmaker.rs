//! Market Maker - secure exchange-credential storage and connection checks.
//!
//! Slice 2A of the Market Maker feature. The user's *trade-only* exchange API
//! keys are kept in the OS keychain (the same `keyring` crate the wallet already
//! uses for "remember password"), one entry per exchange slug. The secret never
//! leaves this backend: the UI can ask us to save keys or to verify them, but it
//! only ever receives balances back - never the key itself.
//!
//! Bitrue uses Binance-style HMAC-SHA256 request signing. We do that with the
//! `sha2` crate already in the tree (HMAC and hex are hand-rolled below), so this
//! module adds no new dependency and no new supply-chain surface.

use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MM_SERVICE: &str = "DiviDesktop69-MarketMaker";

// Some exchanges (NonKYC) sit behind Cloudflare, which blocks non-browser agents
// with a 1010 error, so requests carry a browser-like User-Agent.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- rest_url guard: never send API credentials anywhere but a known exchange
// host over HTTPS. `rest_url` arrives as a command argument sourced from the
// exchange catalog; even though that catalog is write-locked today, a compromised
// catalog (or any caller passing a rogue URL) must NOT be able to redirect the
// signed X-API-KEY header to an attacker. Adding an exchange = one line here.
fn allowed_hosts(connector: &str) -> &'static [&'static str] {
    match connector {
        "nonkyc" => &["api.nonkyc.io"],
        "binance_like" => &["openapi.bitrue.com"],
        _ => &[],
    }
}

fn check_rest_url(connector: &str, rest_url: &str) -> Result<(), String> {
    let rest = rest_url.trim();
    let after = rest
        .strip_prefix("https://")
        .ok_or_else(|| "For safety, the exchange URL must use https.".to_string())?;
    let host = after.split(['/', ':', '?', '#']).next().unwrap_or("");
    let allowed = allowed_hosts(connector);
    if !allowed.is_empty() && allowed.iter().any(|h| host.eq_ignore_ascii_case(h)) {
        Ok(())
    } else {
        Err(format!("Refusing to send credentials to an unrecognised host: {host}"))
    }
}

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

/// One asset's balance on the exchange. Plain type (no serde) - `main.rs` maps it
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
/// read-only check - it never places or cancels anything.
pub fn test_connection(slug: &str, connector: &str, rest_url: &str) -> Result<Vec<BalanceRow>, String> {
    check_rest_url(connector, rest_url)?;
    let c = load(slug).ok_or_else(|| "No keys saved for this exchange yet.".to_string())?;
    match connector {
        "binance_like" => bitrue_balances(rest_url, &c),
        "nonkyc" => nonkyc_balances(rest_url, &c),
        other => Err(format!("The \"{other}\" connector isn't wired up yet - coming next.")),
    }
}

// ============================================================================
// Slice 2C: the live quoting engine (NonKYC first). A background thread places a
// small ladder of non-crossing limit orders around the venue's mid, refreshes
// them each cycle, and ALWAYS cancels by id on stop (NonKYC's cancel-all is a
// no-op). This is the exact strategy proven live before being ported here.
// ============================================================================

pub struct MmConfig {
    pub slug: String,
    pub connector: String,
    pub rest_url: String,
    pub symbol: String,      // e.g. "DIVI/USDT"
    pub levels: Vec<f64>,    // ladder: % from mid, each side, per level
    pub commit_usdt: f64,    // TOTAL liquidity to commit (split ~half per side)
    pub refresh_secs: u64,
    pub protect_pct: f64,    // dump/pump guard: don't buy below / sell above this % from the session high/low
}

#[derive(Clone, Default)]
pub struct MmStatus {
    pub running: bool,
    pub message: String,
    pub mid: f64,
    pub open_orders: usize,
    pub base_free: f64,
    pub base_held: f64,
    pub quote_free: f64,
    pub quote_held: f64,
    pub cycles: u64,
}

struct Running {
    stop: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

// One engine at a time (a person runs one market). Const Mutex::new keeps this a
// plain static with no lazy-init machinery.
static ENGINE: Mutex<Option<Running>> = Mutex::new(None);
static STATUS: Mutex<Option<MmStatus>> = Mutex::new(None);

fn set_status(s: MmStatus) {
    if let Ok(mut g) = STATUS.lock() {
        *g = Some(s);
    }
}

pub fn status() -> MmStatus {
    STATUS.lock().ok().and_then(|g| (*g).clone()).unwrap_or_default()
}

// --- NonKYC signed request (generalised from the balance check) ---
fn nonkyc_call(url: &str, method: &str, body: Option<&str>, c: &Creds) -> Result<serde_json::Value, String> {
    let nonce = now_ms().to_string();
    let body_str = body.unwrap_or("");
    let msg = format!("{}{}{}{}", c.key, url, body_str, nonce);
    let sign = hex(&hmac_sha256(c.secret.as_bytes(), msg.as_bytes()));
    let req = (if method == "POST" { ureq::post(url) } else { ureq::get(url) })
        .set("X-API-KEY", &c.key)
        .set("X-API-NONCE", &nonce)
        .set("X-API-SIGN", &sign)
        .set("User-Agent", UA)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(15));
    let resp = (if method == "POST" { req.send_string(body_str) } else { req.call() }).map_err(|e| match e {
        ureq::Error::Status(code, r) => format!("HTTP {code}: {}", r.into_string().unwrap_or_default()),
        other => format!("network: {other}"),
    })?;
    let text = resp.into_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn enc_symbol(sym: &str) -> String {
    // The catalog stores pairs as "BASE-USDT"; NonKYC's REST wants "BASE/USDT",
    // URL-encoded. Accept either form.
    sym.replace('-', "/").replace('/', "%2F")
}

fn split_symbol(sym: &str) -> (String, String) {
    let s = sym.replace('-', "/");
    let mut it = s.split('/');
    (it.next().unwrap_or("").to_string(), it.next().unwrap_or("").to_string())
}

fn fmt_price(px: f64) -> String {
    format!("{px:.7}")
}

// Public best bid/ask/mid (needs the browser UA for Cloudflare).
fn nonkyc_mid(rest_url: &str, symbol: &str) -> Result<(f64, f64, f64), String> {
    let url = format!("{}/market/getbysymbol/{}", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let resp = ureq::get(&url).set("User-Agent", UA).timeout(Duration::from_secs(15)).call()
        .map_err(|e| format!("price: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let bid = v.get("bestBid").and_then(num).ok_or_else(|| "no bestBid".to_string())?;
    let ask = v.get("bestAsk").and_then(num).ok_or_else(|| "no bestAsk".to_string())?;
    Ok((bid, ask, (bid + ask) / 2.0))
}

// (quote_free, quote_held, base_free, base_held) in one balances call.
fn nonkyc_two_bals(rest_url: &str, c: &Creds, base: &str, quote: &str) -> (f64, f64, f64, f64) {
    let url = format!("{}/balances", rest_url.trim_end_matches('/'));
    let (mut qf, mut qh, mut bf, mut bh) = (0.0, 0.0, 0.0, 0.0);
    if let Ok(v) = nonkyc_call(&url, "GET", None, c) {
        if let Some(arr) = v.as_array() {
            for b in arr {
                let a = b.get("asset").and_then(|x| x.as_str()).unwrap_or("");
                let free = b.get("available").and_then(num).unwrap_or(0.0);
                let held = b.get("held").and_then(num).unwrap_or(0.0);
                if a.eq_ignore_ascii_case(quote) {
                    qf = free; qh = held;
                } else if a.eq_ignore_ascii_case(base) {
                    bf = free; bh = held;
                }
            }
        }
    }
    (qf, qh, bf, bh)
}

fn nonkyc_open_ids(rest_url: &str, c: &Creds, symbol: &str) -> Vec<String> {
    let url = format!("{}/getorders?symbol={}&status=active&limit=100", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let mut ids = Vec::new();
    if let Ok(v) = nonkyc_call(&url, "GET", None, c) {
        if let Some(arr) = v.as_array() {
            for o in arr {
                if let Some(id) = o.get("id").and_then(|x| x.as_str()) {
                    ids.push(id.to_string());
                }
            }
        }
    }
    ids
}

/// One order-book price level.
pub struct BookLevel {
    pub price: f64,
    pub size: f64,
}

/// One resting order of ours (side is "buy" or "sell").
pub struct OpenOrder {
    pub side: String,
    pub price: f64,
    pub size: f64,
}

/// Everything the depth-ladder view needs in one shot: the public book, our own
/// resting orders, the mid, and our balances. The book is public (no keys); our
/// orders and balances are signed. Read-only - it never places or cancels.
pub struct MmBook {
    pub mid: f64,
    pub best_bid: f64,
    pub best_ask: f64,
    pub asks: Vec<BookLevel>, // ascending price (lowest ask first)
    pub bids: Vec<BookLevel>, // descending price (highest bid first)
    pub our_orders: Vec<OpenOrder>,
    pub base_free: f64,
    pub base_held: f64,
    pub quote_free: f64,
    pub quote_held: f64,
}

// Public full order book (needs the browser UA for Cloudflare, like nonkyc_mid).
fn nonkyc_orderbook(rest_url: &str, symbol: &str) -> Result<(Vec<BookLevel>, Vec<BookLevel>), String> {
    let url = format!("{}/market/getorderbookbysymbol/{}", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let resp = ureq::get(&url).set("User-Agent", UA).timeout(Duration::from_secs(15)).call()
        .map_err(|e| format!("orderbook: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let parse = |key: &str| -> Vec<BookLevel> {
        v.get(key).and_then(|x| x.as_array()).map(|arr| {
            arr.iter().filter_map(|lv| {
                let price = lv.get("numberprice").and_then(num).or_else(|| lv.get("price").and_then(num))?;
                let size = lv.get("quantity").and_then(num)?;
                if price > 0.0 && size > 0.0 { Some(BookLevel { price, size }) } else { None }
            }).collect()
        }).unwrap_or_default()
    };
    Ok((parse("asks"), parse("bids")))
}

// Our resting orders with side/price/size (same endpoint nonkyc_open_ids uses).
fn nonkyc_open_orders(rest_url: &str, c: &Creds, symbol: &str) -> Vec<OpenOrder> {
    let url = format!("{}/getorders?symbol={}&status=active&limit=100", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let mut out = Vec::new();
    if let Ok(v) = nonkyc_call(&url, "GET", None, c) {
        if let Some(arr) = v.as_array() {
            for o in arr {
                let side = o.get("side").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
                let price = o.get("price").and_then(num).unwrap_or(0.0);
                let size = o.get("quantity").and_then(num)
                    .or_else(|| o.get("remainingQuantity").and_then(num))
                    .unwrap_or(0.0);
                if price > 0.0 && size > 0.0 && (side == "buy" || side == "sell") {
                    out.push(OpenOrder { side, price, size });
                }
            }
        }
    }
    out
}

/// Assemble a full book snapshot for the UI. NonKYC only (the live connector).
pub fn book(slug: &str, connector: &str, rest_url: &str, symbol: &str) -> Result<MmBook, String> {
    if connector != "nonkyc" {
        return Err("The live book view supports NonKYC today.".into());
    }
    check_rest_url(connector, rest_url)?;
    let (best_bid, best_ask, mid) = nonkyc_mid(rest_url, symbol)?;
    let (asks, bids) = nonkyc_orderbook(rest_url, symbol)?;
    let (base, quote) = split_symbol(symbol);
    let (our_orders, quote_free, quote_held, base_free, base_held) = match load(slug) {
        Some(c) => {
            let oo = nonkyc_open_orders(rest_url, &c, symbol);
            let (qf, qh, bf, bh) = nonkyc_two_bals(rest_url, &c, &base, &quote);
            (oo, qf, qh, bf, bh)
        }
        None => (Vec::new(), 0.0, 0.0, 0.0, 0.0),
    };
    Ok(MmBook { mid, best_bid, best_ask, asks, bids, our_orders, base_free, base_held, quote_free, quote_held })
}

fn nonkyc_place(rest_url: &str, c: &Creds, symbol: &str, side: &str, price: &str, qty: i64) -> bool {
    let url = format!("{}/createorder", rest_url.trim_end_matches('/'));
    // Compact JSON, no spaces - must match what NonKYC signs against.
    let body = format!(
        "{{\"userProvidedId\":\"mm-{}\",\"symbol\":\"{}\",\"side\":\"{}\",\"type\":\"limit\",\"quantity\":\"{}\",\"price\":\"{}\",\"strictValidate\":false}}",
        now_ms(), symbol, side, qty, price
    );
    nonkyc_call(&url, "POST", Some(&body), c).is_ok()
}

// Reliable fail-safe: cancel every resting order by id (cancel-all is a no-op).
fn nonkyc_cancel_one(rest_url: &str, c: &Creds, id: &str) -> bool {
    let url = format!("{}/cancelorder", rest_url.trim_end_matches('/'));
    let body = format!("{{\"id\":\"{id}\"}}");
    nonkyc_call(&url, "POST", Some(&body), c).is_ok()
}

fn nonkyc_cancel_all(rest_url: &str, c: &Creds, symbol: &str) -> usize {
    let mut n = 0;
    for id in nonkyc_open_ids(rest_url, c, symbol) {
        if nonkyc_cancel_one(rest_url, c, &id) {
            n += 1;
        }
    }
    n
}

/// A resting order of ours, with the id needed to cancel it and the fields needed
/// to decide whether it still matches what we want (so we can leave it in place).
struct RestingOrder {
    id: String,
    is_buy: bool,
    price: f64,
    qty: f64, // quantity still resting (unfilled)
}

fn nonkyc_resting_orders(rest_url: &str, c: &Creds, symbol: &str) -> Vec<RestingOrder> {
    let url = format!("{}/getorders?symbol={}&status=active&limit=200", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let mut out = Vec::new();
    if let Ok(v) = nonkyc_call(&url, "GET", None, c) {
        if let Some(arr) = v.as_array() {
            for o in arr {
                let id = o.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let is_buy = o.get("side").and_then(|x| x.as_str()) == Some("buy");
                let pf = |k: &str| o.get(k).and_then(|x| x.as_str()).and_then(|s| s.parse::<f64>().ok());
                let price = pf("price").unwrap_or(0.0);
                let qty = pf("remainQuantity").or_else(|| pf("quantity")).unwrap_or(0.0);
                if !id.is_empty() && price > 0.0 && qty > 0.0 {
                    out.push(RestingOrder { id, is_buy, price, qty });
                }
            }
        }
    }
    out
}

fn sleep_stoppable(stop: &Arc<AtomicBool>, secs: u64) {
    for _ in 0..(secs * 4) {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn run_loop(cfg: MmConfig, stop: Arc<AtomicBool>) {
    let c = match load(&cfg.slug) {
        Some(c) => c,
        None => {
            set_status(MmStatus { running: false, message: "No keys for this exchange.".into(), ..Default::default() });
            return;
        }
    };
    let (base, quote) = split_symbol(&cfg.symbol);
    let mut cycles = 0u64;
    let mut ref_high = 0.0f64;   // session high-water mid → anchors the buy floor
    let mut ref_low = f64::MAX;  // session low-water mid  → anchors the sell ceiling
    let per_side = cfg.commit_usdt / 2.0; // ~half the commit to each side
    let sum_w: f64 = cfg.levels.iter().sum();

    // Per-order minimum the exchange accepts, in USDT.
    const MIN_ORDER: f64 = 1.0;
    // How far a resting order's price may drift from where we now want it before
    // we bother repricing it. Below this, we leave it alone. This is what stops
    // the pointless cancel/replace every cycle: when the market is quiet, nothing
    // moves out of tolerance, so nothing is cancelled or placed.
    const PRICE_TOL: f64 = 0.0015; // 0.15%
    // Likewise for size: small drifts (partial fills, a nudge from the skew) don't
    // justify tearing an order down and rebuilding it.
    const QTY_TOL: f64 = 0.25; // 25%
    // Inventory skew: bias the budget away from whichever coin we're already heavy
    // in, so the bot stops piling into one side (the thing that bled it before).
    // Gentle and clamped, so it nudges rather than dumps.
    const SKEW_GAIN: f64 = 1.0;
    const SKEW_MAX: f64 = 0.35;

    while !stop.load(Ordering::Relaxed) {
        let (best_bid, best_ask, mid) = match nonkyc_mid(&cfg.rest_url, &cfg.symbol) {
            Ok(m) => m,
            Err(e) => {
                set_status(MmStatus { running: true, message: format!("price error: {e}"), cycles, ..Default::default() });
                sleep_stoppable(&stop, cfg.refresh_secs);
                continue;
            }
        };
        // Dump/pump guard anchored to the session high/low: a floor that just
        // tracked the current mid would ride a crash all the way down and never
        // protect. Anchoring to the high means a real drop actually trips it.
        ref_high = ref_high.max(mid);
        ref_low = ref_low.min(mid);
        let floor = ref_high * (1.0 - cfg.protect_pct / 100.0);
        let ceiling = ref_low * (1.0 + cfg.protect_pct / 100.0);

        let (qf, qh, bf, bh) = nonkyc_two_bals(&cfg.rest_url, &c, &base, &quote);
        let quote_total = qf + qh;                 // all USDT
        let base_value = (bf + bh) * mid;          // all DIVI, valued in USDT
        // deviation > 0 means too much DIVI: shrink bids, grow asks, and vice versa.
        let denom = base_value + quote_total;
        let deviation = if denom > 0.0 { (base_value - quote_total) / denom } else { 0.0 };
        let skew = (deviation * SKEW_GAIN).clamp(-SKEW_MAX, SKEW_MAX);
        let bid_budget = per_side * (1.0 - skew);
        let ask_budget = per_side * (1.0 + skew);

        // 1) Work out the ladder we WANT right now. Weight toward the outer levels
        //    so a sudden move fills only the small near orders first.
        let mut desired: Vec<(bool, f64, i64)> = Vec::new(); // (is_buy, price, qty)
        for &sp in &cfg.levels {
            let weight = if sum_w > 0.0 { sp / sum_w } else { 1.0 / cfg.levels.len().max(1) as f64 };
            let bid_px = (mid * (1.0 - sp / 100.0)).min(best_ask * 0.9999);
            if bid_px >= floor {
                let qty = (bid_budget * weight / bid_px) as i64;
                if qty > 0 && qty as f64 * bid_px >= MIN_ORDER { desired.push((true, bid_px, qty)); }
            }
            let ask_px = (mid * (1.0 + sp / 100.0)).max(best_bid * 1.0001);
            if ask_px <= ceiling {
                let qty = (ask_budget * weight / ask_px) as i64;
                if qty > 0 && qty as f64 * ask_px >= MIN_ORDER { desired.push((false, ask_px, qty)); }
            }
        }

        // 2) Compare with what's already resting: keep matches, note what to place.
        let resting = nonkyc_resting_orders(&cfg.rest_url, &c, &cfg.symbol);
        let mut used = vec![false; resting.len()];
        let mut committed_quote = 0.0; // USDT tied up in buys
        let mut committed_base = 0.0;  // DIVI tied up in sells
        let mut kept = 0usize;
        let mut to_place: Vec<(bool, f64, i64)> = Vec::new();
        for &(is_buy, price, qty) in &desired {
            let mut matched = false;
            for (i, r) in resting.iter().enumerate() {
                if used[i] || r.is_buy != is_buy { continue; }
                if (r.price - price).abs() <= price * PRICE_TOL
                    && (r.qty - qty as f64).abs() <= (qty as f64) * QTY_TOL {
                    used[i] = true; matched = true; kept += 1;
                    if is_buy { committed_quote += r.qty * r.price; } else { committed_base += r.qty; }
                    break;
                }
            }
            if !matched { to_place.push((is_buy, price, qty)); }
        }

        // 3) Cancel only the resting orders that no longer fit.
        let mut cancelled = 0usize;
        for (i, r) in resting.iter().enumerate() {
            if !used[i] && nonkyc_cancel_one(&cfg.rest_url, &c, &r.id) { cancelled += 1; }
        }

        // 4) Place only the missing orders, capped by the free (un-held) balance.
        let mut quote_free_left = qf;
        let mut base_free_left = bf;
        let mut placed_new = 0usize;
        for &(is_buy, price, qty) in &to_place {
            if is_buy {
                let cost = qty as f64 * price;
                if cost <= quote_free_left
                    && nonkyc_place(&cfg.rest_url, &c, &cfg.symbol, "buy", &fmt_price(price), qty) {
                    quote_free_left -= cost; committed_quote += cost; placed_new += 1;
                }
            } else if qty as f64 <= base_free_left
                && nonkyc_place(&cfg.rest_url, &c, &cfg.symbol, "sell", &fmt_price(price), qty) {
                base_free_left -= qty as f64; committed_base += qty as f64; placed_new += 1;
            }
        }

        let live = kept + placed_new;
        cycles += 1;
        let msg = if cancelled == 0 && placed_new == 0 {
            format!("steady: {live} orders around {mid:.7}")
        } else {
            format!("adjusted (+{placed_new}/-{cancelled}): {live} orders around {mid:.7}")
        };
        set_status(MmStatus {
            running: true, message: msg, mid, open_orders: live,
            base_free: ((bf + bh) - committed_base).max(0.0), base_held: committed_base,
            quote_free: (quote_total - committed_quote).max(0.0), quote_held: committed_quote,
            cycles,
        });
        sleep_stoppable(&stop, cfg.refresh_secs);
    }

    // Fail-safe: cancel everything on the way out.
    let n = nonkyc_cancel_all(&cfg.rest_url, &c, &cfg.symbol);
    set_status(MmStatus { running: false, message: format!("stopped - cancelled {n} orders"), cycles, ..Default::default() });
}

/// Start the live quoting engine with the given config. One at a time.
pub fn start(mut cfg: MmConfig) -> Result<(), String> {
    if cfg.connector != "nonkyc" {
        return Err("Live quoting currently supports NonKYC. More connectors coming.".into());
    }
    check_rest_url(&cfg.connector, &cfg.rest_url)?;
    // Normalise the pair to slash form so the order body and price calls agree.
    cfg.symbol = cfg.symbol.replace('-', "/");
    if load(&cfg.slug).is_none() {
        return Err("Connect this exchange first (add trade-only keys).".into());
    }
    let mut g = ENGINE.lock().map_err(|_| "engine busy".to_string())?;
    if g.is_some() {
        return Err("The market maker is already running.".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    set_status(MmStatus { running: true, message: "starting…".into(), ..Default::default() });
    let handle = thread::spawn(move || run_loop(cfg, stop2));
    *g = Some(Running { stop, handle });
    Ok(())
}

/// Cancel every resting order for a pair, independent of the engine. Used to
/// clear orders left on the exchange after an unclean stop (e.g. a crash, or the
/// app being force-quit), which the engine's own fail-safe never got to cancel.
pub fn cancel_all_orders(slug: &str, connector: &str, rest_url: &str, symbol: &str) -> Result<usize, String> {
    if connector != "nonkyc" {
        return Err("Cancelling is available for NonKYC today.".into());
    }
    check_rest_url(connector, rest_url)?;
    let c = load(slug).ok_or_else(|| "Connect this exchange first.".to_string())?;
    let sym = symbol.replace('-', "/");
    Ok(nonkyc_cancel_all(rest_url, &c, &sym))
}

/// Realized trading result, reconstructed from the exchange's own filled-order
/// history. This is the source of truth for "where did my money go": the exchange
/// keeps every fill, so a node holder can always audit their market making.
pub struct TradePnl {
    pub fills: usize,
    pub buys: usize,
    pub sells: usize,
    pub divi_bought: f64,
    pub divi_sold: f64,
    pub usdt_spent: f64,
    pub usdt_recv: f64,
    pub avg_buy: f64,
    pub avg_sell: f64,
    pub net_divi: f64,      // bought - sold (inventory change)
    pub net_usdt: f64,      // received - spent (realized cash flow, pre external fees)
    pub gross_volume: f64,  // total USDT traded, both sides
    pub mid: f64,           // current mid, to value leftover inventory
    pub total_pnl: f64,     // net_usdt + net_divi * mid
    pub first_ms: i64,
    pub last_ms: i64,
}

/// Pull the filled-order history for a pair and total it up. Read-only.
pub fn trade_history(slug: &str, connector: &str, rest_url: &str, symbol: &str) -> Result<TradePnl, String> {
    if connector != "nonkyc" {
        return Err("Trade history is available for NonKYC today.".into());
    }
    check_rest_url(connector, rest_url)?;
    let c = load(slug).ok_or_else(|| "Connect this exchange first.".to_string())?;
    let url = format!("{}/getorders?symbol={}&status=filled&limit=1000", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let v = nonkyc_call(&url, "GET", None, &c)?;
    let arr = v.as_array().ok_or_else(|| "The exchange reply wasn't a list of orders.".to_string())?;

    let (mut buys, mut sells) = (0usize, 0usize);
    let (mut divi_bought, mut divi_sold, mut usdt_spent, mut usdt_recv) = (0.0, 0.0, 0.0, 0.0);
    let (mut first_ms, mut last_ms) = (i64::MAX, 0i64);
    let fstr = |o: &serde_json::Value, k: &str| o.get(k).and_then(|x| x.as_str()).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    for o in arr {
        let qty = fstr(o, "executedQuantity");
        let px = fstr(o, "price");
        if qty <= 0.0 { continue; }
        let val = qty * px;
        let t = o.get("lastTradeAt").and_then(|x| x.as_i64()).or_else(|| o.get("createdAt").and_then(|x| x.as_i64())).unwrap_or(0);
        if t > 0 { first_ms = first_ms.min(t); last_ms = last_ms.max(t); }
        match o.get("side").and_then(|x| x.as_str()) {
            Some("buy") => { buys += 1; divi_bought += qty; usdt_spent += val; }
            Some("sell") => { sells += 1; divi_sold += qty; usdt_recv += val; }
            _ => {}
        }
    }
    let mid = nonkyc_mid(rest_url, symbol).map(|(_, _, m)| m).unwrap_or(0.0);
    let net_divi = divi_bought - divi_sold;
    let net_usdt = usdt_recv - usdt_spent;
    Ok(TradePnl {
        fills: buys + sells, buys, sells,
        divi_bought, divi_sold, usdt_spent, usdt_recv,
        avg_buy: if divi_bought > 0.0 { usdt_spent / divi_bought } else { 0.0 },
        avg_sell: if divi_sold > 0.0 { usdt_recv / divi_sold } else { 0.0 },
        net_divi, net_usdt, gross_volume: usdt_spent + usdt_recv, mid,
        total_pnl: net_usdt + net_divi * mid,
        first_ms: if first_ms == i64::MAX { 0 } else { first_ms }, last_ms,
    })
}

// Plain-decimal quantity (no scientific notation, trailing zeros trimmed), for
// the manual trade order body.
fn fmt_qty(q: f64) -> String {
    let s = format!("{q:.8}");
    let t = s.trim_end_matches('0').trim_end_matches('.');
    if t.is_empty() { "0".to_string() } else { t.to_string() }
}

/// Place a manual order (the user's own buy/sell, not the engine's). Market or
/// limit. Quantity is always in the base coin (DIVI). Returns the new order id.
/// The user drives this from the Trade panel; errors from the exchange (balance,
/// minimum size, bad price) are surfaced verbatim so nothing fails silently.
pub fn place_order(slug: &str, connector: &str, rest_url: &str, symbol: &str,
                   side: &str, order_type: &str, quantity: f64, price: Option<f64>) -> Result<String, String> {
    if connector != "nonkyc" { return Err("Trading is available for NonKYC today.".into()); }
    check_rest_url(connector, rest_url)?;
    if side != "buy" && side != "sell" { return Err("Side must be buy or sell.".into()); }
    if order_type != "limit" && order_type != "market" { return Err("Order type must be limit or market.".into()); }
    if !(quantity > 0.0) { return Err("Enter a quantity greater than zero.".into()); }
    let c = load(slug).ok_or_else(|| "Connect this exchange first.".to_string())?;
    let sym = symbol.replace('-', "/");
    let url = format!("{}/createorder", rest_url.trim_end_matches('/'));
    let qty = fmt_qty(quantity);
    let body = if order_type == "limit" {
        let p = price.ok_or_else(|| "A limit order needs a price.".to_string())?;
        if !(p > 0.0) { return Err("Enter a price greater than zero.".into()); }
        format!("{{\"userProvidedId\":\"tr-{}\",\"symbol\":\"{}\",\"side\":\"{}\",\"type\":\"limit\",\"quantity\":\"{}\",\"price\":\"{}\",\"strictValidate\":false}}",
            now_ms(), sym, side, qty, fmt_price(p))
    } else {
        format!("{{\"userProvidedId\":\"tr-{}\",\"symbol\":\"{}\",\"side\":\"{}\",\"type\":\"market\",\"quantity\":\"{}\",\"strictValidate\":false}}",
            now_ms(), sym, side, qty)
    };
    let v = nonkyc_call(&url, "POST", Some(&body), &c)?;
    Ok(v.get("id").and_then(|x| x.as_str()).unwrap_or("ok").to_string())
}

/// Cancel one of the user's orders by id.
pub fn cancel_order(slug: &str, connector: &str, rest_url: &str, id: &str) -> Result<(), String> {
    if connector != "nonkyc" { return Err("Cancelling is available for NonKYC today.".into()); }
    check_rest_url(connector, rest_url)?;
    let c = load(slug).ok_or_else(|| "Connect this exchange first.".to_string())?;
    if nonkyc_cancel_one(rest_url, &c, id) { Ok(()) } else { Err("The exchange did not cancel that order.".into()) }
}

/// One of the user's resting orders, for the Trade panel's open-orders list.
pub struct ManualOrder {
    pub id: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub qty: f64,
    pub from_mm: bool, // placed by the market-maker engine (mm-*) vs a manual trade (tr-*)
}

/// The user's currently-open orders on a pair, with ids so the UI can cancel them.
pub fn open_orders(slug: &str, connector: &str, rest_url: &str, symbol: &str) -> Result<Vec<ManualOrder>, String> {
    if connector != "nonkyc" { return Err("Available for NonKYC today.".into()); }
    check_rest_url(connector, rest_url)?;
    let c = load(slug).ok_or_else(|| "Connect this exchange first.".to_string())?;
    let url = format!("{}/getorders?symbol={}&status=active&limit=200", rest_url.trim_end_matches('/'), enc_symbol(symbol));
    let v = nonkyc_call(&url, "GET", None, &c)?;
    let arr = v.as_array().ok_or_else(|| "The exchange reply wasn't a list of orders.".to_string())?;
    let mut out = Vec::new();
    for o in arr {
        let id = o.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if id.is_empty() { continue; }
        let side = o.get("side").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let order_type = o.get("type").and_then(|x| x.as_str()).unwrap_or("limit").to_string();
        let pf = |k: &str| o.get(k).and_then(|x| x.as_str()).and_then(|s| s.parse::<f64>().ok());
        let price = pf("price").unwrap_or(0.0);
        let qty = pf("remainQuantity").or_else(|| pf("quantity")).unwrap_or(0.0);
        let from_mm = o.get("userProvidedId").and_then(|x| x.as_str()).unwrap_or("").starts_with("mm-");
        out.push(ManualOrder { id, side, order_type, price, qty, from_mm });
    }
    Ok(out)
}

/// Stop the engine, wait for its fail-safe cancel to finish.
pub fn stop() -> Result<(), String> {
    let running = ENGINE.lock().map_err(|_| "engine busy".to_string())?.take();
    if let Some(r) = running {
        r.stop.store(true, Ordering::Relaxed);
        let _ = r.handle.join();
    }
    Ok(())
}
