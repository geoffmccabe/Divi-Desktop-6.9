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

/// Mint flag bits.
pub const FLAG_ENCRYPTED: u8 = 0x01;
/// The mint carries an unencrypted public thumbnail (its Arweave id is appended).
pub const FLAG_HAS_THUMB: u8 = 0x02;

#[derive(Debug, PartialEq, Eq)]
pub enum NfdRecord {
    /// First appearance of an NFD. arweave_ptr -> encrypted content bundle;
    /// content_hash is SHA-256 of salt‖plaintext. `thumb_ptr` (when the creator
    /// opted in) is the Arweave id of an *unencrypted* public preview image.
    Mint { arweave_ptr: String, content_hash: String, flags: u8, thumb_ptr: Option<String> },
    /// Hand an NFD to new_owner; wrapkey_ptr -> the content key re-wrapped to them.
    Transfer { mint_txid: String, new_owner: String, wrapkey_ptr: String },
    /// Publish an address's derived X25519 encryption pubkey so it can receive.
    KeyAnnounce { enc_pubkey: String },
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

/// Encode a MINT. The HAS_THUMB flag is derived from `thumb_ptr` presence, so the
/// flag and the appended pointer can never disagree.
pub fn encode_mint(
    arweave_ptr: &str,
    content_hash: &str,
    flags: u8,
    thumb_ptr: Option<&str>,
) -> Result<String, String> {
    if !is_hex_len(arweave_ptr, 32) {
        return Err("arweave_ptr must be 32 bytes hex".into());
    }
    if !is_hex_len(content_hash, 32) {
        return Err("content_hash must be 32 bytes hex".into());
    }
    let mut flags = flags & !FLAG_HAS_THUMB;
    if let Some(t) = thumb_ptr {
        if !is_hex_len(t, 32) {
            return Err("thumb_ptr must be 32 bytes hex".into());
        }
        flags |= FLAG_HAS_THUMB;
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
    Ok(out)
}

pub fn encode_transfer(mint_txid: &str, new_owner: &str, wrapkey_ptr: &str) -> Result<String, String> {
    if !is_hex_len(mint_txid, 32) {
        return Err("mint_txid must be 32 bytes hex".into());
    }
    if !is_hex_len(new_owner, 20) {
        return Err("new_owner must be a 20-byte address hash (hex)".into());
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
    script_hex.get(off..off + plen * 2)
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
        SUB_MINT if body.len() >= 130 => {
            let flags = u8::from_str_radix(&body[128..130], 16).ok()?;
            let thumb_ptr = if flags & FLAG_HAS_THUMB != 0 {
                if body.len() < 194 {
                    return None; // flag set but the 32-byte thumb id is missing
                }
                Some(body[130..194].to_string())
            } else {
                None
            };
            Some(NfdRecord::Mint {
                arweave_ptr: body[0..64].to_string(),
                content_hash: body[64..128].to_string(),
                flags,
                thumb_ptr,
            })
        }
        SUB_TRANSFER if body.len() >= 168 => Some(NfdRecord::Transfer {
            mint_txid: body[0..64].to_string(),
            new_owner: body[64..104].to_string(), // 20 bytes
            wrapkey_ptr: body[104..168].to_string(),
        }),
        SUB_KEYANNOUNCE if body.len() >= 64 => Some(NfdRecord::KeyAnnounce {
            enc_pubkey: body[0..64].to_string(),
        }),
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
        let script = op_meta_script(&encode_mint(&a, &h, FLAG_ENCRYPTED, None).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Mint { arweave_ptr: a, content_hash: h, flags: 1, thumb_ptr: None })
        );
    }

    #[test]
    fn mint_roundtrip_with_thumb() {
        let a = "aa".repeat(32);
        let h = "bb".repeat(32);
        let t = "cc".repeat(32);
        // caller passes only ENCRYPTED; HAS_THUMB is derived from the pointer
        let script = op_meta_script(&encode_mint(&a, &h, FLAG_ENCRYPTED, Some(&t)).unwrap());
        assert_eq!(
            parse(&script),
            Some(NfdRecord::Mint {
                arweave_ptr: a,
                content_hash: h,
                flags: FLAG_ENCRYPTED | FLAG_HAS_THUMB,
                thumb_ptr: Some(t),
            })
        );
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
        let owner = "22".repeat(20);
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
        assert!(encode_mint("short", &"bb".repeat(32), 0, None).is_err());
        assert!(encode_mint(&"aa".repeat(32), &"bb".repeat(32), 0, Some("short")).is_err());
        assert!(encode_transfer(&"11".repeat(32), &"22".repeat(32), &"33".repeat(32)).is_err()); // owner wrong len
        assert!(encode_key_announce("nope").is_err());
    }
}
