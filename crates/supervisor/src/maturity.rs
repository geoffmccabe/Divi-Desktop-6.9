use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

// Coin maturity for staking.
//
// The rules below are read straight out of Divi Core, not guessed:
//   * chainparams.cpp (mainnet): nMinCoinAgeForStaking = 60 * 60
//   * wallet.cpp:1452  — skips a coin if (now - blockTime) < MinCoinAgeForStaking
//   * wallet.cpp:1456  — skips a coin if depth < 10 (or COINBASE_MATURITY = 20
//                        when the coin came from a coinstake)
//
// Ten confirmations is ~10 minutes at Divi's 60-second target, and even the
// coinstake case (20) is ~20 minutes — both comfortably inside the one-hour age
// requirement. So the ONE HOUR AGE is always the binding constraint, and that is
// what the countdown tracks. We still check the confirmation floor so a stalled
// chain can't report a coin as ready when the node would reject it.

pub const MIN_COIN_AGE_SECS: i64 = 60 * 60;
pub const MIN_CONFIRMATIONS: i64 = 10;

/// Divi's target block spacing. `listunspent` reports confirmations but not the
/// block time, so we infer age from depth rather than firing a `gettransaction`
/// per UTXO — that would be dozens of extra calls against a node we already know
/// stalls under load. The estimate self-corrects as confirmations tick up, and
/// the UI labels the countdown as approximate.
const BLOCK_SECS: i64 = 60;

pub struct Utxo {
    pub address: String,
    pub amount: f64,
    pub confirmations: i64,
    /// Estimated age in seconds (confirmations x block time).
    pub age_secs: i64,
    pub mature: bool,
    /// 0-100, how far along this coin is toward being stakeable.
    pub percent: f64,
    /// Estimated seconds until stakeable; 0 once mature.
    pub seconds_left: i64,
}

/// Every unspent output in the wallet with its progress toward staking, newest
/// (least mature) first so the UI leads with what the user is waiting on.
/// Returns None when the node can't be reached, so the UI can tell "offline"
/// apart from "genuinely no coins".
pub fn coin_maturity(cfg: &NodeConfig) -> Option<Vec<Utxo>> {
    let rpc = RpcClient::new(cfg);
    // minconf 0 so freshly-received coins appear immediately, still maturing.
    let v = rpc.call("listunspent", json!([0, 9_999_999])).ok()?;
    let arr = v.as_array()?;

    let mut out: Vec<Utxo> = arr
        .iter()
        .map(|u| {
            let confirmations = u["confirmations"].as_i64().unwrap_or(0);
            let age_secs = confirmations.saturating_mul(BLOCK_SECS);

            // Progress against both gates; the slower one governs.
            let age_frac = age_secs as f64 / MIN_COIN_AGE_SECS as f64;
            let conf_frac = confirmations as f64 / MIN_CONFIRMATIONS as f64;
            let percent = (age_frac.min(conf_frac).clamp(0.0, 1.0)) * 100.0;

            let age_left = (MIN_COIN_AGE_SECS - age_secs).max(0);
            let conf_left = (MIN_CONFIRMATIONS - confirmations).max(0) * BLOCK_SECS;
            let seconds_left = age_left.max(conf_left);

            Utxo {
                address: u["address"].as_str().unwrap_or("").to_string(),
                amount: u["amount"].as_f64().unwrap_or(0.0),
                confirmations,
                age_secs,
                mature: seconds_left == 0,
                percent,
                seconds_left,
            }
        })
        .collect();

    // Least mature first — the coins the user is actually waiting on.
    out.sort_by(|a, b| a.confirmations.cmp(&b.confirmations));
    Some(out)
}
