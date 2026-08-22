// NFD on-chain record codec: encode and parse the DVXP type-0x02 records that
// anchor Divi Collectibles in an OP_META output. Three subtypes (mint, transfer,
// key-announce) per docs/NFD-COLLECTIBLES-SPEC.md §2. Pure hex, bounds-checked,
// no RPC -- mirrors poe.rs's parser discipline. Heavy data lives on Arweave;
// only these small anchors touch the chain.

const MAGIC: &str = "44565850"; // "DVXP"
const VER_TYPE: &str = "0102"; // version 0x01 | type 0x02 (NFD)
const SUB_MINT: u8 = 0x01;
const SUB_TRANSFER: u8 = 0x02;
const SUB_KEYANNOUNCE: u8 = 0x03;
const SUB_COLLECTION: u8 = 0x04;
const SUB_FORGE: u8 = 0x05;
const SUB_BRIDGE_OUT: u8 = 0x07;
const SUB_BRIDGE_IN: u8 = 0x08;

/// Mint flag bits.
pub const FLAG_ENCRYPTED: u8 = 0x01;
/// The mint carries an unencrypted public thumbnail (its Arweave id is appended).
pub const FLAG_HAS_THUMB: u8 = 0x02;
/// The mint belongs to a collection (collection_id + traits_ptr are appended).
pub const FLAG_IN_COLLECTION: u8 = 0x04;

#[derive(Debug, PartialEq, Eq)]
pub enum NfdRecord {
    /// First appearance of an NFD. arweave_ptr -> encrypted content bundle;
    /// content_hash is SHA-256 of salt‖plaintext. `thumb_ptr` (opt-in) is the
    /// Arweave id of a public preview image. `collection_id` + `traits_ptr` are
    /// present when the mint is part of a collection (traits_ptr -> public
    /// ERC-721-style attributes JSON).
    Mint {
        arweave_ptr: String,
        content_hash: String,
        flags: u8,
        thumb_ptr: Option<String>,
        collection_id: Option<String>,
        traits_ptr: Option<String>,
    },
    /// Hand an NFD to new_owner; wrapkey_ptr -> the content key re-wrapped to them.
    Transfer { mint_txid: String, new_owner: String, wrapkey_ptr: String },
    /// Create a collection: `max_supply` (0 = uncapped), `meta_ptr` -> public
    /// collection metadata JSON (name, description, banner). Creator = the sender.
    CollectionCreate { max_supply: u32, meta_ptr: String },
    /// Publish an address's derived X25519 encryption pubkey so it can receive.
    KeyAnnounce { enc_pubkey: String },
    /// FORGE: burn two same-tier NFDs (`input_a`, `input_b`, by mint txid) in a
    /// collection and roll an upgrade. Sender must own both. The result tier is
    /// resolved from a future block hash (see forge.rs) and minted separately.
    Forge { input_a: String, input_b: String, collection_id: String },
    /// BRIDGE-OUT: lock an NFD to the bridge for the Divi->Diva leg. Assigns
    /// ownership of `nfd_id` (its mint txid) to BRIDGE_DIVI, and carries the
    /// destination DIVA EVM address (`diva_dest`, 20 bytes), the round-trip
    /// `nonce`, and `maturity_confs` (the Diva token stays frozen until the lock
    /// is this many Divi confs deep -- the fast self-transfer knob). For encrypted
    /// NFDs `wrapkey_ptr` is the content key rewrapped to the federation.
    /// See docs/NFD-BRIDGE-INTERFACE.md.
    BridgeOut {
        nfd_id: String,
        diva_dest: String,
        nonce: u64,
        maturity_confs: u32,
        flags: u8,
        wrapkey_ptr: Option<String>,
    },
    /// BRIDGE-IN: the federation releases a locked NFD for the Diva->Divi leg.
    /// Transfers the NFD from BRIDGE_DIVI to `new_owner` (21-byte packed addr),
    /// referencing the authorizing DIVA burn (`diva_burn_ref`) and the matching
    /// `nonce`. For encrypted NFDs `wrapkey_ptr` is the CK rewrapped to new_owner.
    BridgeIn {
        new_owner: String,
        diva_burn_ref: String,
        nonce: u64,
        flags: u8,
        wrapkey_ptr: Option<String>,
    },
}

