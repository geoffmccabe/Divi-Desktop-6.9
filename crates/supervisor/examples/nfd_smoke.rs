// End-to-end smoke test of the NFD (Divi Collectibles) mint + view flow against
// a live regtest node. Arweave is stubbed (bundle held in memory). Proves the
// on-chain half + the encryption bind to the owner, exactly like poe_smoke.
// Run:  DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example nfd_smoke
use dd69_supervisor::{collectibles, config::NodeConfig, nfd_record::NfdRecord, rpc::RpcClient};
use serde_json::json;

fn addr(rpc: &RpcClient) -> String {
    rpc.call("getnewaddress", json!([]))
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");
    let rpc = RpcClient::new(&cfg);

    let owner = addr(&rpc);
    println!("owner address  = {owner}");

    let art = b"a one-of-a-kind Divi Collectible: the crown-jewels image bytes";
    let draft = collectibles::mint(&cfg, &owner, art).expect("mint");
    println!("minted txid    = {}", draft.txid);
    println!("content_hash   = {}", draft.content_hash);
    println!("arweave_ptr    = {} (stub)", draft.arweave_ptr);

    // regtest mines on demand -> confirm the mint
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    // read the on-chain record back and check it matches what we minted
    let rec = collectibles::read_record(&cfg, &draft.txid)
        .expect("read record")
        .expect("a record should be present");
    match &rec {
        NfdRecord::Mint { arweave_ptr, content_hash, flags } => {
            println!("on-chain mint  = ptr={arweave_ptr} hash={content_hash} flags={flags}");
            assert_eq!(arweave_ptr, &draft.arweave_ptr, "arweave_ptr mismatch");
            assert_eq!(content_hash, &draft.content_hash, "content_hash mismatch");
        }
        other => panic!("expected a Mint record, got {other:?}"),
    }

    // the owner can decrypt the stored bundle back to the original art
    let recovered = collectibles::view(&cfg, &owner, &draft.content_blob, &draft.wrapped_ck).expect("view");
    assert_eq!(recovered, art, "owner failed to recover the art");
    println!("owner decrypt  = OK ({} bytes)", recovered.len());

    // a different address must NOT be able to decrypt it
    let stranger = addr(&rpc);
    match collectibles::view(&cfg, &stranger, &draft.content_blob, &draft.wrapped_ck) {
        Err(_) => println!("stranger view  = blocked (correct)"),
        Ok(_) => panic!("a stranger decrypted the collectible!"),
    }

    println!("\n>>> NFD MINT + VIEW VERIFIED END-TO-END ON REGTEST");
}
