// Proves the batch-mint funding fix: create a PUBLIC (Perc-style) collection,
// pre-split the creator's coins into a UTXO pool, then mint 40 items into it with
// NO mining between mints. Without the pool this stalls after ~1; with it, all 40
// land. Run:  DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example perc_batch
use dd69_supervisor::{collectibles, config::NodeConfig, rpc::RpcClient};
use serde_json::json;

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");
    let rpc = RpcClient::new(&cfg);
    let mine = |n: i64| {
        let _ = rpc.call("setgenerate", json!([n]));
        std::thread::sleep(std::time::Duration::from_millis(800));
    };

    // Fund a fresh creator address with a few P2PKH UTXOs.
    let creator = rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string();
    for _ in 0..3 {
        let _ = rpc.call("sendtoaddress", json!([creator, 5.0]));
    }
    mine(2);

    // A PUBLIC collection (Perc-style: art shared per tier, no encryption).
    let col = collectibles::create_collection(&cfg, &creator, "Skylie Percs (test)", "batch test", None, 40)
        .expect("create collection");
    mine(1);
    println!("collection = {}", col.txid);

    const N: usize = 40;
    // Pre-split into one confirmed UTXO per mint.
    match collectibles::prepare_funding(&cfg, &creator, N).expect("prepare_funding") {
        Some(fan) => {
            println!("fan-out    = {fan}");
            mine(1); // confirm the pool
        }
        None => println!("fan-out    = (already had enough UTXOs)"),
    }

    // Mint N public Percs into the collection with NO mining between them.
    let mut ok = 0usize;
    for i in 1..=N {
        let tier = ((i - 1) % 40) + 1;
        let art = format!("Skylie Perc — tier {tier} art (edition {i})");
        let traits = format!("{{\"name\":\"Skylie Perc #{i}\",\"edition\":{i},\"tier\":\"T{tier}\"}}");
        let cm = collectibles::CollectionMint {
            creator_addr: &creator,
            collection_id: &col.txid,
            traits_json: traits.as_bytes(),
        };
        match collectibles::mint(&cfg, art.as_bytes(), "image/webp", false, None, Some(cm)) {
            Ok(_) => ok += 1,
            Err(e) => {
                println!("mint {i} FAILED: {e}");
                break;
            }
        }
    }
    mine(1);
    println!("minted     = {ok}/{N} with NO mining between mints");
    assert_eq!(ok, N, "batch stalled before minting all {N}");
    println!("\n>>> PERC BATCH OF {N} MINTED WITHOUT STALL (funding pool works)");
}
