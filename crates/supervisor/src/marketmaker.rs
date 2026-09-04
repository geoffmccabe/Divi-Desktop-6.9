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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
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
    pub order_usdt: f64,     // target notional per order
    pub refresh_secs: u64,
    pub max_side_usdt: f64,  // hard cap on resting notional per side
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
    sym.replace('/', "%2F")
}

fn split_symbol(sym: &str) -> (String, String) {
    let mut it = sym.split('/');
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

fn nonkyc_place(rest_url: &str, c: &Creds, symbol: &str, side: &str, price: &str, qty: i64) -> bool {
    let url = format!("{}/createorder", rest_url.trim_end_matches('/'));
    // Compact JSON, no spaces — must match what NonKYC signs against.
    let body = format!(
        "{{\"userProvidedId\":\"mm-{}\",\"symbol\":\"{}\",\"side\":\"{}\",\"type\":\"limit\",\"quantity\":\"{}\",\"price\":\"{}\",\"strictValidate\":false}}",
        now_ms(), symbol, side, qty, price
    );
    nonkyc_call(&url, "POST", Some(&body), c).is_ok()
}

// Reliable fail-safe: cancel every resting order by id (cancel-all is a no-op).
fn nonkyc_cancel_all(rest_url: &str, c: &Creds, symbol: &str) -> usize {
    let url = format!("{}/cancelorder", rest_url.trim_end_matches('/'));
    let mut n = 0;
    for id in nonkyc_open_ids(rest_url, c, symbol) {
        let body = format!("{{\"id\":\"{id}\"}}");
        if nonkyc_call(&url, "POST", Some(&body), c).is_ok() {
            n += 1;
        }
    }
    n
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

    while !stop.load(Ordering::Relaxed) {
        nonkyc_cancel_all(&cfg.rest_url, &c, &cfg.symbol);

        let (best_bid, best_ask, mid) = match nonkyc_mid(&cfg.rest_url, &cfg.symbol) {
            Ok(m) => m,
            Err(e) => {
                set_status(MmStatus { running: true, message: format!("price error: {e}"), cycles, ..Default::default() });
                sleep_stoppable(&stop, cfg.refresh_secs);
                continue;
            }
        };
        let (qf, qh, bf, bh) = nonkyc_two_bals(&cfg.rest_url, &c, &base, &quote);

        let notional = cfg.order_usdt;
        let mut quote_used = 0.0; // USDT committed to bids
        let mut ask_notional = 0.0; // USDT-equiv committed to asks
        let mut base_used = 0.0; // base committed to asks
        let mut placed = 0usize;

        for &sp in &cfg.levels {
            // BUY level: below mid, never crossing best ask
            let bid_px = (mid * (1.0 - sp / 100.0)).min(best_ask * 0.9999);
            let bid_qty = (notional / bid_px) as i64;
            let cost = bid_qty as f64 * bid_px;
            if bid_qty > 0 && cost >= 1.0 && quote_used + cost <= cfg.max_side_usdt && qf >= quote_used + cost && nonkyc_place(&cfg.rest_url, &c, &cfg.symbol, "buy", &fmt_price(bid_px), bid_qty) {
                quote_used += cost;
                placed += 1;
            }
            // SELL level: above mid, never crossing best bid
            let ask_px = (mid * (1.0 + sp / 100.0)).max(best_bid * 1.0001);
            let ask_qty = (notional / ask_px) as i64;
            let val = ask_qty as f64 * ask_px;
            if ask_qty > 0 && val >= 1.0 && ask_notional + val <= cfg.max_side_usdt && bf >= base_used + ask_qty as f64 && nonkyc_place(&cfg.rest_url, &c, &cfg.symbol, "sell", &fmt_price(ask_px), ask_qty) {
                ask_notional += val;
                base_used += ask_qty as f64;
                placed += 1;
            }
        }

        cycles += 1;
        set_status(MmStatus {
            running: true,
            message: format!("quoting {placed} orders around {mid:.7}"),
            mid, open_orders: placed,
            base_free: bf, base_held: bh, quote_free: qf, quote_held: qh, cycles,
        });
        sleep_stoppable(&stop, cfg.refresh_secs);
    }

    // Fail-safe: cancel everything on the way out.
    let n = nonkyc_cancel_all(&cfg.rest_url, &c, &cfg.symbol);
    set_status(MmStatus { running: false, message: format!("stopped — cancelled {n} orders"), cycles, ..Default::default() });
}

/// Start the live quoting engine with the given config. One at a time.
pub fn start(cfg: MmConfig) -> Result<(), String> {
    if cfg.connector != "nonkyc" {
        return Err("Live quoting currently supports NonKYC. More connectors coming.".into());
    }
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

/// Stop the engine, wait for its fail-safe cancel to finish.
pub fn stop() -> Result<(), String> {
    let running = ENGINE.lock().map_err(|_| "engine busy".to_string())?.take();
    if let Some(r) = running {
        r.stop.store(true, Ordering::Relaxed);
        let _ = r.handle.join();
    }
    Ok(())
}
