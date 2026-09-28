//! Vault staking for the app's extra wallets (docs/PARALLEL-WALLETS-PLAN.md,
//! Phase 2), built on the node's vault primitive (`vault.rs`, read from the
//! node source in `divi-core-nossl`).
//!
//! A vault is a bare script with two keys: the OWNER (an extra wallet's
//! address; its key lives in this app) keeps custody and can reclaim, the
//! MANAGER (the node's staking address) may only stake. Consensus sends the
//! stake reward, and any lottery win, back to the vault script itself, so
//! everything earned stays owned by the wallet that funded it. The address
//! index files vault coins under the owner's key (type 3), which is how
//! balances and reclaim find them.
//!
//! The node's `fundvault` spends the NODE's coins, and `reclaimvaultfunds`
//! signs with keys the node holds; neither fits a wallet whose key is here.
//! So funding and reclaim are raw transactions signed with the wallet's own
//! key for one call (`signrawtransaction` with the key in the parameter list,
//! as `wallets::send` does), and `addvault` tells the node to stake a vault
//! once its funding is in a block.

use crate::base58;
use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use crate::vault;
use crate::wallets::{self, Utxo, WalletEntry};
use serde_json::json;

const OP_IF: u8 = 0x63;
const OP_ELSE: u8 = 0x67;
const OP_ENDIF: u8 = 0x68;
const OP_OVER: u8 = 0x78;
const OP_HASH160: u8 = 0xa9;
const OP_EQUALVERIFY: u8 = 0x88;
const OP_CHECKSIG: u8 = 0xac;
const OP_REQUIRE_COINSTAKE: u8 = 0xb9;

