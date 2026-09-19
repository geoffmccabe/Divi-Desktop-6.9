//! Proof that buying a name works, using TWO wallets on a shared chain.
//!
//! The single-wallet smoke test cannot cover this: an owner is forbidden from
//! buying their own name, deliberately, so a wash sale cannot fake a price.
//! That left the one flow where money changes hands between strangers as the
//! only untested part of the market. This closes it.
//!
//! Both nodes must be on the same regtest chain, both with `txindex=1`:
//!
//!   divid -datadir=~/divi-fastsend-regtest  -daemon
//!   divid -datadir=~/divi-fastsend-regtest2 -daemon   (connects to the first)
//!
//!   DIVI_NAMES_TREASURY=<addr> DIVI_NAMES_RESERVE=<addr> \
//!     cargo run --example names_buy_smoke -- ~/divi-fastsend-regtest ~/divi-fastsend-regtest2
//!
//! ⚠ Regtest only.

use dd69_supervisor::config::NodeConfig;
use dd69_supervisor::names;
use dd69_supervisor::rpc::RpcClient;
use serde_json::json;
use std::path::PathBuf;

fn step(n: u32, what: &str) {
    println!("\n── {n}. {what} ────────────────────────────────");
}

fn mine(rpc: &RpcClient, blocks: u32) -> Result<(), String> {
    rpc.call("setgenerate", json!([blocks]))?;
    Ok(())
}

/// Both indexes must reach the tip, or one side is reasoning about stale state.
fn sync_both(a: &NodeConfig, b: &NodeConfig) -> Result<(), String> {
    for cfg in [a, b] {
        for _ in 0..400 {
            let s = names::sync(cfg)?;
            if !s.activated || !s.txindex || !s.treasury_configured {
                return Err(s.note);
            }
            if s.caught_up {
                break;
            }
        }
    }
    Ok(())
}

