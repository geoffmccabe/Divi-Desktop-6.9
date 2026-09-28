//! On-chain Divi vaults over the node RPC.
//!
//! A vault has two keys: the OWNER (keeps custody, can reclaim/spend) and the
//! MANAGER (the always-on staking node, which may stake the coins but can never
//! spend them). An extra wallet "vaults to the main node" by funding a vault
//! whose owner is its own address and whose manager is the main node's staking
//! address. The main node then stakes those coins while the owner keeps full
//! control and can reclaim them at any time.
//!
//! Daemon commands used (see Divi-Blockchain_6.9/divi/src): fundvault and
//! reclaimvaultfunds (rpcwallet.cpp), and getcoinavailability (rpcwallet.cpp)
//! for the vaulted total. fundvault and reclaimvaultfunds MOVE money, so the
//! wallet must already be unlocked by the normal unlock flow before they run.
//! This module never handles the passphrase.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

/// Fund a vault: move `amount` DIVI into a vault owned by `owner_address` and
/// managed (staked) by `manager_address`. Returns the funding txid.
///
/// Maps to: fundvault "owner_address:manager_address" amount
pub fn fund_vault(
    cfg: &NodeConfig,
    owner_address: &str,
    manager_address: &str,
    amount: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let encoding = format!("{}:{}", owner_address, manager_address);
    let res = rpc.call("fundvault", json!([encoding, amount]))?;
    res["txhash"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "the node did not return a vault funding txid".into())
}

/// Reclaim `amount` DIVI from the wallet's vaults back to `destination` (an
/// address the owner controls). Only the vault owner can do this.
///
/// Maps to: reclaimvaultfunds destination amount
pub fn reclaim_vault_funds(
    cfg: &NodeConfig,
    destination: &str,
    amount: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let res = rpc.call("reclaimvaultfunds", json!([destination, amount]))?;
    res.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "the node did not return a reclaim txid".into())
}

/// How much of this wallet's own coins are sitting in vaults, in DIVI.
///
/// Maps to: getcoinavailability -> "Vaulted". This is the owner's vaulted
/// total for the wallet the node currently has loaded.
pub fn vaulted_balance(cfg: &NodeConfig) -> Result<f64, String> {
    let rpc = RpcClient::new(cfg);
    let res = rpc.call("getcoinavailability", json!([]))?;
    Ok(res["Vaulted"].as_f64().unwrap_or(0.0))
}

/// This wallet's individual vaults, each as (encoding, amount) where encoding
/// is "owner:manager" and amount is the DIVI held in that vault. Lets a feature
/// (side wallets, HRAs) enumerate exactly which vaults exist and how much is in
/// each, and target one for a withdrawal via debit_vault_by_name.
///
/// Maps to: getcoinavailability true -> Vaulted.AllVaults[] ({vault, value}).
pub fn list_vaults(cfg: &NodeConfig) -> Result<Vec<(String, f64)>, String> {
    let rpc = RpcClient::new(cfg);
    let res = rpc.call("getcoinavailability", json!([true]))?;
    let mut out = Vec::new();
    if let Some(arr) = res["Vaulted"]["AllVaults"].as_array() {
        for v in arr {
            if let Some(enc) = v["vault"].as_str() {
                out.push((enc.to_string(), v["value"].as_f64().unwrap_or(0.0)));
            }
        }
    }
    Ok(out)
}

/// Withdraw `amount` DIVI from ONE specific vault (identified by its
/// "owner:manager" encoding) to `destination`. Use this when a feature needs to
/// reclaim from a particular vault rather than across all of the wallet's.
///
/// Maps to: debitvaultbyname "owner:manager" destination amount
pub fn debit_vault_by_name(
    cfg: &NodeConfig,
    vault_encoding: &str,
    destination: &str,
    amount: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let res = rpc.call("debitvaultbyname", json!([vault_encoding, destination, amount]))?;
    res.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "the node did not return a withdrawal txid".into())
}

/// The default vault MANAGER address: the main node's stable, owned account
/// address (the coins vaulted to it are staked by this node).
///
/// This is the handshake the multi-wallet feature reads so an extra wallet
/// knows what to vault to. When that feature introduces an explicit "main
/// wallet" concept, point this at that wallet's staking address instead; the
/// rest of the vault flow is unchanged.
pub fn manager_address(cfg: &NodeConfig) -> Option<String> {
    let rpc = RpcClient::new(cfg);
    rpc.call("getaccountaddress", json!([""]))
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}
