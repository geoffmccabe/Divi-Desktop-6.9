//! Seed phrases: reading one in whatever shape a person pastes it, checking
//! it is a real one, and turning it into the seed the node uses.
//!
//! "Private key" and "seed phrase" are the same secret in two forms. The 12
//! words ARE the key, written so a person can copy them by hand; the node
//! stores the same thing as 64 bytes of hex (what `dumphdinfo` calls the
//! hdseed, and what `-hdseed` restores from). This module converts between
//! them exactly as the node does (BIP 39: PBKDF2-HMAC-SHA512, 2048 rounds,
//! salt "mnemonic" + optional passphrase), using only the SHA-2 code already
//! in this crate: no new dependency for something this sensitive.
//!
//! Nothing here logs, stores or transmits anything. Secrets come in, a result
//! goes out, and the caller is responsible for what it does next.

use crate::bip39_words::WORDS;
use sha2::{Digest, Sha256, Sha512};

/// Take a pasted phrase in any reasonable shape and return its words,
/// lower-cased. Accepts spaces, newlines, tabs, commas, semicolons, numbered
/// lists ("1. abandon"), and quotes around words. Rejects nothing yet: that
/// is `check`'s job, so the message can say WHAT is wrong.
pub fn normalize(input: &str) -> Vec<String> {
    input
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '|')
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_alphabetic()))
        .filter(|w| !w.is_empty())
        // "1." / "12)" numbering leaves a bare number once punctuation is
        // stripped; letters-only survive, numbers do not.
        .filter(|w| w.chars().all(|c| c.is_ascii_alphabetic()))
        .map(|w| w.to_ascii_lowercase())
        .collect()
}

/// Why a phrase is not usable, in words a person can act on.
pub fn check(words: &[String]) -> Result<(), String> {
    match words.len() {
        12 | 15 | 18 | 21 | 24 => {}
        n => {
            return Err(format!(
                "A seed phrase has 12 words (or 15, 18, 21 or 24). This has {n}."
            ))
        }
    }
    let mut unknown: Vec<&str> = Vec::new();
    for w in words {
        if index_of(w).is_none() {
            unknown.push(w);
        }
    }
    if !unknown.is_empty() {
        return Err(format!(
            "Not on the seed-phrase word list: {}. Check the spelling of {}.",
            unknown.join(", "),
            if unknown.len() == 1 { "that word" } else { "those words" }
        ));
    }
    if !checksum_ok(words) {
        return Err(
            "The words are all valid, but together they don't form a real seed phrase. \
             One is probably wrong or out of order."
                .into(),
        );
    }
    Ok(())
}

fn index_of(word: &str) -> Option<usize> {
    WORDS.binary_search(&word).ok()
}

/// BIP 39: the last few bits of the phrase are a checksum of the rest. This
/// is what catches a mistyped word that happens to be on the list.
fn checksum_ok(words: &[String]) -> bool {
    let n = words.len();
    let total_bits = n * 11;
    let cs_bits = total_bits / 33;
    let ent_bits = total_bits - cs_bits;
    let mut bits: Vec<u8> = Vec::with_capacity(total_bits);
    for w in words {
        let Some(i) = index_of(w) else { return false };
        for b in (0..11).rev() {
            bits.push(((i >> b) & 1) as u8);
        }
    }
    let mut entropy = vec![0u8; ent_bits / 8];
    for (i, bit) in bits.iter().take(ent_bits).enumerate() {
        entropy[i / 8] |= bit << (7 - (i % 8));
    }
    let hash = Sha256::digest(&entropy);
    for (k, bit) in bits[ent_bits..].iter().enumerate() {
        let hbit = (hash[k / 8] >> (7 - (k % 8))) & 1;
        if *bit != hbit {
            return false;
        }
    }
    true
}

/// The 64-byte seed the node derives from a phrase, as lower-case hex. This
/// is the value `dumphdinfo` reports as `hdseed` and `-hdseed` restores from.
pub fn to_seed_hex(words: &[String], passphrase: &str) -> String {
    let mnemonic = words.join(" ");
    let salt = format!("mnemonic{passphrase}");
    let seed = pbkdf2_hmac_sha512(mnemonic.as_bytes(), salt.as_bytes(), 2048, 64);
    seed.iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac_sha512(key: &[u8], msg: &[u8]) -> [u8; 64] {
    const BLOCK: usize = 128;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..64].copy_from_slice(&Sha512::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let inner = Sha512::new().chain_update(ipad).chain_update(msg).finalize();
    let outer = Sha512::new().chain_update(opad).chain_update(inner).finalize();
    let mut out = [0u8; 64];
    out.copy_from_slice(&outer);
    out
}

fn pbkdf2_hmac_sha512(password: &[u8], salt: &[u8], rounds: u32, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut block: u32 = 1;
    while out.len() < len {
        let mut salt_block = salt.to_vec();
        salt_block.extend_from_slice(&block.to_be_bytes());
        let mut u = hmac_sha512(password, &salt_block);
        let mut t = u;
        for _ in 1..rounds {
            u = hmac_sha512(password, &u);
            for i in 0..64 {
                t[i] ^= u[i];
            }
        }
        out.extend_from_slice(&t);
        block += 1;
    }
    out.truncate(len);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // The BIP 39 reference vector: all-zero entropy → this phrase → this seed.
    const REF: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const REF_SEED_TREZOR: &str = "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04";

    #[test]
    fn the_reference_phrase_derives_the_reference_seed() {
        let w = normalize(REF);
        assert!(check(&w).is_ok());
        assert_eq!(to_seed_hex(&w, "TREZOR"), REF_SEED_TREZOR);
    }

    #[test]
    fn any_reasonable_paste_shape_is_read() {
        let shapes = [
            "abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, abandon, about",
            "1. abandon 2. abandon 3. abandon 4. abandon 5. abandon 6. abandon 7. abandon 8. abandon 9. abandon 10. abandon 11. abandon 12. about",
            "ABANDON\tabandon\nabandon abandon\n\nabandon abandon abandon abandon abandon abandon abandon \"about\"",
            "abandon;abandon;abandon;abandon;abandon;abandon;abandon;abandon;abandon;abandon;abandon;about",
        ];
        for s in shapes {
            let w = normalize(s);
            assert_eq!(w.len(), 12, "{s}");
            assert!(check(&w).is_ok(), "{s}");
        }
    }

    #[test]
    fn a_wrong_word_is_named_and_a_bad_checksum_is_caught() {
        let mut w = normalize(REF);
        w[3] = "abandonn".into();
        let e = check(&w).unwrap_err();
        assert!(e.contains("abandonn"), "{e}");
        let mut w = normalize(REF);
        w[11] = "zoo".into(); // on the list, but the checksum no longer matches
        assert!(check(&w).unwrap_err().contains("out of order"));
        let w = normalize("abandon abandon");
        assert!(check(&w).unwrap_err().contains("has 2"));
    }
}