/// Wait for the second node to see the first node's block height.
fn wait_in_step(a: &RpcClient, b: &RpcClient) -> Result<u64, String> {
    let target = a.call("getblockcount", json!([]))?.as_u64().unwrap_or(0);
    for _ in 0..120 {
        let h = b.call("getblockcount", json!([]))?.as_u64().unwrap_or(0);
        if h >= target {
            return Ok(h);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Err("the two nodes never came into step; check they are connected".into())
}

/// Wait for a transaction broadcast on one node to reach the other's mempool.
///
/// Without this the miner can produce its block before the purchase has
/// crossed the link, leaving the transaction unconfirmed and the test blaming
/// the product for what is really a race in the harness.
fn wait_for_relay(rpc: &RpcClient, txid: &str) -> Result<(), String> {
    for _ in 0..120 {
        if let Ok(pool) = rpc.call("getrawmempool", json!([])) {
            if pool.as_array().map(|a| a.iter().any(|t| t.as_str() == Some(txid))).unwrap_or(false) {
                return Ok(());
            }
        }
        // Already mined is also fine.
        if let Ok(tx) = rpc.call("getrawtransaction", json!([txid, 1])) {
            if tx["confirmations"].as_i64().unwrap_or(0) > 0 {
                return Ok(());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Err(format!("{txid} never reached the mining node"))
}

fn main() {
    if let Err(e) = run() {
        eprintln!("\nFAILED: {e}");
        std::process::exit(1);
    }
    println!("\nALL STEPS PASSED");
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let dir_a: PathBuf = args.next().map(PathBuf::from).ok_or("usage: names_buy_smoke <seller-datadir> <buyer-datadir>")?;
    let dir_b: PathBuf = args.next().map(PathBuf::from).ok_or("usage: names_buy_smoke <seller-datadir> <buyer-datadir>")?;

    let seller = NodeConfig::load_from(dir_a)?;
    let buyer = NodeConfig::load_from(dir_b)?;
    let rpc_a = RpcClient::new(&seller);
    let rpc_b = RpcClient::new(&buyer);

    let chain = rpc_a.call("getblockchaininfo", json!([]))?["chain"].as_str().unwrap_or("main").to_string();
    if chain == "main" {
        return Err("refusing to run against mainnet".into());
    }
    std::env::var("DIVI_NAMES_TREASURY").map_err(|_| "set DIVI_NAMES_TREASURY")?;
    std::env::var("DIVI_NAMES_RESERVE").map_err(|_| "set DIVI_NAMES_RESERVE")?;

    step(1, "both nodes are on the same chain and connected");
    let tip = wait_in_step(&rpc_a, &rpc_b)?;
    println!("   both at height {tip}");
    let hash_a = rpc_a.call("getblockhash", json!([tip]))?;
    let hash_b = rpc_b.call("getblockhash", json!([tip]))?;
    if hash_a != hash_b {
        return Err("the nodes disagree about the chain; they are not peered".into());
    }
    println!("   same block hash at the tip, so this is one chain");

    step(2, "make sure the buyer has money of their own");
    let buyer_addr = rpc_b.call("getnewaddress", json!([]))?.as_str().ok_or("no address")?.to_string();
    rpc_a.call("sendtoaddress", json!([buyer_addr, 60_000.0]))?;
    mine(&rpc_a, 2)?;
    wait_in_step(&rpc_a, &rpc_b)?;
    let bal = rpc_b.call("getbalance", json!([]))?.as_f64().unwrap_or(0.0);
    println!("   buyer holds {bal} DIVI");
    if bal < 20_000.0 {
        return Err(format!("the buyer needs more than {bal} DIVI to run this"));
    }

    step(3, "the seller registers a name");
    let name = format!("TRADE{tip}");
    sync_both(&seller, &buyer)?;
    names::commit(&seller, &name)?;
    mine(&rpc_a, 13)?;
    wait_in_step(&rpc_a, &rpc_b)?;
    sync_both(&seller, &buyer)?;
    names::register(&seller, &name)?;
    mine(&rpc_a, 1)?;
    wait_in_step(&rpc_a, &rpc_b)?;
    sync_both(&seller, &buyer)?;
    let owned = names::my_names(&seller)?;
    let held = owned.iter().find(|n| n.name == name.to_uppercase()).ok_or("the seller does not own the name")?;
    let seller_addr = held.owner.clone();
    println!("   {} owned by {seller_addr}", name.to_lowercase());

    step(4, "the buyer can see it, and knows it is not theirs");
    if names::my_names(&buyer)?.iter().any(|n| n.name == name.to_uppercase()) {
        return Err("the buyer thinks they own the seller's name".into());
    }
    match names::buy(&buyer, &name) {
        Ok(_) => return Err("buying an unlisted name was allowed".into()),
        Err(e) => println!("   not for sale yet, correctly refused: {e}"),
    }

    step(5, "the seller lists it");
    let price = 4_321.0;
    names::list_for_sale(&seller, &name, price, 60)?;
    mine(&rpc_a, 1)?;
    wait_in_step(&rpc_a, &rpc_b)?;
    sync_both(&seller, &buyer)?;
    let listing = names::market(&buyer)?.into_iter().find(|l| l.name == name.to_uppercase())
        .ok_or("the buyer cannot see the listing")?;
    println!("   buyer sees it at {} DIVI, is_mine={}", listing.price_divi, listing.is_mine);
    if listing.is_mine {
        return Err("the buyer thinks the seller's listing is their own".into());
    }

    step(6, "the seller cannot buy their own name");
    match names::buy(&seller, &name) {
        Ok(_) => return Err("a wash sale was allowed".into()),
        Err(e) => println!("   correctly refused: {e}"),
    }

    step(7, "the buyer pays, and the name moves");
    let before = rpc_a
        .call("getreceivedbyaddress", json!([seller_addr, 0]))?
        .as_f64()
        .unwrap_or(0.0);
    let txid = names::buy(&buyer, &name)?;
    println!("   purchase txid {txid}");
    wait_for_relay(&rpc_a, &txid)?;
    println!("   reached the mining node");
    mine(&rpc_a, 1)?;
    wait_in_step(&rpc_a, &rpc_b)?;
    sync_both(&seller, &buyer)?;

    let now_buyers = names::my_names(&buyer)?;
    let bought = now_buyers.iter().find(|n| n.name == name.to_uppercase())
        .ok_or("the buyer paid but does not own the name")?;
    println!("   buyer now owns it, owner={}", bought.owner);
    if bought.listed_price_divi.is_some() {
        return Err("the listing survived the sale".into());
    }
    if names::my_names(&seller)?.iter().any(|n| n.name == name.to_uppercase()) {
        return Err("the seller still thinks they own it".into());
    }
    println!("   seller no longer owns it");

    step(8, "the seller actually received the money");
    let after = rpc_a
        .call("getreceivedbyaddress", json!([seller_addr, 0]))?
        .as_f64()
        .unwrap_or(0.0);
    let gained = after - before;
    println!("   seller's address received {gained} DIVI (asked {price})");
    if gained + 1e-6 < price {
        return Err(format!("the seller was underpaid: {gained} < {price}"));
    }

    step(9, "and the old owner can no longer touch it");
    match names::set_divi_address(&seller, &name, &seller_addr) {
        Ok(_) => return Err("the previous owner could still edit the name".into()),
        Err(e) => println!("   correctly refused: {e}"),
    }
    match names::buy(&buyer, &name) {
        Ok(_) => return Err("the name was still for sale after being bought".into()),
        Err(e) => println!("   no longer for sale: {e}"),
    }

    Ok(())
}
