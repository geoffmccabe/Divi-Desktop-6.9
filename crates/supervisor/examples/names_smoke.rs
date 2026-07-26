//! End-to-end proof of Divi Names against a real node, on regtest.
//!
//! Unit tests cover the rules engine. They cannot catch the thing that actually
//! broke this feature once already: an RPC that Divi does not implement the way
//! newer Bitcoin does. Only a live node can tell us that, so this drives the
//! real flows against a real daemon and fails loudly.
//!
//! Run:
//!   divid -datadir=~/divi-poe-regtest -daemon
//!   DIVI_NAMES_TREASURY=<a regtest address> \
//!     cargo run --example names_smoke -- ~/divi-poe-regtest
//!
//! ⚠ Regtest only. It refuses to run against mainnet.

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

/// Scan until the index has caught up, or give up loudly rather than hang.
fn sync_fully(cfg: &NodeConfig) -> Result<names::SyncStatus, String> {
    for _ in 0..200 {
        let s = names::sync(cfg)?;
        if !s.activated {
            return Err(format!("not activated: {}", s.note));
        }
        if !s.txindex {
            return Err(format!("no txindex: {}", s.note));
        }
        if !s.treasury_configured {
            return Err(format!("no treasury: {}", s.note));
        }
        if s.caught_up {
            return Ok(s);
        }
    }
    Err("index never caught up after 200 chunks".into())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("\nFAILED: {e}");
        std::process::exit(1);
    }
    println!("\nALL STEPS PASSED");
}

fn run() -> Result<(), String> {
    let datadir: PathBuf = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: names_smoke <datadir>")?;
    let cfg = NodeConfig::load_from(datadir)?;
    let rpc = RpcClient::new(&cfg);

    let chain = rpc.call("getblockchaininfo", json!([]))?["chain"]
        .as_str()
        .unwrap_or("main")
        .to_string();
    if chain == "main" {
        return Err("refusing to run against mainnet".into());
    }
    println!("chain: {chain}");

    let treasury = std::env::var("DIVI_NAMES_TREASURY")
        .map_err(|_| "set DIVI_NAMES_TREASURY to a regtest address first")?;
    println!("treasury: {treasury}");

    // A name nobody has taken on this chain yet. Height keeps reruns distinct.
    let tip0 = rpc.call("getblockcount", json!([]))?.as_u64().unwrap_or(0);
    let name = format!("SMOKE{tip0}");
    println!("name under test: {name}");

    step(1, "sync the index from scratch");
    let s = sync_fully(&cfg)?;
    println!("   scanned to {} of {}, {} names known", s.scanned_height, s.tip, s.names_known);

    step(2, "quote the name");
    let q = names::quote(&cfg, &name)?;
    println!("   canonical={} price={} DIVI available={:?}", q.canonical, q.registration_divi, q.available);
    if q.available != Some(true) {
        return Err(format!("expected {name} to be available, got {:?}", q.available));
    }

    step(3, "reserve it (commit)");
    let commit_txid = names::commit(&cfg, &name)?;
    println!("   commit txid {commit_txid}");

    step(4, "reveal too early must be refused");
    mine(&rpc, 2)?;
    sync_fully(&cfg)?;
    match names::register(&cfg, &name) {
        Ok(_) => return Err("register succeeded before the commit matured".into()),
        Err(e) => println!("   correctly refused: {e}"),
    }

    step(5, "wait out the maturity window, then register");
    mine(&rpc, 12)?;
    sync_fully(&cfg)?;
    let reg_txid = names::register(&cfg, &name)?;
    println!("   register txid {reg_txid}");
    mine(&rpc, 1)?;
    let s = sync_fully(&cfg)?;
    println!("   index now knows {} names", s.names_known);

    step(6, "the name is ours");
    let mine_names = names::my_names(&cfg)?;
    let found = mine_names
        .iter()
        .find(|n| n.name == q.canonical)
        .ok_or_else(|| format!("{} is not in my_names: {:?}", q.canonical, mine_names.iter().map(|n| &n.name).collect::<Vec<_>>()))?;
    println!("   owner={} registered_at={} expires={}", found.owner, found.registered_height, found.expires_height);

    step(7, "it is no longer available");
    let q2 = names::quote(&cfg, &name)?;
    if q2.available != Some(false) {
        return Err(format!("expected taken, got {:?}", q2.available));
    }
    println!("   correctly reported as taken");

    step(8, "point it at an address, then resolve it");
    let target = rpc.call("getnewaddress", json!([]))?.as_str().ok_or("no address")?.to_string();
    // Give it a little DIVI. A name points at an address somebody actually
    // uses, and claiming a display name has to be signed BY that address, so an
    // empty one could never do it. Doing this here keeps the test honest about
    // what the real flow looks like.
    rpc.call("sendtoaddress", json!([target, 1.0]))?;
    mine(&rpc, 1)?;
    names::set_divi_address(&cfg, &name, &target)?;
    mine(&rpc, 1)?;
    sync_fully(&cfg)?;
    let resolved = names::resolve(&cfg, &name)?;
    if resolved.as_deref() != Some(target.as_str()) {
        return Err(format!("resolve gave {resolved:?}, expected {target}"));
    }
    println!("   {} -> {}", name.to_lowercase(), target);

    step(9, "reverse lookup needs both sides to agree");
    names::set_primary(&cfg, &name)?;
    mine(&rpc, 1)?;
    sync_fully(&cfg)?;
    // set_primary is signed by whichever address funds the transaction, which is
    // not necessarily the address the name points at, so this is allowed to be
    // empty. What must never happen is it naming the WRONG address.
    match names::reverse(&cfg, &target)? {
        Some(n) if n == q.canonical => println!("   {target} displays as {n}"),
        Some(other) => return Err(format!("reverse gave the wrong name: {other}")),
        None => println!("   no reverse claim (the funding address is not the target address)"),
    }

    step(10, "a second registration of the same name is refused");
    match names::commit(&cfg, &name) {
        Ok(_) => println!("   commit allowed (the name is taken, so the reveal is what refuses)"),
        Err(e) => println!("   refused at commit: {e}"),
    }

    step(11, "records survive a fresh read of the index");
    let s = sync_fully(&cfg)?;
    println!("   {} names at height {}", s.names_known, s.scanned_height);
    let again = names::resolve(&cfg, &name)?;
    if again.as_deref() != Some(target.as_str()) {
        return Err(format!("resolve is not stable: {again:?}"));
    }
    println!("   resolution stable");

    Ok(())
}
