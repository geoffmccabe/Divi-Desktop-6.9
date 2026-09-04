// NFD (Divi Collectibles) encryption core. No chain, no Arweave, no file I/O
// here -- pure cryptography over byte slices so it can be tested and reviewed in
// isolation. Audited RustCrypto primitives only; nothing hand-rolled.
//
// Design (see docs/NFD-COLLECTIBLES-SPEC.md §3):
//  * sign-to-derive: the wallet's deterministic `signmessage` signature seeds an
//    X25519 encryption keypair, so the node's real private key is never exposed.
//  * envelope encryption: content is AES-256-GCM'd once under a random content
//    key (CK); CK is wrapped (ECIES-style: ephemeral X25519 -> HKDF -> AES-GCM)
//    to the owner. Transfer = re-wrap CK to the recipient; the big ciphertext is
//    never touched.

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const WRAP_INFO: &[u8] = b"NFD-wrap-v1";
const KEY_DOMAIN: &[u8] = b"DIVI-NFD-KEY-v1"; // the phrase the wallet signs

/// Derive a stable X25519 encryption keypair from a `signmessage` signature.
/// Because Divi's signmessage is deterministic (verified on-node), the same
/// address always yields the same keypair, and the raw wallet key is never used.
///
/// SECURITY: this signature IS the master decryption key for every NFD the
/// address owns. `signmessage` signatures are conventionally public, so this one
/// must never be surfaced, logged, or verified elsewhere, and the phrase below
/// must stay globally unique to NFD. Anyone who obtains it can decrypt.
pub fn derive_enc_keypair(signature_bytes: &[u8]) -> (StaticSecret, PublicKey) {
    let seed: [u8; 32] = Sha256::digest(signature_bytes).into();
    let secret = StaticSecret::from(seed);
    let public = PublicKey::from(&secret);
    (secret, public)
}

/// The fixed phrase the wallet must sign to produce the seed above.
pub fn key_domain_phrase() -> &'static str {
    std::str::from_utf8(KEY_DOMAIN).unwrap()
}

fn hkdf_key(ikm: &[u8], info: &[u8]) -> Result<[u8; 32], String> {
    let hk = Hkdf::<Sha256>::new(None, ikm);
    let mut okm = [0u8; 32];
    hk.expand(info, &mut okm).map_err(|_| "hkdf expand failed".to_string())?;
    Ok(okm)
}

/// KDF context: binds the wrap key to BOTH the ephemeral and recipient pubkeys,
/// so a captured wrapped key can't be replayed/reinterpreted under another pair.
fn wrap_info(epk: &PublicKey, recipient_pub: &PublicKey) -> Vec<u8> {
    let mut info = Vec::with_capacity(WRAP_INFO.len() + 64);
    info.extend_from_slice(WRAP_INFO);
    info.extend_from_slice(epk.as_bytes());
    info.extend_from_slice(recipient_pub.as_bytes());
    info
}

fn rand_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    getrandom::getrandom(&mut b).map_err(|e| e.to_string())?;
    Ok(b)
}

/// Wrap a 32-byte content key to `recipient_pub`. Output = epk(32) | nonce(12) |
/// AES-GCM(ct+tag). Only the holder of the matching X25519 secret can unwrap.
fn wrap_key(ck: &[u8; 32], recipient_pub: &PublicKey) -> Result<Vec<u8>, String> {
    let eph_seed: [u8; 32] = rand_bytes()?;
    let esk = StaticSecret::from(eph_seed);
    let epk = PublicKey::from(&esk);
    let shared = esk.diffie_hellman(recipient_pub);
    if !shared.was_contributory() {
        return Err("refusing a low-order recipient key".into());
    }
    let wk = hkdf_key(shared.as_bytes(), &wrap_info(&epk, recipient_pub))?;
    let nonce: [u8; 12] = rand_bytes()?;
    let cipher = Aes256Gcm::new_from_slice(&wk).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), ck.as_ref())
        .map_err(|_| "key wrap failed".to_string())?;
    let mut out = Vec::with_capacity(32 + 12 + ct.len());
    out.extend_from_slice(epk.as_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn unwrap_key(blob: &[u8], my_secret: &StaticSecret) -> Result<[u8; 32], String> {
    if blob.len() < 32 + 12 + 16 + 32 {
        return Err("wrapped key too short".into());
    }
    let mut epk_b = [0u8; 32];
    epk_b.copy_from_slice(&blob[..32]);
    let epk = PublicKey::from(epk_b);
    let nonce = &blob[32..44];
    let ct = &blob[44..];
    let shared = my_secret.diffie_hellman(&epk);
    if !shared.was_contributory() {
        return Err("rejected a low-order ephemeral key".into());
    }
    let wk = hkdf_key(shared.as_bytes(), &wrap_info(&epk, &PublicKey::from(my_secret)))?;
    let cipher = Aes256Gcm::new_from_slice(&wk).map_err(|e| e.to_string())?;
    let ck = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "cannot unwrap key (wrong owner or tampered)".to_string())?;
    let out: [u8; 32] = ck.try_into().map_err(|_| "unwrapped key wrong length".to_string())?;
    Ok(out)
}

/// Encrypt content for `owner_pub`. Returns (content_blob, wrapped_ck).
/// content_blob = nonce(12) | AES-256-GCM(ct+tag). The document never appears
/// in plaintext anywhere but memory during this call.
pub fn encrypt_content(plaintext: &[u8], owner_pub: &PublicKey) -> Result<(Vec<u8>, Vec<u8>), String> {
    let ck: [u8; 32] = rand_bytes()?;
    let nonce: [u8; 12] = rand_bytes()?;
    let cipher = Aes256Gcm::new_from_slice(&ck).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "content encrypt failed".to_string())?;
    let mut blob = Vec::with_capacity(12 + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    let wrapped = wrap_key(&ck, owner_pub)?;
    Ok((blob, wrapped))
}

