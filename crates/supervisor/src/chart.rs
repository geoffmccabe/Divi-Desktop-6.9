//! DIVI price history for the in-app chart.
//!
//! The daily series (backfilled from CoinMarketCap, then extended going forward)
//! lives in this project's Supabase table `divi_price_daily`. We read it over the
//! REST API with the project's ANON key — a publishable key, safe to ship,
//! because row-level security exposes only read access to this one table.
//!
//! On any failure we return an empty series: the chart shows nothing rather than
//! a fabricated line.

use serde_json::Value;

const SUPABASE_URL: &str = "https://nbnhjstexdlvtwcxopqk.supabase.co";
const ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibmhqc3RleGRsdnR3Y3hvcHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTQ5MjMsImV4cCI6MjA5OTg3MDkyM30.RxcKVr8mU-XUZCpgfNZvMESRFRomk97AAwPjRIvQZP0";

pub struct PricePoint {
    pub day: String,
    pub close: Option<f64>,
    pub market_cap: Option<f64>,
    pub volume: Option<f64>,
}

/// Daily DIVI price history, oldest first. Empty on any error.
pub fn price_history() -> Vec<PricePoint> {
    let url = format!(
        "{SUPABASE_URL}/rest/v1/divi_price_daily\
         ?select=day,close,market_cap,volume&order=day.asc"
    );
    let resp = match ureq::get(&url)
        .set("apikey", ANON_KEY)
        .set("Authorization", &format!("Bearer {ANON_KEY}"))
        .timeout(std::time::Duration::from_secs(20))
        .call()
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let text = match resp.into_string() {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(arr) = v.as_array() else { return Vec::new() };
    arr.iter()
        .filter_map(|row| {
            let day = row.get("day")?.as_str()?.to_string();
            Some(PricePoint {
                day,
                close: row.get("close").and_then(|x| x.as_f64()),
                market_cap: row.get("market_cap").and_then(|x| x.as_f64()),
                volume: row.get("volume").and_then(|x| x.as_f64()),
            })
        })
        .collect()
}
