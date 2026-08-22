// Divi-side CLI for the NFD<->Diva bridge coordinator. A thin, JSON-in/JSON-out
// shell entrypoint so a coordinator written in any language (e.g. the DIVA-side
// Node scripts) can drive the Divi half without linking Rust. Wire format +
// semantics: dd69-nfd/docs/NFD-BRIDGE-INTERFACE.md.
//
// Node config comes from the environment (DIVI_DATADIR); on regtest:
//   DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example bridge_cli -- <cmd> ...
//
// Commands:
//   scan     <txid>                                  -> the BRIDGE-OUT/IN record on that tx, or null
//   meta     <nfd_mint_txid>                          -> {content_ptr, thumb_ptr, collection_id, traits_ptr}
//                                                       (the MetaCommit for mintFromLock; absent fields = 32 zero bytes)
//   maturity <lock_txid> <maturity_confs>            -> {confs, required, matured}
//   lock     <owner_addr> <nfd_txid> <diva_dest20> <nonce> <maturity_confs>  (test helper; the wallet
//                                                     normally issues locks) -> {txid, nonce}
//   release  <bridge_addr> <new_owner> <burn_ref32> <nonce>                  -> {txid}
//
// All hex args are lowercase hex without 0x. diva_dest is 20 bytes; burn_ref 32.
use dd69_supervisor::{bridge, collectibles, config::NodeConfig, nfd_record::NfdRecord};
use serde_json::{json, Value};

fn record_json(r: &NfdRecord) -> Value {
    match r {
        NfdRecord::BridgeOut { nfd_id, diva_dest, nonce, maturity_confs, flags, wrapkey_ptr } => json!({
            "kind": "bridge_out",
            "nfd_id": nfd_id,
            "diva_dest": diva_dest,
            "nonce": nonce,
            "maturity_confs": maturity_confs,
            "encrypted": flags & 0x01 != 0,
            "wrapkey_ptr": wrapkey_ptr,
        }),
        NfdRecord::BridgeIn { new_owner, diva_burn_ref, nonce, flags, wrapkey_ptr } => json!({
            "kind": "bridge_in",
            "new_owner": new_owner,
            "diva_burn_ref": diva_burn_ref,
            "nonce": nonce,
            "encrypted": flags & 0x01 != 0,
            "wrapkey_ptr": wrapkey_ptr,
        }),
        _ => Value::Null,
    }
}

fn die(msg: &str) -> ! {
    eprintln!("{}", json!({ "error": msg }));
    std::process::exit(1);
}

fn main() {
    let cfg = NodeConfig::load().unwrap_or_else(|e| die(&format!("load node config (set DIVI_DATADIR): {e}")));
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let a = |i: usize| args.get(i).cloned().unwrap_or_default();
    let u64a = |i: usize| a(i).parse::<u64>().unwrap_or_else(|_| die("nonce must be a u64"));
    let u32a = |i: usize| a(i).parse::<u32>().unwrap_or_else(|_| die("maturity_confs must be a u32"));

    let out: Value = match cmd {
        "scan" => match bridge::read_bridge_record(&cfg, &a(1)) {
            Ok(Some(r)) => record_json(&r),
            Ok(None) => Value::Null,
            Err(e) => die(&e),
        },
        "meta" => match collectibles::read_record(&cfg, &a(1)) {
            Ok(Some(NfdRecord::Mint { arweave_ptr, thumb_ptr, collection_id, traits_ptr, .. })) => {
                let z = || "00".repeat(32);
                json!({
                    "content_ptr": arweave_ptr,
                    "thumb_ptr": thumb_ptr.unwrap_or_else(z),
                    "collection_id": collection_id.unwrap_or_else(z),
                    "traits_ptr": traits_ptr.unwrap_or_else(z),
                })
            }
            Ok(_) => die("no NFD mint record on that tx"),
            Err(e) => die(&e),
        },
        "maturity" => {
            let m = bridge::maturity_of(&cfg, &a(1), u32a(2));
            json!({ "confs": m.confs, "required": m.required, "matured": m.matured })
        }
        "lock" => match bridge::lock(&cfg, &a(1), &a(2), &a(3), u64a(4), u32a(5), None) {
            Ok(o) => json!({ "txid": o.txid, "nonce": o.nonce }),
            Err(e) => die(&e),
        },
        "release" => match bridge::release(&cfg, &a(1), &a(2), &a(3), u64a(4), None) {
            Ok(o) => json!({ "txid": o.txid }),
            Err(e) => die(&e),
        },
        _ => die("usage: scan|maturity|lock|release (see file header)"),
    };
    println!("{out}");
}
