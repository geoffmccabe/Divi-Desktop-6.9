// Proves NFD Phase 2: the wallet reads what it owns, and a collection's full
// membership, from the CHAIN via the in-process scanner (nfd_scan) -- no local
// storage involved. That is exactly the "survives a reinstall / second device"
// behaviour: nfd_scan::owned() only ever reads the chain.
//
// Run against the isolated regtest node:
//   DIVI_DATADIR=~/divi-poe-regtest DIVI_NFD_ACTIVATION=0 \
//     cargo run -p dd69-supervisor --example nfd_scan_readback
use dd69_supervisor::{collectibles, config::NodeConfig, nfd_scan, rpc::RpcClient};
use serde_json::json;

fn addr(rpc: &RpcClient) -> String {
    rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string()
}

fn mine(rpc: &RpcClient) {
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));
}

/// Drive the scanner until it has caught up to the tip, then return the sync obj.
fn catch_up(cfg: &NodeConfig) -> serde_json::Value {
    for _ in 0..50 {
        let s = nfd_scan::sync_state(cfg).expect("sync");
        if s["open"].as_bool() != Some(true) {
            panic!("scanner reports the feature is not open on this chain: {s}");
        }
        if s["syncing"].as_bool() == Some(false) {
            return s;
        }
    }
    panic!("scanner did not catch up");
}

fn owned_ids(cfg: &NodeConfig, address: &str) -> Vec<String> {
    let r = nfd_scan::owned(cfg, address).expect("owned");
    r["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect()
}

fn main() {
    // SAFETY: build the config for the ISOLATED regtest node by hand. Do NOT use
    // NodeConfig::load() -- it follows the live "My Nodes" active profile, which
    // on this machine is a remote node pointing at the live mainnet daemon
    // (127.0.0.1:51473). Regtest is 127.0.0.1:51799 with throwaway creds, so this
    // config physically cannot reach mainnet.
    // See memory: feedback_nfd_tests_never_use_nodeconfig_load.
    let cfg = NodeConfig {
        datadir: "/Users/geoffreymccabe/divi-poe-regtest".into(),
        rpc_host: "127.0.0.1".into(),
        rpc_user: "poe".into(),
        rpc_pass: "poe_local".into(),
        rpc_port: 51799,
        remote: false,
    };
    let rpc = RpcClient::new(&cfg);
    // Hard stop if we are not actually on a regtest chain.
    let chain = rpc.call("getblockchaininfo", json!([])).expect("regtest node reachable")["chain"]
        .as_str()
        .unwrap_or("")
        .to_string();
    assert_eq!(chain, "regtest", "refusing to run: connected to '{chain}', not regtest");

    // ── A standalone mint reads back under its owner (funding) address ────────
    let art = b"scan-readback: a standalone collectible";
    let d = collectibles::mint(&cfg, art, "application/octet-stream", true, None, None).expect("mint");
    println!("minted {} owned by {}", d.txid, d.owner_addr);
    mine(&rpc);
    catch_up(&cfg);

    let ids = owned_ids(&cfg, &d.owner_addr);
    assert!(ids.contains(&d.txid), "chain scan did not list the freshly minted NFD under its owner");
    println!("owned() from chain  = OK ({} item(s) for {})", ids.len(), d.owner_addr);

    // get() by id returns the same collectible from the chain.
    let g = nfd_scan::get(&cfg, &d.txid).expect("get");
    assert_eq!(g["nfd"]["id"].as_str(), Some(d.txid.as_str()), "get() by id must return the NFD");
    assert_eq!(g["nfd"]["owner"].as_str(), Some(d.owner_addr.as_str()), "get() owner must be the funder");
    println!("get(id) from chain  = OK");

    // A stranger's address owns none of it.
    let stranger = addr(&rpc);
    assert!(!owned_ids(&cfg, &stranger).contains(&d.txid), "a stranger appears to own it!");
    println!("stranger owns none  = OK");

    // ── A collection reads back its FULL membership from the chain ────────────
    let creator = addr(&rpc);
    let _ = rpc.call("sendtoaddress", json!([creator, 1.0]));
    mine(&rpc);
    let col = collectibles::create_collection(&cfg, &creator, "Scan Readback Set", "phase 2 proof", None, 3)
        .expect("create collection");
    mine(&rpc);

    let traits = br#"{"name":"Readback #1","attributes":[{"trait_type":"Rarity","value":"Common"}]}"#;
    let cm = collectibles::CollectionMint { creator_addr: &creator, collection_id: &col.txid, traits_json: traits };
    let item = collectibles::mint(&cfg, b"member-1 secret", "application/octet-stream", true, None, Some(cm)).expect("mint into collection");
    mine(&rpc);
    catch_up(&cfg);

    // The item's on-chain record must link back to its collection.
    let ig = nfd_scan::get(&cfg, &item.txid).expect("get item");
    assert_eq!(ig["nfd"]["collectionId"].as_str(), Some(col.txid.as_str()), "item must report its collection id");

    let cm_read = nfd_scan::collection_members(&cfg, &col.txid).expect("collection_members");
    assert_eq!(cm_read["collection"]["id"].as_str(), Some(col.txid.as_str()), "collection id must read back");
    let members: Vec<String> = cm_read["members"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
    assert!(members.contains(&item.txid), "collection membership from chain did not include the minted item");
    println!("collection_members  = OK (collection {} has {} member(s) on-chain)", col.txid, members.len());

    // The creator owns the collection item (collection items are creator-owned).
    assert!(owned_ids(&cfg, &creator).contains(&item.txid), "creator should own the collection item");
    println!("creator owns item   = OK");

    println!("\n>>> NFD PHASE 2 VERIFIED: owned + get + collection membership all read from the chain");
}
