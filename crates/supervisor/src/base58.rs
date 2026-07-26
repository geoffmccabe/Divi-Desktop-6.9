//! Base58Check for Divi addresses.
//!
//! Overlay records carry a recipient as 21 raw bytes (1 type byte + 20-byte
//! hash) rather than as a text address, so the wallet has to convert both ways.
//!
//! Written by hand rather than pulling in a dependency: it is sixty lines, it is
//! fully covered by the tests below, and an address codec is exactly the kind of
//! small, security-relevant code that should not arrive through the supply
//! chain.
//!
//! Version bytes are from `chainparams.cpp`: mainnet P2PKH 30 (`D...`), P2SH 13;
//! testnet P2PKH 139, P2SH 19.

use sha2::{Digest, Sha256};

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub const MAIN_P2PKH: u8 = 30;
pub const MAIN_P2SH: u8 = 13;
pub const TEST_P2PKH: u8 = 139;
pub const TEST_P2SH: u8 = 19;

/// Payload kind as it appears inside a DVXP record body.
pub const KIND_P2PKH: u8 = 0x00;
pub const KIND_P2SH: u8 = 0x01;

fn double_sha256(data: &[u8]) -> [u8; 32] {
    let first = Sha256::digest(data);
    let second = Sha256::digest(first);
    let mut out = [0u8; 32];
    out.copy_from_slice(&second);
    out
}

/// Encode `version ‖ payload` with a 4-byte double-SHA256 checksum.
pub fn encode_check(version: u8, payload: &[u8]) -> String {
    let mut data = Vec::with_capacity(1 + payload.len() + 4);
    data.push(version);
    data.extend_from_slice(payload);
    data.extend_from_slice(&double_sha256(&data)[0..4]);

    // Leading zero bytes become leading '1's, and are not part of the bignum.
    let zeros = data.iter().take_while(|b| **b == 0).count();
    let mut digits: Vec<u8> = Vec::new();
    for &byte in &data[zeros..] {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut s = String::with_capacity(zeros + digits.len());
    for _ in 0..zeros {
        s.push('1');
    }
    for d in digits.iter().rev() {
        s.push(ALPHABET[*d as usize] as char);
    }
    s
}

/// Decode a Base58Check string into `(version, payload)`, verifying the
/// checksum. `None` for anything malformed: a mistyped address must fail, never
/// decode to a different valid one.
pub fn decode_check(s: &str) -> Option<(u8, Vec<u8>)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut bytes: Vec<u8> = Vec::new();
    for ch in s.bytes() {
        let val = ALPHABET.iter().position(|c| *c == ch)? as u32;
        let mut carry = val;
        for b in bytes.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|b| *b == b'1').count();
    let mut data = vec![0u8; zeros];
    data.extend(bytes.iter().rev());

    if data.len() < 5 {
        return None;
    }
    let split = data.len() - 4;
    let expect = double_sha256(&data[..split]);
    if data[split..] != expect[0..4] {
        return None;
    }
    Some((data[0], data[1..split].to_vec()))
}

/// A Divi address as `(kind, hash160)` ready to drop into a record body.
///
/// Returns `None` for an address whose version byte is not a Divi P2PKH or P2SH
/// on any network. Being strict here matters: an address from another chain that
/// happens to checksum correctly must not be written into a record where it
/// would name an unspendable destination.
pub fn address_to_payload(addr: &str) -> Option<(u8, [u8; 20])> {
    let (version, payload) = decode_check(addr)?;
    if payload.len() != 20 {
        return None;
    }
    let kind = match version {
        MAIN_P2PKH | TEST_P2PKH => KIND_P2PKH,
        MAIN_P2SH | TEST_P2SH => KIND_P2SH,
        _ => return None,
    };
    let mut hash = [0u8; 20];
    hash.copy_from_slice(&payload);
    Some((kind, hash))
}

/// Render a record-body address back to text. `testnet` picks the version byte,
/// because the same 20 bytes are a different address string on each network and
/// showing the wrong one would send a user's money nowhere.
pub fn payload_to_address(kind: u8, hash160: &[u8; 20], testnet: bool) -> String {
    let version = match (kind, testnet) {
        (KIND_P2SH, false) => MAIN_P2SH,
        (KIND_P2SH, true) => TEST_P2SH,
        (_, true) => TEST_P2PKH,
        (_, false) => MAIN_P2PKH,
    };
    encode_check(version, hash160)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_every_kind_and_network() {
        let hash = [0x1fu8; 20];
        for kind in [KIND_P2PKH, KIND_P2SH] {
            for testnet in [false, true] {
                let addr = payload_to_address(kind, &hash, testnet);
                let (got_kind, got_hash) = address_to_payload(&addr).expect("decodes");
                assert_eq!(got_kind, kind);
                assert_eq!(got_hash, hash);
            }
        }
    }

    /// Mainnet P2PKH is version 30, which must render as a leading 'D'. If this
    /// ever fails, every address the wallet shows is wrong.
    #[test]
    fn mainnet_addresses_start_with_d() {
        for seed in [0u8, 1, 0x7f, 0xff] {
            let addr = payload_to_address(KIND_P2PKH, &[seed; 20], false);
            assert!(addr.starts_with('D'), "got {addr}");
        }
    }

    #[test]
    fn a_corrupted_address_never_decodes() {
        let addr = payload_to_address(KIND_P2PKH, &[9u8; 20], false);
        let mut chars: Vec<char> = addr.chars().collect();
        // Flip one character to something else in the alphabet.
        chars[5] = if chars[5] == 'z' { 'y' } else { 'z' };
        let broken: String = chars.into_iter().collect();
        assert_eq!(address_to_payload(&broken), None);
    }

    #[test]
    fn rejects_junk_and_foreign_versions() {
        assert_eq!(address_to_payload(""), None);
        assert_eq!(address_to_payload("not an address"), None);
        // '0', 'O', 'I' and 'l' are deliberately absent from base58.
        assert_eq!(address_to_payload("D0OIl"), None);
        // Correct checksum, but a version byte Divi never uses (Bitcoin P2PKH).
        let foreign = encode_check(0, &[7u8; 20]);
        assert_eq!(address_to_payload(&foreign), None);
    }

    #[test]
    fn leading_zero_bytes_survive_the_roundtrip() {
        let payload = [0u8; 20];
        let s = encode_check(0, &payload);
        assert!(s.starts_with("11"), "leading zeros must become leading ones: {s}");
        let (v, back) = decode_check(&s).unwrap();
        assert_eq!(v, 0);
        assert_eq!(back, payload);
    }

    #[test]
    fn wrong_payload_length_is_refused() {
        let short = encode_check(MAIN_P2PKH, &[1u8; 19]);
        assert_eq!(address_to_payload(&short), None);
    }
}