/// Decrypt content given the ciphertext blob, the content key wrapped to you,
/// and your derived secret. Fails (auth error) on any tamper or wrong key.
pub fn decrypt_content(content_blob: &[u8], wrapped_ck: &[u8], my_secret: &StaticSecret) -> Result<Vec<u8>, String> {
    if content_blob.len() < 12 + 16 {
        return Err("content blob too short".into());
    }
    let ck = unwrap_key(wrapped_ck, my_secret)?;
    let nonce = &content_blob[..12];
    let ct = &content_blob[12..];
    let cipher = Aes256Gcm::new_from_slice(&ck).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "cannot decrypt content (wrong key or tampered)".to_string())
}

/// Transfer viewing rights: unwrap CK with your secret, re-wrap to the
/// recipient's pubkey. The content ciphertext is not re-encrypted or moved.
pub fn rewrap(wrapped_ck: &[u8], my_secret: &StaticSecret, recipient_pub: &PublicKey) -> Result<Vec<u8>, String> {
    let ck = unwrap_key(wrapped_ck, my_secret)?;
    wrap_key(&ck, recipient_pub)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kp(tag: &[u8]) -> (StaticSecret, PublicKey) {
        derive_enc_keypair(tag)
    }

    #[test]
    fn sign_to_derive_is_deterministic() {
        let (_s1, p1) = derive_enc_keypair(b"identical-signature-bytes");
        let (_s2, p2) = derive_enc_keypair(b"identical-signature-bytes");
        assert_eq!(p1.as_bytes(), p2.as_bytes(), "same sig must give same key");
        let (_s3, p3) = derive_enc_keypair(b"a-different-signature");
        assert_ne!(p1.as_bytes(), p3.as_bytes(), "different sig must give different key");
    }

    #[test]
    fn owner_roundtrip() {
        let (osk, opk) = kp(b"alice-sig");
        let msg = b"the secret artwork bytes";
        let (blob, wrapped) = encrypt_content(msg, &opk).unwrap();
        assert_eq!(decrypt_content(&blob, &wrapped, &osk).unwrap(), msg);
    }

    #[test]
    fn stranger_cannot_decrypt() {
        let (_osk, opk) = kp(b"alice-sig");
        let (esk, _epk) = kp(b"eve-sig");
        let (blob, wrapped) = encrypt_content(b"secret", &opk).unwrap();
        assert!(decrypt_content(&blob, &wrapped, &esk).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let (osk, opk) = kp(b"alice-sig");
        let (mut blob, wrapped) = encrypt_content(b"secret art", &opk).unwrap();
        let n = blob.len() - 1;
        blob[n] ^= 0x01;
        assert!(decrypt_content(&blob, &wrapped, &osk).is_err());
    }

    #[test]
    fn tampered_wrapped_key_fails() {
        let (osk, opk) = kp(b"alice-sig");
        let (blob, mut wrapped) = encrypt_content(b"secret", &opk).unwrap();
        let n = wrapped.len() - 1;
        wrapped[n] ^= 0x01;
        assert!(decrypt_content(&blob, &wrapped, &osk).is_err());
    }

    #[test]
    fn rejects_low_order_ephemeral_key() {
        // A forged wrapped-key whose ephemeral pubkey is the all-zero (low-order)
        // point forces shared=0; must be rejected, not silently unwrapped.
        let (osk, _opk) = kp(b"alice-sig");
        let mut blob = vec![0u8; 32]; // epk = 0 (low order)
        blob.extend_from_slice(&[0u8; 12]); // nonce
        blob.extend_from_slice(&[0u8; 48]); // ct+tag
        assert!(decrypt_content(&[0u8; 28], &blob, &osk).is_err());
    }

    #[test]
    fn transfer_lets_new_owner_decrypt() {
        let (a_sk, a_pk) = kp(b"alice-sig");
        let (b_sk, b_pk) = kp(b"bob-sig");
        let msg = b"a collectible only the owner should see";
        // Alice mints (wraps to herself)
        let (blob, wrapped_for_alice) = encrypt_content(msg, &a_pk).unwrap();
        // Alice transfers to Bob: re-wrap CK to Bob (ciphertext untouched)
        let wrapped_for_bob = rewrap(&wrapped_for_alice, &a_sk, &b_pk).unwrap();
        // Bob can now decrypt
        assert_eq!(decrypt_content(&blob, &wrapped_for_bob, &b_sk).unwrap(), msg);
        // A stranger still cannot
        let (e_sk, _e) = kp(b"eve-sig");
        assert!(decrypt_content(&blob, &wrapped_for_bob, &e_sk).is_err());
    }

    #[test]
    fn empty_and_large_plaintext() {
        let (osk, opk) = kp(b"alice-sig");
        for size in [0usize, 1, 1000, 100_000] {
            let msg = vec![0x5au8; size];
            let (blob, wrapped) = encrypt_content(&msg, &opk).unwrap();
            assert_eq!(decrypt_content(&blob, &wrapped, &osk).unwrap(), msg);
        }
    }

    #[test]
    fn each_encryption_is_unique() {
        // same plaintext + same owner must produce different ciphertext (random CK/nonce)
        let (_osk, opk) = kp(b"alice-sig");
        let (b1, _w1) = encrypt_content(b"same", &opk).unwrap();
        let (b2, _w2) = encrypt_content(b"same", &opk).unwrap();
        assert_ne!(b1, b2, "nonce/CK reuse would be a serious flaw");
    }
}
