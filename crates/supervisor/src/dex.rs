//! DEX (Uniswap V2) read-only pricing for eDIVI on Ethereum. Every on-chain read
//! goes through a public JSON-RPC from this backend - no browser web3, no keys,
//! no signing. The Market Maker's DEX tab uses this to show a live eDIVI price and
//! swap quotes. Actually swapping (wallet connect + a signed transaction) is a
//! later phase; nothing here can move funds.

use serde_json::Value;
use std::time::Duration;

const RPC: &str = "https://ethereum-rpc.publicnode.com";
const PAIR: &str = "0x011a4318e7a45927004018dc88bec93953476615"; // Uniswap V2 eDIVI/WETH
const EDIVI: &str = "0x246908bff0b1ba6ecadcf57fb94f6ae2fcd43a77";
const CHAINLINK_ETHUSD: &str = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";

fn eth_call(to: &str, data: &str) -> Result<String, String> {
    let body = format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{{\"to\":\"{to}\",\"data\":\"{data}\"}},\"latest\"]}}"
    );
    let resp = ureq::post(RPC)
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(15))
        .send_string(&body)
        .map_err(|e| format!("Ethereum RPC error: {e}"))?;
    let text = resp.into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    v.get("result").and_then(|r| r.as_str()).map(|s| s.to_string())
        .ok_or_else(|| "The Ethereum RPC returned no result.".to_string())
}

// The `index`-th 32-byte word of an ABI result, as u128. Reserves are uint112 and
// prices/decimals are small, so the low 112 bits always fit in u128.
fn word_u128(hex: &str, index: usize) -> u128 {
    let h = hex.trim_start_matches("0x");
    let start = index * 64;
    if h.len() < start + 64 {
        return 0;
    }
    let word = &h[start..start + 64];
    u128::from_str_radix(&word[64 - 28..], 16).unwrap_or(0)
}

pub struct DexPool {
    pub reserve_edivi: f64, // eDIVI in the pool (human units)
    pub reserve_weth: f64,  // WETH in the pool (human units)
    pub eth_usd: f64,       // ETH price in USD (0 if unavailable)
    pub edivi_decimals: u32,
}

/// Read the eDIVI/WETH Uniswap V2 pool reserves + an on-chain ETH/USD price.
pub fn pool() -> Result<DexPool, String> {
    // eDIVI decimals (it's 8, like native DIVI - never assume 18).
    let edivi_dec = eth_call(EDIVI, "0x313ce567").ok()
        .map(|h| word_u128(&h, 0) as u32)
        .filter(|d| *d > 0 && *d <= 36)
        .unwrap_or(8);

    // getReserves(): token0 is eDIVI, token1 is WETH (verified on-chain).
    let res = eth_call(PAIR, "0x0902f1ac")?;
    let reserve_edivi = word_u128(&res, 0) as f64 / 10f64.powi(edivi_dec as i32);
    let reserve_weth = word_u128(&res, 1) as f64 / 1e18;

    // ETH/USD from the Chainlink feed (8 decimals). Best-effort; 0 if it fails.
    let eth_usd = eth_call(CHAINLINK_ETHUSD, "0x50d25bcd")
        .map(|h| word_u128(&h, 0) as f64 / 1e8)
        .unwrap_or(0.0);

    Ok(DexPool { reserve_edivi, reserve_weth, eth_usd, edivi_decimals: edivi_dec })
}
