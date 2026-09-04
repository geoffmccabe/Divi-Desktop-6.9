// Fee / treasury configuration (see Divi-Blockchain_6.9/docs/TREASURY-AND-FEES.md).
//
// A fee is paid TO a public treasury address as an extra output — no key ever
// lives here. This module only stores the public address + per-action amounts.
//
// ── Honest limitation (security audit) ──────────────────────────────────────
// Client-side fees are ADVISORY. This is open-source software: a modified wallet
// can set the fee to 0 or redirect it, and local malware can rewrite the config.
// Only CONSENSUS can make a fee mandatory — that arrives with the OP_NFD soft
// fork, where the indexer/network treats a mint lacking the required fee-output
// to the canonical treasury as not a valid NFD. Until then the official build
// charges the fee via the compiled-in canonical default below; the JSON config
// is only a convenience OVERRIDE for the founder, not an authoritative source.

use crate::config::NodeConfig;
use serde_json::json;
use std::path::{Path, PathBuf};

/// Compiled-in canonical treasury (the official build's default). SET AT BUILD:
/// fill with the founder's public treasury address to ship fees on by default.
/// Empty = fees off until configured.
pub const DEFAULT_TREASURY_ADDRESS: &str = "";
/// Compiled-in default NFD mint fee (DIVI). 0 = no fee.
pub const DEFAULT_NFD_MINT_FEE: f64 = 0.0;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeeConfig {
    /// Public treasury address fees are paid to. Empty = fees disabled.
    pub treasury_address: String,
    /// NFD mint fee in DIVI (0 = no fee).
    pub nfd_mint: f64,
}

impl FeeConfig {
    fn path(datadir: &Path) -> PathBuf {
        datadir.join("nfd_fee_config.json")
    }

    /// The compiled-in canonical default.
    pub fn compiled_default() -> FeeConfig {
        FeeConfig { treasury_address: DEFAULT_TREASURY_ADDRESS.to_string(), nfd_mint: DEFAULT_NFD_MINT_FEE }
    }

    /// Load: the founder's on-disk override if present, else the compiled default.
    pub fn load(cfg: &NodeConfig) -> FeeConfig {
        let Ok(text) = std::fs::read_to_string(Self::path(&cfg.datadir)) else {
            return Self::compiled_default();
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            return Self::compiled_default();
        };
        FeeConfig {
            treasury_address: v["treasuryAddress"].as_str().unwrap_or("").to_string(),
            nfd_mint: v["nfdMint"].as_f64().unwrap_or(0.0),
        }
    }

    pub fn save(&self, cfg: &NodeConfig) -> Result<(), String> {
        // validate + normalise the amount so a bad value never reaches a tx
        if !self.nfd_mint.is_finite() || self.nfd_mint < 0.0 {
            return Err("fee must be a non-negative number".into());
        }
        let nfd_mint = (self.nfd_mint * 1e8).round() / 1e8; // round to duffs
        let v = json!({ "treasuryAddress": self.treasury_address.trim(), "nfdMint": nfd_mint });
        let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
        std::fs::write(Self::path(&cfg.datadir), text).map_err(|e| e.to_string())
    }

    /// The NFD mint fee output (treasury address, amount) if fees are configured;
    /// None when disabled (no address, or 0 amount).
    pub fn nfd_mint_fee(&self) -> Option<(String, f64)> {
        if !self.treasury_address.trim().is_empty() && self.nfd_mint.is_finite() && self.nfd_mint > 0.0 {
            Some((self.treasury_address.trim().to_string(), self.nfd_mint))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_by_default() {
        assert_eq!(FeeConfig::default().nfd_mint_fee(), None);
        assert_eq!(FeeConfig::compiled_default().nfd_mint_fee(), None); // empty default addr
        let c = FeeConfig { treasury_address: "yABC".into(), nfd_mint: 0.0 };
        assert_eq!(c.nfd_mint_fee(), None);
        let c = FeeConfig { treasury_address: String::new(), nfd_mint: 1.0 };
        assert_eq!(c.nfd_mint_fee(), None);
    }

    #[test]
    fn enabled_when_both_set() {
        let c = FeeConfig { treasury_address: "yTREASURY".into(), nfd_mint: 2.5 };
        assert_eq!(c.nfd_mint_fee(), Some(("yTREASURY".into(), 2.5)));
    }

    #[test]
    fn rejects_bad_amounts_at_nfd_mint_fee() {
        assert_eq!(FeeConfig { treasury_address: "y".into(), nfd_mint: f64::NAN }.nfd_mint_fee(), None);
        assert_eq!(FeeConfig { treasury_address: "y".into(), nfd_mint: -1.0 }.nfd_mint_fee(), None);
    }
}
