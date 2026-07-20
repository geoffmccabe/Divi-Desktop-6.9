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
    let thumb = b"fake-webp-thumbnail-bytes-for-the-smoke-test";
    let draft = collectibles::mint(&cfg, art, Some((thumb, "image/webp")), None).expect("mint");
    println!("thumb_ptr       = {:?}", draft.thumb_ptr);
    println!("owner (funding) = {}", draft.owner_addr);
    println!("minted txid     = {}", draft.txid);
    println!("content_hash    = {}", draft.content_hash);
    println!("arweave_ptr     = {}", draft.arweave_ptr);

    // regtest mines on demand -> confirm the mint
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    // read the on-chain record back and check it matches
    let rec = collectibles::read_record(&cfg, &draft.txid).expect("read").expect("a record");
    match &rec {
        NfdRecord::Mint { arweave_ptr, content_hash, flags, thumb_ptr, .. } => {
            println!("on-chain mint   = ptr={arweave_ptr} hash={content_hash} flags={flags} thumb={thumb_ptr:?}");
            assert_eq!(arweave_ptr, &draft.arweave_ptr);
            assert_eq!(content_hash, &draft.content_hash);
            assert_eq!(thumb_ptr, &draft.thumb_ptr, "on-chain thumb pointer must match");
            assert!(thumb_ptr.is_some(), "this mint included a thumbnail");
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

    // ── Transfer A -> B, then B claims ──────────────────────────────────────
    let bob = addr(&rpc);
    let bob_code = collectibles::receive_code(&cfg, &bob).expect("bob receive code");
    let t = collectibles::transfer(&cfg, &draft.owner_addr, &draft.txid, &bob, &bob_code.enc_pubkey).expect("transfer");
    println!("transfer txid   = {}", t.txid);
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    let claimed = collectibles::claim(&cfg, &bob, &draft.txid, &t.wrapkey_ptr).expect("claim");
    assert_eq!(claimed, art, "recipient failed to claim the art");
    println!("recipient claim = OK ({} bytes)", claimed.len());

    let eve = addr(&rpc);
    assert!(
        collectibles::claim(&cfg, &eve, &draft.txid, &t.wrapkey_ptr).is_err(),
        "a stranger claimed the transferred collectible!"
    );
    println!("stranger claim  = blocked (correct)");

    // ── Collections: create one, mint an item into it, view it ──────────────
    // The creator needs a spendable UTXO on a stable address for both the create
    // and the item-mint (creator-only rule). Fund a fresh address and use it.
    let creator = addr(&rpc);
    let _ = rpc.call("sendtoaddress", json!([creator, 1.0]));
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    let cover = b"fake-webp-collection-cover";
    let col = collectibles::create_collection(&cfg, &creator, "Divi Genesis", "the first drop", Some((cover, "image/webp")), 3)
        .expect("create collection");
    println!("\ncollection id   = {}", col.txid);
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    let traits = br#"{"name":"Genesis #1","attributes":[{"trait_type":"Background","value":"Nebula"},{"trait_type":"Rarity","value":"Legendary"}]}"#;
    let cm = collectibles::CollectionMint { creator_addr: &creator, collection_id: &col.txid, traits_json: traits };
    let item = collectibles::mint(&cfg, b"genesis-item-1 secret original", Some((thumb, "image/webp")), Some(cm)).expect("mint into collection");
    println!("item txid       = {} (owner {})", item.txid, item.owner_addr);
    assert_eq!(item.owner_addr, creator, "collection item must be owned by the creator");
    let _ = rpc.call("setgenerate", json!([1]));
    std::thread::sleep(std::time::Duration::from_millis(600));

    match collectibles::read_record(&cfg, &item.txid).expect("read").expect("a record") {
        NfdRecord::Mint { collection_id, traits_ptr, .. } => {
            assert_eq!(collection_id.as_deref(), Some(col.txid.as_str()), "item must reference its collection");
            assert!(traits_ptr.is_some(), "item must carry a public traits pointer");
            println!("collection item = OK (member of {})", col.txid);
        }
        other => panic!("expected a Mint record, got {other:?}"),
    }
    let recovered = collectibles::view(&cfg, &creator, &item.arweave_ptr, &item.content_hash).expect("view item");
    assert_eq!(recovered, b"genesis-item-1 secret original");
    println!("creator view    = OK ({} bytes)", recovered.len());

    println!("\n>>> NFD MINT + VIEW + TRANSFER + COLLECTIONS VERIFIED END-TO-END ON REGTEST");
}
