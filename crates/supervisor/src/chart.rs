//! DIVI price history for the in-app chart.
//!
//! The time-series (daily deep past + hourly full history + 15-min recent,
//! sourced from CoinMarketCap) lives in this project's Supabase table
//! `divi_price`, keyed by timestamp. We read it over the REST API with the
//! project's ANON key — a publishable key, safe to ship, because row-level
//! security exposes only read access to this one table. Only timestamp + close
//! are fetched (that is all the chart draws), keeping the payload small.
//!
//! On any failure we return an empty series: the chart shows nothing rather than
//! a fabricated line.

use serde_json::Value;

const SUPABASE_URL: &str = "https://nbnhjstexdlvtwcxopqk.supabase.co";
const ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibmhqc3RleGRsdnR3Y3hvcHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTQ5MjMsImV4cCI6MjA5OTg3MDkyM30.RxcKVr8mU-XUZCpgfNZvMESRFRomk97AAwPjRIvQZP0";

pub struct PricePoint {
    pub ts: String, // ISO 8601 timestamp
    pub close: Option<f64>,
}

/// Full DIVI price series, oldest first. One request (the project's max_rows is
/// raised well above the series size).
pub fn price_history() -> Vec<PricePoint> {
    let url = format!(
        "{SUPABASE_URL}/rest/v1/divi_price?select=ts,close&order=ts.asc&limit=100000"
    );
    let resp = match ureq::get(&url)
        .set("apikey", ANON_KEY)
        .set("Authorization", &format!("Bearer {ANON_KEY}"))
        .timeout(std::time::Duration::from_secs(30))
        .call()
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let Ok(text) = resp.into_string() else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    let Some(arr) = v.as_array() else { return Vec::new() };
    arr.iter()
        .filter_map(|row| {
            let ts = row.get("ts")?.as_str()?.to_string();
            Some(PricePoint { ts, close: row.get("close").and_then(|x| x.as_f64()) })
        })
        .collect()
}

/// The single most recent DIVI/USD close from the shared CMC-sourced feed. Used
/// to price the PoE fee identically for every user, with no per-user API key.
/// None on any failure (so callers show "unavailable" rather than a guess).
pub fn price_latest() -> Option<f64> {
    let url = format!(
        "{SUPABASE_URL}/rest/v1/divi_price?select=close&order=ts.desc&limit=1"
    );
    let resp = ureq::get(&url)
        .set("apikey", ANON_KEY)
        .set("Authorization", &format!("Bearer {ANON_KEY}"))
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .ok()?;
    let text = resp.into_string().ok()?;
    let v = serde_json::from_str::<Value>(&text).ok()?;
    v.as_array()?
        .first()?
        .get("close")?
        .as_f64()
        .filter(|p| *p > 0.0)
}
