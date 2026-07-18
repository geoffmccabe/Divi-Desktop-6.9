//! DIVI price discovery. The DIVI→USD price comes from CoinMarketCap (the user's
//! free API key) and optionally CoinGecko — averaged when both report, otherwise
//! whichever worked. CoinGecko is built but off by default (DIVI has no active
//! markets there right now). USD is then converted to every requested currency
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
}

/// CoinMarketCap: DIVI in USD (one convert keeps it to a single credit).
fn coinmarketcap_usd(key: &str) -> Option<f64> {
    let url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=DIVI&convert=USD";
    let resp = ureq::get(url)
        .set("X-CMC_PRO_API_KEY", key)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?;
    let v: Value = serde_json::from_str(&resp.into_string().ok()?).ok()?;
    // data.DIVI may be an object (v1) or an array (v2-style) — handle both.
    let node = &v["data"]["DIVI"];
    node["quote"]["USD"]["price"]
        .as_f64()
        .or_else(|| node[0]["quote"]["USD"]["price"].as_f64())
}

/// CoinGecko: DIVI in USD (no key). Built but gated off by default.
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
    let cmc_usd = cmc_key.filter(|k| !k.is_empty()).and_then(coinmarketcap_usd);
    let cg_usd = if use_coingecko { coingecko_usd() } else { None };

    let divi_usd = match (cmc_usd, cg_usd) {
        (Some(a), Some(b)) => Some((a + b) / 2.0),
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
    }
}
