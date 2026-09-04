// End-to-end forge: mint two SAME-TIER (T5) public Percs, forge them (burn both +
// 1000 DIVI fee), wait for the resolve block, and confirm a guaranteed upgrade to
// T(5+K) with K in 1..=40. Run:
//   DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example forge_demo
use dd69_supervisor::{collectibles, config::NodeConfig, rpc::RpcClient};
use serde_json::json;

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");
    let rpc = RpcClient::new(&cfg);
    let mine = |n: i64| {
        let _ = rpc.call("setgenerate", json!([n]));
        std::thread::sleep(std::time::Duration::from_millis(800));
    };

    // Forger needs a big coin — the forge fee is 1000 DIVI.
    let forger = rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string();
    for _ in 0..3 {
        let _ = rpc.call("sendtoaddress", json!([forger, 1500.0]));
    }
    mine(2);

    let col = collectibles::create_collection(&cfg, &forger, "Skylie Percs (forge test)", "", None, 0)
        .expect("create collection");
    mine(1);

    // Two SAME-TIER (T5) public Percs owned by the forger.
    let mk = |ed: u32| {
        let traits = format!("{{\"name\":\"Perc #{ed}\",\"edition\":{ed},\"tier\":\"T5\"}}");
        let cm = collectibles::CollectionMint { creator_addr: &forger, collection_id: &col.txid, traits_json: traits.as_bytes() };
        collectibles::mint(&cfg, format!("T5 shared art {ed}").as_bytes(), "image/webp", false, None, Some(cm)).expect("mint")
    };
    let a = mk(1);
    let b = mk(2);
    mine(1);
    println!("two T5 Percs = {} , {}", a.txid, b.txid);

    // Commit the forge (fee to the forger's own address here, just for the test).
    let commit = collectibles::forge(&cfg, &forger, &col.txid, &a.txid, &b.txid, &forger).expect("forge");
    println!("forge txid   = {} (resolves at height {})", commit.forge_txid, commit.resolve_height);
    mine(collectibles::FORGE_DELAY + 1);

    // Resolve the guaranteed upgrade from the future block hash.
    let outcome = collectibles::forge_outcome(&cfg, &commit.forge_txid, commit.resolve_height, 5)
        .expect("forge_outcome")
        .expect("should be resolvable now");
    println!("result tier  = T{} (uses T{} art)", outcome.result_tier, outcome.art_tier);
    assert!(outcome.result_tier > 5, "forge must ALWAYS upgrade");
    assert!(outcome.result_tier >= 6 && outcome.result_tier <= 45, "T5 + K, K in 1..=40");
    assert_eq!(outcome.art_tier, outcome.result_tier.min(40), "art reuses T40 past 40");

    // Mint the result, reusing the tier art (test reuses input a's art pointer).
    let traits = format!("{{\"name\":\"Forged Perc\",\"tier\":\"T{}\",\"forged\":true}}", outcome.result_tier);
    let result = collectibles::mint_public_ref(&cfg, &forger, &col.txid, &a.arweave_ptr, &a.content_hash, traits.as_bytes())
        .expect("mint forge result");
    mine(1);
    println!("forged Perc  = {}", result.txid);
    println!("\n>>> FORGE VERIFIED: two T5 -> T{} (guaranteed upgrade)", outcome.result_tier);
}
