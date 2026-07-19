// End-to-end smoke test of the PoE module against a live (regtest) node.
// Run with:  DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example poe_smoke
// Anchors a fixed hash, mines a block to confirm it, then verifies.
use dd69_supervisor::{config::NodeConfig, poe, rpc::RpcClient};
use serde_json::json;

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");
    let hash = "4caad21afba16c5d9ceda9cb297665040e3b88daa82201dc6b62d0d88423a061";

    // Defaults = minimum fee, no payout; the smoke test shouldn't spend real value.
    let txid = poe::timestamp(&cfg, hash, poe::AnchorCost::default()).expect("anchor");
    println!("anchored txid = {txid}");

    // Confirm it (regtest mines on demand).
    let rpc = RpcClient::new(&cfg);
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(500));

    let good = poe::verify(&cfg, &txid, hash).expect("verify");
    println!(
        "verify(correct hash): matched={} confirmations={} block_time={:?}",
        good.matched, good.confirmations, good.block_time
    );

    let wrong = "0".repeat(64);
    let bad = poe::verify(&cfg, &txid, &wrong).expect("verify wrong");
    println!("verify(wrong hash):   matched={} (expect false)", bad.matched);
}
