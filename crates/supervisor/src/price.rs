//! DIVI price discovery.
//!
//! Read this before changing the source order. DIVI has almost no liquid market,
//! and the aggregators disagree by ~4.5x because they price different illiquid
//! venues:
//!   * CoinGecko / CoinPaprika (~$0.000286) follow the wrapped ERC-20 on
//!     Uniswap V2 — the only pair with ANY trading, and that is ~$3 a day.
//!   * CoinMarketCap (~$0.00129) follows StakeCube DIVI/BTC, whose 24h volume
//!     is ZERO. It is a stale last-traded price on a dead order book.
//! Neither is "the" price. CoinMarketCap is preferred because it is what the
//! Divi community quotes, but it needs a free API key.
//!
//! USD is then converted to every requested currency
//! with live FX rates, so any fiat (EUR, CRC, …) works off one crypto price and
//! we don't burn CMC credits on multi-currency conversions.
//! Never fabricate: no source → no price (empty result).

use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

pub struct PriceResult {
    pub prices: HashMap<String, f64>, // lowercase currency code -> price per DIVI
    pub coingecko_ok: bool,
    pub coinmarketcap_ok: bool,
    /// Why CoinMarketCap failed, when a key was configured. Surfaced to the
    /// admin panel so a bad key or exhausted quota is visible, not guessed at.
    pub cmc_error: Option<String>,
}

/// CoinMarketCap: DIVI in USD (one convert keeps it to a single credit).
///
/// Returns the reason on failure instead of swallowing it. This used to return
/// Option, so a rejected key or an exhausted quota looked identical to "not
/// configured" and the caller quietly used a different exchange's price
/// instead — the user saw a wrong number with nothing explaining why.
fn coinmarketcap_usd(key: &str) -> Result<f64, String> {
    let url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=DIVI&convert=USD";
    let resp = ureq::get(url)
        .set("X-CMC_PRO_API_KEY", key)
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => {
                let body = r.into_string().unwrap_or_default();
                let msg = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| v["status"]["error_message"].as_str().map(str::to_string))
                    .unwrap_or_else(|| body.chars().take(120).collect());
                format!("CoinMarketCap returned HTTP {code}: {msg}")
            }
            other => format!("Could not reach CoinMarketCap: {other}"),
        })?;
    let text = resp.into_string().map_err(|e| format!("Unreadable CoinMarketCap reply: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Bad CoinMarketCap JSON: {e}"))?;
    // data.DIVI may be an object (v1) or an array (several coins share a symbol).
    let node = &v["data"]["DIVI"];
    node["quote"]["USD"]["price"]
        .as_f64()
        .or_else(|| node[0]["quote"]["USD"]["price"].as_f64())
        .ok_or_else(|| "CoinMarketCap returned no USD quote for DIVI".to_string())
}

/// CoinGecko: DIVI in USD (no key required).
fn coingecko_usd() -> Option<f64> {
    let url = "https://api.coingecko.com/api/v3/simple/price?ids=divi&vs_currencies=usd";
    let resp = ureq::get(url).timeout(Duration::from_secs(10)).call().ok()?;
    let v: Value = serde_json::from_str(&resp.into_string().ok()?).ok()?;
    v["divi"]["usd"].as_f64()
}

/// Live USD→fiat rates (free, no key). Always includes USD=1.
fn fx_rates_usd() -> HashMap<String, f64> {
    let mut out = HashMap::new();
    out.insert("USD".to_string(), 1.0);
    if let Ok(resp) = ureq::get("https://open.er-api.com/v6/latest/USD")
        .timeout(Duration::from_secs(10))
        .call()
    {
        if let Ok(text) = resp.into_string() {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Some(obj) = v["rates"].as_object() {
                    for (k, val) in obj {
                        if let Some(f) = val.as_f64() {
                            out.insert(k.to_uppercase(), f);
                        }
                    }
                }
            }
        }
    }
    out
}

pub fn divi_prices(currencies: &[String], cmc_key: Option<&str>, use_coingecko: bool) -> PriceResult {
    // DIVI → USD, from CMC and (optionally) CoinGecko.
    let key = cmc_key.filter(|k| !k.trim().is_empty());
    let key_configured = key.is_some();
    let mut cmc_error: Option<String> = None;
    let cmc_usd = key.and_then(|k| match coinmarketcap_usd(k.trim()) {
        Ok(v) => Some(v),
        Err(e) => {
            cmc_error = Some(e);
            None
        }
    });

    // Once a key is configured, CoinMarketCap is authoritative. If it fails we
    // report that and show NO price, rather than silently swapping in
    // CoinGecko's number — the two disagree by ~4.5x, so the substitution reads
    // as "your coins are worth a quarter of what you thought" with nothing on
    // screen to say the source changed. CoinGecko is only a fallback for a
    // wallet with no key at all.
    // No key: CoinGecko is the only source, and the toggle is respected — a
    // user who turns it off has explicitly asked us not to call it, and gets no
    // price rather than a silent one. (It defaults ON, so the out-of-the-box
    // case still shows a value.)
    let cg_usd = if key_configured || !use_coingecko { None } else { coingecko_usd() };

    // Do NOT blend disagreeing sources. These two can be 4.5x apart, and the
    // midpoint of two prices that far apart is a number no market ever traded
    // at — worse than either input. Average only when they corroborate each
    // other; otherwise trust CoinMarketCap, which is the quote users compare
    // against.
    let divi_usd = match (cmc_usd, cg_usd) {
        (Some(a), Some(b)) => {
            let spread = (a - b).abs() / a.max(b);
            Some(if spread <= 0.20 { (a + b) / 2.0 } else { a })
        }
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };

    let mut prices = HashMap::new();
    if let Some(usd) = divi_usd {
        let fx = fx_rates_usd();
        for c in currencies {
            if let Some(rate) = fx.get(&c.to_uppercase()) {
                prices.insert(c.to_lowercase(), usd * rate);
            }
        }
    }

    PriceResult {
        prices,
        coingecko_ok: cg_usd.is_some(),
        coinmarketcap_ok: cmc_usd.is_some(),
        cmc_error,
    }
}
