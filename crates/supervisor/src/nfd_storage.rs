// Pluggable storage for NFD (Divi Collectibles) encrypted bundles.
//
// The mint/view flow only knows this trait; the backend is swappable. Today a
// local-filesystem stand-in makes the feature work end-to-end offline. Phase 3
// drops in a `Relay` backend (HTTPS POST to a Divi-funded Arweave/Turbo relay)
// with the SAME shape -- callers don't change. An Arweave tx id is 32 bytes,
// exactly the pointer size the on-chain NFD record carries.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub trait Storage {
    /// Store a bundle; return its 32-byte pointer as hex (Arweave tx id for the
    /// real backend; content hash for the local stub).
    fn put(&self, bundle: &[u8]) -> Result<String, String>;
    /// Fetch a bundle by its pointer hex.
    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String>;
}

fn is_pointer(hex: &str) -> bool {
    hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Local-filesystem stand-in for Arweave. Content-addressed: pointer =
/// SHA-256(bundle), stored at `<dir>/<pointer>.bin`. Deterministic + dedups.
pub struct LocalDir {
    dir: PathBuf,
}

impl LocalDir {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
    /// Store under the node datadir so collectibles travel with the wallet.
    pub fn under_datadir(datadir: &Path) -> Self {
        Self::new(datadir.join("nfd_store"))
    }
}

impl Storage for LocalDir {
    fn put(&self, bundle: &[u8]) -> Result<String, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let ptr: String = Sha256::digest(bundle).iter().map(|b| format!("{b:02x}")).collect();
        std::fs::write(self.dir.join(format!("{ptr}.bin")), bundle).map_err(|e| e.to_string())?;
        Ok(ptr)
    }

    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String> {
        // pointer must be exactly 64 hex chars -- blocks path traversal
        if !is_pointer(pointer_hex) {
            return Err("bad storage pointer".into());
        }
        std::fs::read(self.dir.join(format!("{pointer_hex}.bin")))
            .map_err(|_| "content not found in storage".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_get_roundtrip_and_dedup() {
        let dir = std::env::temp_dir().join(format!("nfd_store_test_{}", std::process::id()));
        let s = LocalDir::new(dir.clone());
        let bundle = b"encrypted bundle bytes";
        let ptr = s.put(bundle).unwrap();
        assert_eq!(ptr.len(), 64);
        assert_eq!(s.get(&ptr).unwrap(), bundle);
        // same content -> same pointer (content-addressed dedup)
        assert_eq!(s.put(bundle).unwrap(), ptr);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_rejects_bad_pointer_and_missing() {
        let s = LocalDir::new(std::env::temp_dir().join("nfd_store_test_none"));
        assert!(s.get("../etc/passwd").is_err());
        assert!(s.get(&"ab".repeat(32)).is_err()); // well-formed but absent
    }
}
