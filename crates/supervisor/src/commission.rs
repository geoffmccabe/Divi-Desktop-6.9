// Creator commission on secondary sales of a collection's items.
// See docs/NFD-CREATOR-COMMISSION.md. A flat DIVI toll per transfer, set by the
// collection creator and paid to a payout address. It IS built end-to-end: the
// on-chain COMMISSION-SET record (0x09) is encoded in `nfd_record.rs` and
// broadcast by `collectibles::set_commission`, and the vendored `nfd-indexer`
// enforces it — a transfer that does not pay the current toll is not a valid
// transfer, and a raise or a non-creator setter is rejected. This module is the
// WALLET-SIDE helper: it owns the DOWN-ONLY validation (Geoff, 2026-Oct-06 — the
// toll can be lowered but never raised, so a fixed DIVI fee can be relieved if
// DIVI's price climbs) and a local display cache (current + the first-ever
// `original` amount). The chain, not this cache, is the source of truth; see
// `nfd_scan::commission_of`.

use serde_json::json;
use std::path::{Path, PathBuf};

pub const DUFFS_PER_DIVI: u64 = 100_000_000;
/// Sanity ceiling so a typo can't set an absurd toll.
pub const MAX_COMMISSION_DUFFS: u64 = 1_000_000 * DUFFS_PER_DIVI;

#[derive(Clone, Debug, PartialEq)]
pub struct Commission {
    /// The first amount ever set for this collection (immutable). Shown next to
    /// the current amount so a holder/creator can see how far it has been lowered.
    pub original_duffs: u64,
    /// The current amount (<= original). This is what a transfer must pay.
    pub amount_duffs: u64,
    pub payout_address: String,
}

fn store_path(datadir: &Path) -> PathBuf {
    datadir.join("nfd_commission.json")
}
fn read_all(datadir: &Path) -> serde_json::Value {
    std::fs::read_to_string(store_path(datadir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}
fn is_collection_id(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn get(datadir: &Path, collection_id: &str) -> Option<Commission> {
    let all = read_all(datadir);
    let v = all.get(collection_id)?;
    let amount = v["amountDuffs"].as_u64()?;
    Some(Commission {
        original_duffs: v["originalDuffs"].as_u64().unwrap_or(amount), // back-compat: pre-original entries
        amount_duffs: amount,
        payout_address: v["payoutAddress"].as_str().unwrap_or("").to_string(),
    })
}

/// The DOWN-ONLY rule. `current` is `None` when nothing is set yet (the initial
/// set may be any value up to the cap); after that, a change must not exceed the
/// current amount.
pub fn validate(current: Option<u64>, next_duffs: u64) -> Result<(), String> {
    if next_duffs > MAX_COMMISSION_DUFFS {
        return Err("that commission is unreasonably high".to_string());
    }
    if let Some(cur) = current {
        if next_duffs > cur {
            return Err(format!(
                "the creator commission can only go down — it is {} DIVI now and cannot be raised",
                fmt_divi(cur)
            ));
        }
    }
    Ok(())
}

/// Set (or lower) the commission for a collection. Enforces the down-only rule.
/// A blank payout keeps the existing one.
pub fn set(datadir: &Path, collection_id: &str, next_duffs: u64, payout_address: &str) -> Result<Commission, String> {
    if !is_collection_id(collection_id) {
        return Err("bad collection id".to_string());
    }
    let existing = get(datadir, collection_id);
    validate(existing.as_ref().map(|c| c.amount_duffs), next_duffs)?;
    // The original is set once, on the first ever set, and never changes.
    let original = existing.as_ref().map(|c| c.original_duffs).unwrap_or(next_duffs);
    let payout = if payout_address.trim().is_empty() {
        existing.map(|c| c.payout_address).unwrap_or_default()
    } else {
        payout_address.trim().to_string()
    };
    let mut all = read_all(datadir);
    let obj = all.as_object_mut().ok_or("commission store corrupt")?;
    obj.insert(collection_id.to_string(), json!({ "originalDuffs": original, "amountDuffs": next_duffs, "payoutAddress": payout }));
    std::fs::create_dir_all(datadir).map_err(|e| e.to_string())?;
    std::fs::write(store_path(datadir), serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Commission { original_duffs: original, amount_duffs: next_duffs, payout_address: payout })
}

/// Whole-DIVI string for a duff amount (trims trailing zeros).
pub fn fmt_divi(duffs: u64) -> String {
    let whole = duffs / DUFFS_PER_DIVI;
    let frac = duffs % DUFFS_PER_DIVI;
    if frac == 0 {
        whole.to_string()
    } else {
        format!("{}.{:08}", whole, frac).trim_end_matches('0').to_string()
    }
}

pub fn divi_to_duffs(divi: f64) -> Result<u64, String> {
    if !divi.is_finite() || divi < 0.0 {
        return Err("amount must be zero or more".to_string());
    }
    let d = (divi * DUFFS_PER_DIVI as f64).round();
    if d > MAX_COMMISSION_DUFFS as f64 {
        return Err("that commission is unreasonably high".to_string());
    }
    Ok(d as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn down_only_rule() {
        // initial set: any value allowed
        assert!(validate(None, 500 * DUFFS_PER_DIVI).is_ok());
        // lowering: allowed
        assert!(validate(Some(500 * DUFFS_PER_DIVI), 250 * DUFFS_PER_DIVI).is_ok());
        // same: allowed
        assert!(validate(Some(500 * DUFFS_PER_DIVI), 500 * DUFFS_PER_DIVI).is_ok());
        // raising: rejected
        assert!(validate(Some(250 * DUFFS_PER_DIVI), 500 * DUFFS_PER_DIVI).is_err());
        // absurd: rejected
        assert!(validate(None, MAX_COMMISSION_DUFFS + 1).is_err());
    }

    #[test]
    fn divi_conversion_and_format() {
        assert_eq!(divi_to_duffs(1.0).unwrap(), DUFFS_PER_DIVI);
        assert_eq!(divi_to_duffs(0.5).unwrap(), DUFFS_PER_DIVI / 2);
        assert!(divi_to_duffs(-1.0).is_err());
        assert_eq!(fmt_divi(DUFFS_PER_DIVI), "1");
        assert_eq!(fmt_divi(DUFFS_PER_DIVI / 2), "0.5");
        assert_eq!(fmt_divi(0), "0");
    }

    #[test]
    fn set_persists_and_enforces_down_only() {
        let dir = std::env::temp_dir().join(format!("nfd_comm_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let cid = "ab".repeat(32);
        let c = set(&dir, &cid, 1000 * DUFFS_PER_DIVI, "DTestPayoutAddr").unwrap();
        assert_eq!(c.amount_duffs, 1000 * DUFFS_PER_DIVI);
        assert_eq!(c.original_duffs, 1000 * DUFFS_PER_DIVI);
        // lower it, keep payout (blank); original must not change
        let c2 = set(&dir, &cid, 400 * DUFFS_PER_DIVI, "").unwrap();
        assert_eq!(c2.amount_duffs, 400 * DUFFS_PER_DIVI);
        assert_eq!(c2.original_duffs, 1000 * DUFFS_PER_DIVI);
        assert_eq!(c2.payout_address, "DTestPayoutAddr");
        // cannot raise
        assert!(set(&dir, &cid, 900 * DUFFS_PER_DIVI, "").is_err());
        assert_eq!(get(&dir, &cid).unwrap().amount_duffs, 400 * DUFFS_PER_DIVI);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
