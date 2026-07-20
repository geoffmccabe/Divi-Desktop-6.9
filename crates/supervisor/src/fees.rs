// Fee / treasury configuration (see Divi-Blockchain_6.9/docs/TREASURY-AND-FEES.md).
//
// A fee is paid TO a public treasury address as an extra output — no key ever
// lives here. This module only stores the public address + per-action amounts,
// persisted as JSON in the node datadir. Fees default to DISABLED (empty address
// / 0 amount) so a misconfigured build never sends fees anywhere wrong.

use crate::config::NodeConfig;
use serde_json::json;
use std::path::{Path, PathBuf};

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

    pub fn load(cfg: &NodeConfig) -> FeeConfig {
        let default = FeeConfig::default();
        let Ok(text) = std::fs::read_to_string(Self::path(&cfg.datadir)) else {
            return default;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            return default;
        };
        FeeConfig {
            treasury_address: v["treasuryAddress"].as_str().unwrap_or("").to_string(),
            nfd_mint: v["nfdMint"].as_f64().unwrap_or(0.0),
        }
    }

    pub fn save(&self, cfg: &NodeConfig) -> Result<(), String> {
        let v = json!({ "treasuryAddress": self.treasury_address, "nfdMint": self.nfd_mint });
        let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
        std::fs::write(Self::path(&cfg.datadir), text).map_err(|e| e.to_string())
    }

    /// The NFD mint fee output (treasury address, amount) if fees are configured;
    /// None when disabled (no address, or 0 amount).
    pub fn nfd_mint_fee(&self) -> Option<(String, f64)> {
        if !self.treasury_address.is_empty() && self.nfd_mint > 0.0 {
            Some((self.treasury_address.clone(), self.nfd_mint))
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
        // address set but 0 amount -> still disabled
        let c = FeeConfig { treasury_address: "yABC".into(), nfd_mint: 0.0 };
        assert_eq!(c.nfd_mint_fee(), None);
        // amount set but no address -> disabled
        let c = FeeConfig { treasury_address: String::new(), nfd_mint: 1.0 };
        assert_eq!(c.nfd_mint_fee(), None);
    }

    #[test]
    fn enabled_when_both_set() {
        let c = FeeConfig { treasury_address: "yTREASURY".into(), nfd_mint: 2.5 };
        assert_eq!(c.nfd_mint_fee(), Some(("yTREASURY".into(), 2.5)));
    }
}