fn is_hex_len(s: &str, bytes: usize) -> bool {
    s.len() == bytes * 2 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn prefix(subtype: u8) -> String {
    format!("{}{}{:02x}", MAGIC, VER_TYPE, subtype)
}

/// Wrap a payload hex string in an OP_META script (0x6a + push). Handles the
/// OP_PUSHDATA1 case the transfer record needs (>75 bytes).
pub fn op_meta_script(payload_hex: &str) -> String {
    let n = payload_hex.len() / 2;
    if n <= 75 {
        format!("6a{:02x}{}", n, payload_hex)
    } else {
        format!("6a4c{:02x}{}", n, payload_hex)
    }
}

/// Encode a MINT. The HAS_THUMB / IN_COLLECTION flags are derived from the
/// optional pointers, so flags and appended data can never disagree. Optional
/// fields are appended in flag-bit order: thumb (bit1), then collection (bit2).
pub fn encode_mint(
    arweave_ptr: &str,
    content_hash: &str,
    flags: u8,
    thumb_ptr: Option<&str>,
    collection: Option<(&str, &str)>, // (collection_id, traits_ptr)
) -> Result<String, String> {
    if !is_hex_len(arweave_ptr, 32) {
        return Err("arweave_ptr must be 32 bytes hex".into());
    }
    if !is_hex_len(content_hash, 32) {
        return Err("content_hash must be 32 bytes hex".into());
    }
    let mut flags = flags & !(FLAG_HAS_THUMB | FLAG_IN_COLLECTION);
    if let Some(t) = thumb_ptr {
        if !is_hex_len(t, 32) {
            return Err("thumb_ptr must be 32 bytes hex".into());
        }
        flags |= FLAG_HAS_THUMB;
    }
    if let Some((cid, tp)) = collection {
        if !is_hex_len(cid, 32) || !is_hex_len(tp, 32) {
            return Err("collection_id and traits_ptr must be 32 bytes hex".into());
        }
        flags |= FLAG_IN_COLLECTION;
    }
    let mut out = format!(
        "{}{}{}{:02x}",
        prefix(SUB_MINT),
        arweave_ptr.to_lowercase(),
        content_hash.to_lowercase(),
        flags
    );
    if let Some(t) = thumb_ptr {
        out.push_str(&t.to_lowercase());
    }
    if let Some((cid, tp)) = collection {
        out.push_str(&cid.to_lowercase());
        out.push_str(&tp.to_lowercase());
    }
    Ok(out)
}

/// Encode a COLLECTION-CREATE. `max_supply` 0 = uncapped; `meta_ptr` -> public
/// collection metadata JSON.
pub fn encode_collection_create(max_supply: u32, meta_ptr: &str) -> Result<String, String> {
    if !is_hex_len(meta_ptr, 32) {
        return Err("meta_ptr must be 32 bytes hex".into());
    }
    Ok(format!("{}{:08x}{}", prefix(SUB_COLLECTION), max_supply, meta_ptr.to_lowercase()))
}

/// Encode a FORGE: the two same-tier input NFDs (by mint txid) + the collection.
pub fn encode_forge(input_a: &str, input_b: &str, collection_id: &str) -> Result<String, String> {
    for (n, v) in [("input_a", input_a), ("input_b", input_b), ("collection_id", collection_id)] {
        if !is_hex_len(v, 32) {
            return Err(format!("{n} must be 32 bytes hex"));
        }
    }
    Ok(format!(
        "{}{}{}{}",
        prefix(SUB_FORGE),
        input_a.to_lowercase(),
        input_b.to_lowercase(),
        collection_id.to_lowercase()
    ))
}

/// Encode a BRIDGE-OUT (lock). Layout: nfd_id(32) diva_dest(20) nonce(u64,8)
/// maturity_confs(u32,4) flags(1) [wrapkey_ptr(32) if ENCRYPTED]. The ENCRYPTED
/// flag is derived from whether a wrapkey is supplied, so flags and data agree.
pub fn encode_bridge_out(
    nfd_id: &str,
    diva_dest: &str,
    nonce: u64,
    maturity_confs: u32,
    wrapkey_ptr: Option<&str>,
) -> Result<String, String> {
    if !is_hex_len(nfd_id, 32) {
        return Err("nfd_id must be 32 bytes hex".into());
    }
    if !is_hex_len(diva_dest, 20) {
        return Err("diva_dest must be a 20-byte EVM address hex".into());
    }
    let mut flags = 0u8;
    if let Some(wk) = wrapkey_ptr {
        if !is_hex_len(wk, 32) {
            return Err("wrapkey_ptr must be 32 bytes hex".into());
        }
        flags |= FLAG_ENCRYPTED;
    }
    let mut out = format!(
        "{}{}{}{:016x}{:08x}{:02x}",
        prefix(SUB_BRIDGE_OUT),
        nfd_id.to_lowercase(),
        diva_dest.to_lowercase(),
        nonce,
        maturity_confs,
        flags
    );
    if let Some(wk) = wrapkey_ptr {
        out.push_str(&wk.to_lowercase());
    }
    Ok(out)
}

/// Encode a BRIDGE-IN (release). Layout: new_owner(21) diva_burn_ref(32)
/// nonce(u64,8) flags(1) [wrapkey_ptr(32) if ENCRYPTED].
pub fn encode_bridge_in(
    new_owner: &str,
    diva_burn_ref: &str,
    nonce: u64,
    wrapkey_ptr: Option<&str>,
) -> Result<String, String> {
    if !is_hex_len(new_owner, 21) {
        return Err("new_owner must be a 21-byte packed address (kind + hash160, hex)".into());
    }
    if !is_hex_len(diva_burn_ref, 32) {
        return Err("diva_burn_ref must be 32 bytes hex".into());
    }
    let mut flags = 0u8;
    if let Some(wk) = wrapkey_ptr {
        if !is_hex_len(wk, 32) {
            return Err("wrapkey_ptr must be 32 bytes hex".into());
        }
        flags |= FLAG_ENCRYPTED;
    }
    let mut out = format!(
        "{}{}{}{:016x}{:02x}",
        prefix(SUB_BRIDGE_IN),
        new_owner.to_lowercase(),
        diva_burn_ref.to_lowercase(),
        nonce,
        flags
    );
    if let Some(wk) = wrapkey_ptr {
        out.push_str(&wk.to_lowercase());
    }
    Ok(out)
}

pub fn encode_transfer(mint_txid: &str, new_owner: &str, wrapkey_ptr: &str) -> Result<String, String> {
    if !is_hex_len(mint_txid, 32) {
        return Err("mint_txid must be 32 bytes hex".into());
    }
    if !is_hex_len(new_owner, 21) {
        return Err("new_owner must be a 21-byte packed address (kind + hash160, hex)".into());
    }
    if !is_hex_len(wrapkey_ptr, 32) {
        return Err("wrapkey_ptr must be 32 bytes hex".into());
    }
    Ok(format!(
        "{}{}{}{}",
        prefix(SUB_TRANSFER),
        mint_txid.to_lowercase(),
        new_owner.to_lowercase(),
        wrapkey_ptr.to_lowercase()
    ))
}

pub fn encode_key_announce(enc_pubkey: &str) -> Result<String, String> {
    if !is_hex_len(enc_pubkey, 32) {
        return Err("enc_pubkey must be 32 bytes hex".into());
    }
    Ok(format!("{}{}", prefix(SUB_KEYANNOUNCE), enc_pubkey.to_lowercase()))
}

/// Pull the pushed payload out of an OP_META scriptPubKey hex, bounds-checked.
fn extract_payload(script_hex: &str) -> Option<&str> {
    // ASCII guard: all slicing below is by byte index, so a non-ASCII char
    // straddling a boundary would panic. Hex is ASCII; anything else isn't ours.
    if script_hex.len() < 4 || !script_hex.is_ascii() || !script_hex.starts_with("6a") {
        return None;
    }
    let (off, plen) = match &script_hex[2..4] {
        "4c" => {
            if script_hex.len() < 6 {
                return None;
            }
            (6usize, usize::from_str_radix(&script_hex[4..6], 16).ok()?)
        }
        b => {
            let n = usize::from_str_radix(b, 16).ok()?;
            if n > 75 {
                return None;
            }
            (4usize, n)
        }
    };
    let payload = script_hex.get(off..off + plen * 2)?;
    // Defense in depth: the real input is the node's hex encoding, but reject a
    // non-hex payload so "malformed → None" holds even for a non-chain caller.
    if !payload.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(payload)
}

/// Parse an NFD record out of an OP_META scriptPubKey hex, or None if it isn't
/// one. Safe against arbitrary/truncated on-chain data.
pub fn parse(script_hex: &str) -> Option<NfdRecord> {
    let p = extract_payload(script_hex)?.to_lowercase();
    let head = format!("{}{}", MAGIC, VER_TYPE); // magic | ver | type
    if !p.starts_with(&head) || p.len() < head.len() + 2 {
        return None;
    }
    let subtype = u8::from_str_radix(&p[head.len()..head.len() + 2], 16).ok()?;
    let body = &p[head.len() + 2..];
    match subtype {
        // Lengths are EXACT (no trailing bytes) so the wallet and the indexer
        // agree on validity — divergence is the one thing the spec forbids (§8).
        // base 130 hex (arweave 64 | content 64 | flags 2), then optional fields
        // in flag order: thumb (+64), collection_id+traits (+128). EXACT length.
        SUB_MINT if body.len() >= 130 => {
            let flags = u8::from_str_radix(&body[128..130], 16).ok()?;
            let has_thumb = flags & FLAG_HAS_THUMB != 0;
            let in_coll = flags & FLAG_IN_COLLECTION != 0;
            let expected = 130 + if has_thumb { 64 } else { 0 } + if in_coll { 128 } else { 0 };
            if body.len() != expected {
                return None;
            }
            let mut off = 130;
            let thumb_ptr = if has_thumb {
                let t = body[off..off + 64].to_string();
                off += 64;
                Some(t)
            } else {
                None
            };
            let (collection_id, traits_ptr) = if in_coll {
                (Some(body[off..off + 64].to_string()), Some(body[off + 64..off + 128].to_string()))
            } else {
                (None, None)
            };
            Some(NfdRecord::Mint {
                arweave_ptr: body[0..64].to_string(),
                content_hash: body[64..128].to_string(),
                flags,
                thumb_ptr,
                collection_id,
                traits_ptr,
            })
        }
        SUB_TRANSFER if body.len() == 170 => Some(NfdRecord::Transfer {
            mint_txid: body[0..64].to_string(),
            new_owner: body[64..106].to_string(), // 21 bytes packed (kind + hash160)
            wrapkey_ptr: body[106..170].to_string(),
        }),
        SUB_KEYANNOUNCE if body.len() == 64 => Some(NfdRecord::KeyAnnounce {
            enc_pubkey: body[0..64].to_string(),
        }),
        SUB_COLLECTION if body.len() == 72 => Some(NfdRecord::CollectionCreate {
            max_supply: u32::from_str_radix(&body[0..8], 16).ok()?,
            meta_ptr: body[8..72].to_string(),
        }),
        SUB_FORGE if body.len() == 192 => Some(NfdRecord::Forge {
            input_a: body[0..64].to_string(),
            input_b: body[64..128].to_string(),
            collection_id: body[128..192].to_string(),
        }),
        // BRIDGE-OUT: nfd_id(64) diva_dest(40) nonce(16) maturity(8) flags(2)
        // [wrapkey(64)]. base 130 hex; +64 when ENCRYPTED. EXACT length.
        SUB_BRIDGE_OUT if body.len() >= 130 => {
            let flags = u8::from_str_radix(&body[128..130], 16).ok()?;
            let enc = flags & FLAG_ENCRYPTED != 0;
            let expected = 130 + if enc { 64 } else { 0 };
            if body.len() != expected {
                return None;
            }
            let wrapkey_ptr = if enc { Some(body[130..194].to_string()) } else { None };
            Some(NfdRecord::BridgeOut {
                nfd_id: body[0..64].to_string(),
                diva_dest: body[64..104].to_string(),
                nonce: u64::from_str_radix(&body[104..120], 16).ok()?,
                maturity_confs: u32::from_str_radix(&body[120..128], 16).ok()?,
                flags,
                wrapkey_ptr,
            })
        }
        // BRIDGE-IN: new_owner(42) diva_burn_ref(64) nonce(16) flags(2)
        // [wrapkey(64)]. base 124 hex; +64 when ENCRYPTED. EXACT length.
        SUB_BRIDGE_IN if body.len() >= 124 => {
            let flags = u8::from_str_radix(&body[122..124], 16).ok()?;
            let enc = flags & FLAG_ENCRYPTED != 0;
            let expected = 124 + if enc { 64 } else { 0 };
            if body.len() != expected {
                return None;
            }
            let wrapkey_ptr = if enc { Some(body[124..188].to_string()) } else { None };
            Some(NfdRecord::BridgeIn {
                new_owner: body[0..42].to_string(),
                diva_burn_ref: body[42..106].to_string(),
                nonce: u64::from_str_radix(&body[106..122], 16).ok()?,
                flags,
                wrapkey_ptr,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_roundtrip_no_thumb() {
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        let script = op_meta_script(&encode_mint(&a, &h, FLAG_ENCRYPTED, None, None).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Mint {
                arweave_ptr: a,
                content_hash: h,
                flags: 1,
                thumb_ptr: None,
                collection_id: None,
                traits_ptr: None,
            })
        );
    }

    #[test]
    fn mint_roundtrip_with_thumb() {
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        let t = "cc".repeat(32);
        // caller passes only ENCRYPTED; HAS_THUMB is derived from the pointer
        let script = op_meta_script(&encode_mint(&a, &h, FLAG_ENCRYPTED, Some(&t), None).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Mint {
                arweave_ptr: a,
                content_hash: h,
                flags: FLAG_ENCRYPTED | FLAG_HAS_THUMB,
                thumb_ptr: Some(t),
                collection_id: None,
                traits_ptr: None,
            })
        );
    }

    #[test]
    fn mint_in_collection_roundtrips() {
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        let cid = "dd".repeat(32);
        let tr = "ee".repeat(32);
        // both thumb + collection present
        let t = "cc".repeat(32);
        let script =
            op_meta_script(&encode_mint(&a, &h, FLAG_ENCRYPTED, Some(&t), Some((&cid, &tr))).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Mint {
                arweave_ptr: a,
                content_hash: h,
                flags: FLAG_ENCRYPTED | FLAG_HAS_THUMB | FLAG_IN_COLLECTION,
                thumb_ptr: Some(t),
                collection_id: Some(cid),
                traits_ptr: Some(tr),
            })
        );
    }

    #[test]
    fn collection_create_roundtrips() {
        let m = "ff".repeat(32);
        let script = op_meta_script(&encode_collection_create(10_000, &m).unwrap());
        assert_eq!(parse(&script), Some(NfdRecord::CollectionCreate { max_supply: 10_000, meta_ptr: m }));
    }

    #[test]
    fn forge_roundtrips() {
        let (a, b, c) = ("11".repeat(32), "22".repeat(32), "33".repeat(32));
        let script = op_meta_script(&encode_forge(&a, &b, &c).unwrap());
        assert_eq!(parse(&script), Some(NfdRecord::Forge { input_a: a, input_b: b, collection_id: c }));
    }

    #[test]
    fn bridge_out_roundtrips_public_and_encrypted() {
        let nfd = "11".repeat(32);
        let dest = "22".repeat(20); // 20-byte EVM address
        // public (no wrapkey)
        let script = op_meta_script(&encode_bridge_out(&nfd, &dest, 0, 10, None).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::BridgeOut {
                nfd_id: nfd.clone(),
                diva_dest: dest.clone(),
                nonce: 0,
                maturity_confs: 10,
                flags: 0,
                wrapkey_ptr: None,
            })
        );
        // encrypted (wrapkey present -> ENCRYPTED flag derived), non-zero nonce/maturity
        let wk = "33".repeat(32);
        let script = op_meta_script(&encode_bridge_out(&nfd, &dest, 7, 20, Some(&wk)).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::BridgeOut {
                nfd_id: nfd,
                diva_dest: dest,
                nonce: 7,
                maturity_confs: 20,
                flags: FLAG_ENCRYPTED,
                wrapkey_ptr: Some(wk),
            })
        );
    }

    #[test]
    fn bridge_in_roundtrips_public_and_encrypted() {
        let owner = "44".repeat(21); // 21-byte packed address
        let burn = "55".repeat(32);
        let script = op_meta_script(&encode_bridge_in(&owner, &burn, 3, None).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::BridgeIn {
                new_owner: owner.clone(),
                diva_burn_ref: burn.clone(),
                nonce: 3,
                flags: 0,
                wrapkey_ptr: None,
            })
        );
        let wk = "66".repeat(32);
        let script = op_meta_script(&encode_bridge_in(&owner, &burn, 3, Some(&wk)).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::BridgeIn {
                new_owner: owner,
                diva_burn_ref: burn,
                nonce: 3,
                flags: FLAG_ENCRYPTED,
                wrapkey_ptr: Some(wk),
            })
        );
    }

    #[test]
    fn bridge_records_reject_bad_lengths() {
        // wrong-length diva_dest / trailing byte must be rejected
        assert!(encode_bridge_out(&"11".repeat(32), &"22".repeat(19), 0, 10, None).is_err());
        let ok = encode_bridge_out(&"11".repeat(32), &"22".repeat(20), 0, 10, None).unwrap();
        assert!(parse(&op_meta_script(&format!("{ok}00"))).is_none()); // trailing byte
        // ENCRYPTED flag set but no wrapkey following -> reject
        let mut broken = ok.clone();
        broken.replace_range(broken.len() - 2.., "01"); // flip flags to ENCRYPTED, drop wrapkey
        assert!(parse(&op_meta_script(&broken)).is_none());
    }

    #[test]
    fn trailing_bytes_are_rejected() {
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        // a valid mint payload with one extra byte must be rejected (matches indexer)
        let padded = format!("{}00", encode_mint(&a, &h, FLAG_ENCRYPTED, None, None).unwrap());
        assert!(parse(&op_meta_script(&padded)).is_none());
        let ka = format!("{}00", encode_key_announce(&"cd".repeat(32)).unwrap());
        assert!(parse(&op_meta_script(&ka)).is_none());
    }

    #[test]
    fn mint_with_thumb_flag_but_missing_id_is_rejected() {
        // flag says HAS_THUMB but no 32-byte id follows -> parse must reject
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        let body = format!("445658500102{:02x}{}{}{:02x}", SUB_MINT, a, h, FLAG_HAS_THUMB);
        assert!(parse(&op_meta_script(&body)).is_none());
    }

    #[test]
    fn transfer_roundtrip_uses_pushdata1() {
        // transfer body is 91 bytes total payload -> needs OP_PUSHDATA1
        let txid = "11".repeat(32);
        let owner = "22".repeat(21); // 21-byte packed address (kind + hash160)
        let wk = "33".repeat(32);
        let payload = encode_transfer(&txid, &owner, &wk).unwrap();
        let script = op_meta_script(&payload);
        assert!(script.starts_with("6a4c"), "should use OP_PUSHDATA1");
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Transfer { mint_txid: txid, new_owner: owner, wrapkey_ptr: wk })
        );
    }

    #[test]
    fn key_announce_roundtrip() {
        let pk = "cd".repeat(32);
        let script = op_meta_script(&encode_key_announce(&pk).unwrap());
        assert_eq!(parse(&script), Some(NfdRecord::KeyAnnounce { enc_pubkey: pk }));
    }

    #[test]
    fn rejects_junk_and_foreign_records() {
        for bad in [
            "",
            "6a",
            "6a2700",
            "ff00",
            // a PoE record (type 0x01), not NFD -> must be ignored
            &op_meta_script(&format!("44565850010101{}", "ab".repeat(32))),
            // right magic, unknown subtype 0x09
            &op_meta_script(&format!("4456585001020 9{}", "ab".repeat(32)).replace(' ', "")),
            // mint truncated
            &op_meta_script(&format!("445658500102 01{}", "ab".repeat(10)).replace(' ', "")),
        ] {
            assert!(parse(bad).is_none(), "should reject {bad}");
        }
    }

    #[test]
    fn non_ascii_input_returns_none_not_panic() {
        for s in ["6aaé00", "6a😀", "445658500102🎨"] {
            assert!(parse(s).is_none(), "should safely reject {s}");
        }
    }

    #[test]
    fn encode_validates_lengths() {
        assert!(encode_mint("short", &"bb".repeat(32), 0, None, None).is_err());
        assert!(encode_mint(&"aa".repeat(32), &"bb".repeat(32), 0, Some("short"), None).is_err());
        assert!(encode_transfer(&"11".repeat(32), &"22".repeat(32), &"33".repeat(32)).is_err()); // owner wrong len
        assert!(encode_key_announce("nope").is_err());
    }
}