/// The node's STAKING_VAULT template, byte for byte:
/// `OP_IF <owner> OP_ELSE OP_REQUIRE_COINSTAKE <manager> OP_ENDIF OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG`.
pub fn vault_script(owner: &[u8; 20], manager: &[u8; 20]) -> Vec<u8> {
    let mut s = Vec::with_capacity(50);
    s.push(OP_IF);
    s.push(20);
    s.extend_from_slice(owner);
    s.push(OP_ELSE);
    s.push(OP_REQUIRE_COINSTAKE);
    s.push(20);
    s.extend_from_slice(manager);
    s.push(OP_ENDIF);
    s.extend_from_slice(&[OP_OVER, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG]);
    s
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn pkh(address: &str, testnet: bool) -> Result<[u8; 20], String> {
    let (kind, h) = base58::address_to_payload(address, testnet).ok_or("not a Divi address for this network")?;
    if kind != base58::KIND_P2PKH {
        return Err("a vault needs a plain (key) address, not a script address".into());
    }
    Ok(h)
}

/// The node's staking address, which every vault names as manager.
pub fn manager(cfg: &NodeConfig) -> Result<String, String> {
    vault::manager_address(cfg).ok_or_else(|| "the node did not say its staking address".to_string())
}

/// DIVI sitting in vaults owned by each of the wallet's addresses.
pub fn balances(cfg: &NodeConfig, w: &WalletEntry) -> Result<Vec<(String, f64)>, String> {
    let rpc = RpcClient::new(cfg);
    let mut out = Vec::new();
    for a in &w.addresses {
        let v = rpc.call("getaddressbalance", json!([{ "addresses": [a.address] }, true]))?;
        let sat = v["balance"].as_i64().unwrap_or(0);
        out.push((a.address.clone(), sat as f64 / 100_000_000.0));
    }
    Ok(out)
}

fn sign_and_send(rpc: &RpcClient, raw: &str, prev: Vec<serde_json::Value>, keys: Vec<String>) -> Result<String, String> {
    let signed = rpc.call("signrawtransaction", json!([raw, prev, keys]))?;
    if !signed["complete"].as_bool().unwrap_or(false) {
        return Err("the transaction could not be fully signed".into());
    }
    let hex = signed["hex"].as_str().ok_or("no signed transaction")?.to_string();
    let txid = rpc.call("sendrawtransaction", json!([hex]))?;
    Ok(txid.as_str().unwrap_or("").to_string())
}

/// Plain (non-vault) DIVI at one address, through the address index.
fn plain_balance(rpc: &RpcClient, address: &str) -> Result<f64, String> {
    let v = rpc.call("getaddressbalance", json!([{ "addresses": [address] }]))?;
    Ok(v["balance"].as_i64().unwrap_or(0) as f64 / 100_000_000.0)
}

/// Move `amount` DIVI (None = everything) of `address`'s plain coins into a
/// vault owned by that address and staked by the node. Change returns to the
/// same address. The funding txid is remembered so `settle` can register it
/// with the node once it confirms.
pub fn fund(cfg: &NodeConfig, node_id: &str, wallet_id: &str, address: &str, amount: Option<f64>, password: Option<&str>, testnet: bool) -> Result<String, String> {
    if let Some(a) = amount {
        if !(a > 0.0) || !a.is_finite() {
            return Err("Enter an amount.".into());
        }
    }
    let mut store = wallets::load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let entry_index = w.addresses.iter().position(|a| a.address == address).ok_or("that address is not in this wallet")?;
    let seed = wallets::unlock_seed(w, password)?;
    let key = wallets::derive(&seed, w.addresses[entry_index].index, testnet)?;
    let rpc = RpcClient::new(cfg);
    let mgr = manager(cfg)?;
    let script = vault_script(&pkh(address, testnet)?, &pkh(&mgr, testnet)?);

    let v = rpc.call("getaddressutxos", json!([{ "addresses": [address] }]))?;
    let mut utxos: Vec<Utxo> = serde_json::from_value(v).map_err(|_| "could not read the address's coins")?;
    utxos.sort_by(|a, b| b.satoshis.cmp(&a.satoshis));
    let mut inputs: Vec<&Utxo> = Vec::new();
    let mut have: i64 = 0;
    let mut fee_sat: i64 = 0;
    let want_sat: i64;
    match amount {
        Some(a) => {
            want_sat = (a * 100_000_000.0).round() as i64;
            for u in &utxos {
                inputs.push(u);
                have += u.satoshis;
                fee_sat = (crate::dvxp::size_fee(inputs.len(), 2, 0, crate::dvxp::MIN_FEE_DIVI) * 100_000_000.0).round() as i64;
                if have >= want_sat + fee_sat {
                    break;
                }
            }
            if have < want_sat + fee_sat {
                return Err(format!("Not enough plain coins at this address: {} DIVI available.", have as f64 / 100_000_000.0));
            }
        }
        None => {
            inputs = utxos.iter().collect();
            have = inputs.iter().map(|u| u.satoshis).sum();
            fee_sat = (crate::dvxp::size_fee(inputs.len(), 1, 0, crate::dvxp::MIN_FEE_DIVI) * 100_000_000.0).round() as i64;
            want_sat = have - fee_sat;
            if inputs.is_empty() || want_sat <= 0 {
                return Err("Nothing at this address to put in the vault.".into());
            }
        }
    }
    let change_sat = have - want_sat - fee_sat;
    let ins: Vec<serde_json::Value> = inputs.iter().map(|u| json!({ "txid": u.txid, "vout": u.output_index })).collect();
    let mut outs = serde_json::Map::new();
    outs.insert(hex(&script), json!(want_sat as f64 / 100_000_000.0));
    if change_sat > 0 {
        outs.insert(address.to_string(), json!(change_sat as f64 / 100_000_000.0));
    }
    let raw = rpc.call("createrawtransaction", json!([ins, outs]))?;
    let raw = raw.as_str().ok_or("the node did not build the transaction")?.to_string();
    let prev: Vec<serde_json::Value> = inputs.iter().map(|u| json!({ "txid": u.txid, "vout": u.output_index, "scriptPubKey": u.script })).collect();
    let txid = sign_and_send(&rpc, &raw, prev, vec![wallets::wif(&key, testnet)])?;

    w.addresses[entry_index].vault_pending.push(txid.clone());
    wallets::save(node_id, &store)?;
    // A same-block registration succeeds only once the funding is mined;
    // try now anyway so an already-fast chain needs no second step.
    let _ = settle(cfg, node_id, wallet_id);
    Ok(txid)
}

/// The automatic part of the "vault staking" tick: for every address that
/// wants it, in every wallet the app can open without a password, move plain
/// coins of at least `AUTO_MIN_DIVI` into the vault. Skips an address whose
/// last funding is still unregistered, so one deposit never becomes two
/// vault transactions. Returns the funding txids it broadcast.
pub const AUTO_MIN_DIVI: f64 = 1.0;
pub fn auto_sweep(cfg: &NodeConfig, node_id: &str, testnet: bool) -> Vec<String> {
    let store = wallets::load(node_id);
    let rpc = RpcClient::new(cfg);
    let mut out = Vec::new();
    for w in &store.wallets {
        if w.lock == "password" {
            continue;
        }
        for a in &w.addresses {
            if !a.vault || !a.vault_pending.is_empty() {
                continue;
            }
            let plain = match plain_balance(&rpc, &a.address) { Ok(p) => p, Err(_) => continue };
            if plain < AUTO_MIN_DIVI {
                continue;
            }
            if let Ok(txid) = fund(cfg, node_id, &w.id, &a.address, None, None, testnet) {
                out.push(txid);
            }
        }
    }
    out
}

/// Tell the node to stake every vault whose funding has confirmed. Safe to
/// call often; it only clears entries the node accepted.
pub fn settle(cfg: &NodeConfig, node_id: &str, wallet_id: &str) -> Result<usize, String> {
    let mut store = wallets::load(node_id);
    let w = store.wallets.iter_mut().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    if w.addresses.iter().all(|a| a.vault_pending.is_empty()) {
        return Ok(0);
    }
    let rpc = RpcClient::new(cfg);
    let mgr = manager(cfg)?;
    let mut done = 0;
    for a in w.addresses.iter_mut() {
        let encoding = format!("{}:{}", a.address, mgr);
        a.vault_pending.retain(|txid| {
            let ok = rpc
                .call("addvault", json!([encoding, txid]))
                .ok()
                .and_then(|r| r["succeeded"].as_bool())
                .unwrap_or(false);
            if ok {
                done += 1;
            }
            !ok
        });
    }
    if done > 0 {
        wallets::save(node_id, &store)?;
    }
    Ok(done)
}

/// Take coins back out of `address`'s vault to `to` (the address itself by
/// default). `amount` None = everything. Signed as the owner.
pub fn reclaim(cfg: &NodeConfig, node_id: &str, wallet_id: &str, address: &str, to: Option<&str>, amount: Option<f64>, password: Option<&str>, testnet: bool) -> Result<String, String> {
    let store = wallets::load(node_id);
    let w = store.wallets.iter().find(|w| w.id == wallet_id).ok_or("no such wallet")?;
    let entry = w.addresses.iter().find(|a| a.address == address).ok_or("that address is not in this wallet")?;
    let seed = wallets::unlock_seed(w, password)?;
    let key = wallets::derive(&seed, entry.index, testnet)?;
    let rpc = RpcClient::new(cfg);
    let to = to.unwrap_or(address);
    rpc.call("validateaddress", json!([to])).ok().and_then(|v| v["isvalid"].as_bool()).filter(|b| *b).ok_or("That is not a Divi address.")?;

    let v = rpc.call("getaddressutxos", json!([{ "addresses": [address] }, true]))?;
    let mut utxos: Vec<Utxo> = serde_json::from_value(v).map_err(|_| "could not read the vault's coins")?;
    utxos.retain(|u| u.script.len() == 100 && u.script.starts_with("6314"));
    if utxos.is_empty() {
        return Err("This address has nothing in a vault.".into());
    }
    utxos.sort_by(|a, b| b.satoshis.cmp(&a.satoshis));
    let total: i64 = utxos.iter().map(|u| u.satoshis).sum();
    let inputs: Vec<&Utxo>;
    let want_sat: i64;
    let fee_sat: i64;
    match amount {
        None => {
            inputs = utxos.iter().collect();
            fee_sat = (crate::dvxp::size_fee(inputs.len(), 1, 0, crate::dvxp::MIN_FEE_DIVI) * 100_000_000.0).round() as i64;
            want_sat = total - fee_sat;
            if want_sat <= 0 {
                return Err("The vault holds less than the network fee.".into());
            }
        }
        Some(a) => {
            if !(a > 0.0) || !a.is_finite() {
                return Err("Enter an amount.".into());
            }
            want_sat = (a * 100_000_000.0).round() as i64;
            let mut picked: Vec<&Utxo> = Vec::new();
            let mut have = 0i64;
            let mut fee = 0i64;
            for u in &utxos {
                picked.push(u);
                have += u.satoshis;
                fee = (crate::dvxp::size_fee(picked.len(), 2, 0, crate::dvxp::MIN_FEE_DIVI) * 100_000_000.0).round() as i64;
                if have >= want_sat + fee {
                    break;
                }
            }
            if have < want_sat + fee {
                return Err(format!("The vault holds {} DIVI.", total as f64 / 100_000_000.0));
            }
            inputs = picked;
            fee_sat = fee;
        }
    }
    let have: i64 = inputs.iter().map(|u| u.satoshis).sum();
    let change_sat = have - want_sat - fee_sat;
    let ins: Vec<serde_json::Value> = inputs.iter().map(|u| json!({ "txid": u.txid, "vout": u.output_index })).collect();
    let mut outs = serde_json::Map::new();
    outs.insert(to.to_string(), json!(want_sat as f64 / 100_000_000.0));
    if change_sat > 0 {
        // What is not taken out goes straight back into the same vault.
        outs.insert(inputs[0].script.clone(), json!(change_sat as f64 / 100_000_000.0));
    }
    let raw = rpc.call("createrawtransaction", json!([ins, outs]))?;
    let raw = raw.as_str().ok_or("the node did not build the transaction")?.to_string();
    let prev: Vec<serde_json::Value> = inputs.iter().map(|u| json!({ "txid": u.txid, "vout": u.output_index, "scriptPubKey": u.script })).collect();
    sign_and_send(&rpc, &raw, prev, vec![wallets::wif(&key, testnet)])
}

#[cfg(test)]
mod tests {
    use super::*;

    // Must match the node's STAKING_VAULT macro exactly: 100 hex chars,
    // owner hash at bytes 2..22 (where the address index reads it).
    #[test]
    fn vault_script_matches_node_template() {
        let s = vault_script(&[1u8; 20], &[2u8; 20]);
        assert_eq!(s.len(), 50);
        assert_eq!(s[0], OP_IF);
        assert_eq!(s[1], 20);
        assert_eq!(&s[2..22], &[1u8; 20]);
        assert_eq!(s[22], OP_ELSE);
        assert_eq!(s[23], OP_REQUIRE_COINSTAKE);
        assert_eq!(s[24], 20);
        assert_eq!(&s[25..45], &[2u8; 20]);
        assert_eq!(&s[45..], &[OP_ENDIF, OP_OVER, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG]);
        assert!(hex(&s).starts_with("6314"));
        assert_eq!(hex(&s).len(), 100);
    }
}
