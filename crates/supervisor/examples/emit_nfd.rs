//! Emit a real collectible record, so the collectible path can be proven on a
//! chain rather than only in tests.
//!
//! Uses the wallet's own encoder, not a hand-written copy, for the same reason
//! the token one does: a fixture that drifts from the encoder tests the fixture.
//!
//! ```text
//! cargo run --example emit_nfd -- mint          # with a thumbnail
//! cargo run --example emit_nfd -- mint-bare     # no thumbnail
//! cargo run --example emit_nfd -- collection 5
//! ```

use dd69_supervisor::nfd_record;

fn script_of(payload_hex: &str) -> String {
    let len = payload_hex.len() / 2;
    let mut s = String::from("6a");
    if len <= 75 {
        s.push_str(&format!("{len:02x}"));
    } else {
        s.push_str(&format!("4c{len:02x}"));
    }
    s.push_str(payload_hex);
    s
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let what = args.get(1).map(String::as_str).unwrap_or("mint");

    // Deterministic stand-ins. The chain stores pointers, not content, so a
    // pointer that resolves to nothing is still a structurally valid record and
    // is exactly what is needed to prove the indexing path.
    let arweave = "aa".repeat(32);
    let content = "bb".repeat(32);
    let thumb = "cc".repeat(32);

    let payload = match what {
        "mint" => nfd_record::encode_mint(&arweave, &content, 0x01, Some(&thumb), None),
        "mint-bare" => nfd_record::encode_mint(&arweave, &content, 0x01, None, None),
        "collection" => {
            let cap: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            nfd_record::encode_collection_create(cap, &"ee".repeat(32))
        }
        other => {
            eprintln!("unknown record: {other}");
            std::process::exit(2);
        }
    };

    match payload {
        Ok(hex) => {
            println!("payload {hex}");
            println!("script  {}", script_of(&hex));
            println!("bytes   {}", hex.len() / 2);
        }
        Err(e) => {
            eprintln!("refused: {e}");
            std::process::exit(1);
        }
    }
}
