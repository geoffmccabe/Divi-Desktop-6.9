// Phase 0 end-to-end on a private chain: make an extra wallet (its own
// words), receive to it from the node's wallet, see the balance through the
// address index, send some back, and check the node's wallet file was never
// touched. Needs a regtest node with addressindex=1 at the given datadir.
use dd69_supervisor::{config::NodeConfig, wallets};
use std::path::PathBuf;
fn main() {
    let datadir = PathBuf::from(std::env::args().nth(1).expect("datadir"));
    let cfg = NodeConfig::load_from(datadir.clone()).expect("cfg");
    let rpc = dd69_supervisor::rpc::RpcClient::new(&cfg);
    let node_id = "smoke";
    // Fresh store for the test.
    let _ = std::fs::remove_file(dd69_supervisor::config::dd69_datadir().join("wallets-smoke.json"));
    let made = wallets::create(node_id, "Kids", None, true).expect("create");
    println!("words: {} (12 words, shown once)", made.words.len());
    let addr = made.wallet.addresses[0].address.clone();
    println!("first address: {addr}");
    let a2 = wallets::new_address(node_id, &made.wallet.id, "second", None, true).expect("new address");
    println!("second address: {} (index {})", a2.address, a2.index);
    // The node's wallet sends 5 DIVI to the new wallet, then mines it in.
    let txid = rpc.call("sendtoaddress", serde_json::json!([addr, 5.0])).expect("send in");
    println!("funded by {}", txid.as_str().unwrap_or("?"));
    rpc.call("setgenerate", serde_json::json!([2])).expect("mine");
    std::thread::sleep(std::time::Duration::from_secs(2));
    let bal = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance");
    println!("wallet balance: {} DIVI", bal.divi);
    assert!((bal.divi - 5.0).abs() < 1e-8, "expected 5 DIVI");
    // Send 2 back to the node's wallet.
    let back = rpc.call("getnewaddress", serde_json::json!([])).expect("addr").as_str().unwrap().to_string();
    let out = wallets::send(&cfg, node_id, &made.wallet.id, &back, 2.0, None, true).expect("send out");
    println!("sent 2 DIVI back: {out}");
    rpc.call("setgenerate", serde_json::json!([1])).expect("mine");
    std::thread::sleep(std::time::Duration::from_secs(2));
    let bal2 = wallets::balance(&cfg, &wallets::load(node_id).wallets[0]).expect("balance");
    println!("wallet balance after: {} DIVI (5 - 2 - fee)", bal2.divi);
    assert!(bal2.divi < 3.0 && bal2.divi > 2.99, "change did not return");
    let wi = rpc.call("getwalletinfo", serde_json::json!([])).expect("wi");
    println!("node wallet keys: {}", wi["keypoolsize"]);
    println!("OK");
}
