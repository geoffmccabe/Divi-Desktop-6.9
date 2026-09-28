// Phase 2 end-to-end on a private chain: an extra wallet receives coins,
// puts some into a vault staked by the node, the node registers the vault
// once the funding confirms, the address index shows the vaulted amount,
// and the wallet reclaims part of it as owner. Needs a regtest node with
// addressindex=1 at the given datadir.
use dd69_supervisor::{config::NodeConfig, wallet_vaults, wallets};
use serde_json::json;
use std::path::PathBuf;
use std::{thread, time::Duration};

fn main() {
    let datadir = PathBuf::from(std::env::args().nth(1).expect("datadir"));
    let cfg = NodeConfig::load_from(datadir.clone()).expect("cfg");
    let rpc = dd69_supervisor::rpc::RpcClient::new(&cfg);
    let node_id = "vsmoke";
    let _ = std::fs::remove_file(dd69_supervisor::config::dd69_datadir().join("wallets-vsmoke.json"));
    let made = wallets::create(node_id, "Savings", None, true).expect("create");
    let wid = made.wallet.id.clone();
    let addr = made.wallet.addresses[0].address.clone();
    println!("wallet address: {addr}");

    rpc.call("sendtoaddress", json!([addr, 10.0])).expect("fund");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    let bal = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance");
    println!("plain balance: {} DIVI", bal.divi);
    assert!((bal.divi - 10.0).abs() < 1e-8);

    let mgr = wallet_vaults::manager(&cfg).expect("manager");
    println!("manager (node staking address): {mgr}");
    let txid = wallet_vaults::fund(&cfg, node_id, &wid, &addr, Some(6.0), None, true).expect("fund vault");
    println!("vault funded by {txid}");
    let pending = wallets::load(node_id).wallets[0].addresses[0].vault_pending.len();
    println!("pending registrations before mining: {pending}");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    let n = wallet_vaults::settle(&cfg, node_id, &wid).expect("settle");
    println!("registered with the node: {n}");
    assert_eq!(n, 1, "addvault should accept the confirmed funding");

    let vb = wallet_vaults::balances(&cfg, &wallets::load(node_id).wallets[0]).expect("vault balances");
    println!("vaulted: {:?}", vb);
    assert!((vb[0].1 - 6.0).abs() < 1e-8, "address index should show 6 DIVI in the vault");
    let plain = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance");
    println!("plain after vaulting: {} DIVI (10 - 6 - fee)", plain.divi);
    assert!(plain.divi < 4.0 && plain.divi > 3.99);

    let listed = rpc.call("getcoinavailability", json!([true])).expect("avail");
    let seen = listed["Stakable"]["AllVaults"].as_array().map(|a| a.iter().any(|v| v["vault"].as_str().map(|s| s.starts_with(&addr)).unwrap_or(false))).unwrap_or(false);
    println!("node lists the vault under Stakable (staked for an outside owner): {seen}");
    assert!(seen, "node should list the vault under AllVaults");

    let out = wallet_vaults::reclaim(&cfg, node_id, &wid, &addr, None, Some(2.0), None, true).expect("reclaim");
    println!("reclaimed 2 DIVI as owner: {out}");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    let vb2 = wallet_vaults::balances(&cfg, &wallets::load(node_id).wallets[0]).expect("vault balances");
    let plain2 = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance");
    println!("vaulted after: {} DIVI, plain after: {} DIVI", vb2[0].1, plain2.divi);
    assert!(vb2[0].1 < 4.0 && vb2[0].1 > 3.99, "4 minus fee should remain in the vault");
    assert!(plain2.divi > 5.99, "2 DIVI should be back as plain coins");

    let all = wallet_vaults::reclaim(&cfg, node_id, &wid, &addr, None, None, None, true).expect("reclaim all");
    println!("reclaimed the rest: {all}");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    let vb3 = wallet_vaults::balances(&cfg, &wallets::load(node_id).wallets[0]).expect("vault balances");
    println!("vaulted at the end: {} DIVI", vb3[0].1);
    assert!(vb3[0].1.abs() < 1e-8);

    // Sending more than the plain coins: the wallet spends vault coins as
    // owner and the remainder goes back into the vault.
    let plain_before = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance").divi;
    wallet_vaults::fund(&cfg, node_id, &wid, &addr, Some(4.0), None, true).expect("fund vault again");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    wallet_vaults::settle(&cfg, node_id, &wid).expect("settle");
    let plain_now = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance").divi;
    println!("plain {plain_before} -> {plain_now}, vaulted 4");
    let want = plain_now + 1.0;
    let back = rpc.call("getnewaddress", json!([])).expect("addr").as_str().unwrap().to_string();
    let tx = wallets::send(&cfg, node_id, &wid, &back, want, None, true).expect("send using vault coins");
    println!("sent {want} DIVI (more than the plain coins) in {tx}");
    rpc.call("setgenerate", json!([1])).expect("mine");
    thread::sleep(Duration::from_secs(2));
    let vb4 = wallet_vaults::balances(&cfg, &wallets::load(node_id).wallets[0]).expect("vault balances");
    let plain4 = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance").divi;
    println!("after: plain {plain4}, vaulted {}", vb4[0].1);
    assert!(plain4.abs() < 1e-8, "all plain coins should have been used first");
    assert!(vb4[0].1 > 2.99 && vb4[0].1 < 3.0, "about 3 DIVI (4 - 1 - fee) should be back in the vault");
    println!("OK");
}
