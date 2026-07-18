// End-to-end smoke test of the NFD (Divi Collectibles) mint + view flow against
// a live regtest node. Storage is the local-file stub. Proves the on-chain half,
// the owner=funding-address consistency, authenticity enforcement, and access
// control. Run:  DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example nfd_smoke
use dd69_supervisor::{collectibles, config::NodeConfig, nfd_record::NfdRecord, rpc::RpcClient};
use serde_json::json;

fn addr(rpc: &RpcClient) -> String {
    rpc.call("getnewaddress", json!([])).unwrap().as_str().unwrap().to_string()
}

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");
    let rpc = RpcClient::new(&cfg);

    let art = b"a one-of-a-kind Divi Collectible: the crown-jewels image bytes";
    let draft = collectibles::mint(&cfg, art).expect("mint");
    println!("owner (funding) = {}", draft.owner_addr);
    println!("minted txid     = {}", draft.txid);
    println!("content_hash    = {}", draft.content_hash);
    println!("arweave_ptr     = {} (local stub)", draft.arweave_ptr);

    // regtest mines on demand -> confirm the mint
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    // read the on-chain record back and check it matches
    let rec = collectibles::read_record(&cfg, &draft.txid).expect("read").expect("a record");
    match &rec {
        NfdRecord::Mint { arweave_ptr, content_hash, flags } => {
            println!("on-chain mint   = ptr={arweave_ptr} hash={content_hash} flags={flags}");
            assert_eq!(arweave_ptr, &draft.arweave_ptr);
            assert_eq!(content_hash, &draft.content_hash);
        }
        other => panic!("expected a Mint record, got {other:?}"),
    }

    // owner can view (fetch + decrypt + authenticity check passes)
    let recovered = collectibles::view(&cfg, &draft.owner_addr, &draft.arweave_ptr, &draft.content_hash).expect("view");
    assert_eq!(recovered, art, "owner failed to recover the art");
    println!("owner view      = OK ({} bytes)", recovered.len());

    // a different address cannot decrypt it
    let stranger = addr(&rpc);
    assert!(
        collectibles::view(&cfg, &stranger, &draft.arweave_ptr, &draft.content_hash).is_err(),
        "a stranger decrypted the collectible!"
    );
    println!("stranger view   = blocked (correct)");

    // a wrong content_hash must fail the authenticity check even for the owner
    assert!(
        collectibles::view(&cfg, &draft.owner_addr, &draft.arweave_ptr, &"00".repeat(32)).is_err(),
        "authenticity check did not reject a wrong content_hash!"
    );
    println!("authenticity    = enforced (wrong hash rejected)");

    println!("\n>>> NFD MINT + VIEW VERIFIED END-TO-END ON REGTEST");
}
