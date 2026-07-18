// Pluggable storage for NFD (Divi Collectibles) encrypted bundles.
//
// The mint/view flow only knows this trait; the backend is swappable. Today a
// local-filesystem stand-in makes the feature work end-to-end offline. Phase 3
// drops in a `Relay` backend (HTTPS POST to a Divi-funded Arweave/Turbo relay)
// with the SAME shape -- callers don't change. An Arweave tx id is 32 bytes,
// exactly the pointer size the on-chain NFD record carries.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Default Divi-funded Arweave relay host (see nfd-relay/).
pub const DEFAULT_RELAY_URL: &str = "https://nfds.divi.love";

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

// A 32-byte Arweave tx id <-> our 64-char hex pointer.
fn arweave_id_to_ptr(id_b64url: &str) -> Result<String, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(id_b64url.trim())
        .map_err(|_| "relay returned a malformed id".to_string())?;
    if bytes.len() != 32 {
        return Err("relay id is not 32 bytes".into());
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn ptr_to_arweave_id(ptr_hex: &str) -> Result<String, String> {
    if !is_pointer(ptr_hex) {
        return Err("bad storage pointer".into());
    }
    let mut bytes = [0u8; 32];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = u8::from_str_radix(&ptr_hex[i * 2..i * 2 + 2], 16).map_err(|_| "bad pointer".to_string())?;
    }
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Divi-funded Arweave relay: uploads POST to `<base>/upload` (which returns an
/// Arweave tx id); downloads come from a public gateway. The bundle is already
/// encrypted, so the relay never sees plaintext. Optional bearer token
/// (NFD_UPLOAD_TOKEN) gates the funded endpoint.
pub struct Relay {
    upload_url: String,
    gateway: String,
}

impl Relay {
    pub fn new(base_url: &str) -> Self {
        let base = base_url.trim_end_matches('/');
        Self {
            upload_url: format!("{base}/upload"),
            gateway: "https://arweave.net".to_string(),
        }
    }
}

impl Storage for Relay {
    fn put(&self, bundle: &[u8]) -> Result<String, String> {
        let mut req = ureq::post(&self.upload_url).set("Content-Type", "application/octet-stream");
        if let Ok(token) = std::env::var("NFD_UPLOAD_TOKEN") {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let resp = req.send_bytes(bundle).map_err(|e| format!("upload failed: {e}"))?;
        let body = resp.into_string().map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let id = v["id"].as_str().ok_or("relay returned no id")?;
        arweave_id_to_ptr(id)
    }

    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String> {
        let id = ptr_to_arweave_id(pointer_hex)?;
        let resp = ureq::get(&format!("{}/{}", self.gateway, id))
            .call()
            .map_err(|e| format!("fetch failed: {e}"))?;
        let mut buf = Vec::new();
        resp.into_reader()
            .take(64 * 1024 * 1024) // cap a hostile gateway response at 64 MiB
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        Ok(buf)
    }
}

/// Pick the storage backend. Default is the local stub (works offline, for
/// testing); set `NFD_STORAGE=relay` to use the Divi-funded Arweave relay
/// (`NFD_RELAY_URL` overrides the default host).
pub fn for_node(datadir: &Path) -> Box<dyn Storage> {
    if std::env::var("NFD_STORAGE").as_deref() == Ok("relay") {
        let url = std::env::var("NFD_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY_URL.to_string());
        Box::new(Relay::new(&url))
    } else {
        Box::new(LocalDir::under_datadir(datadir))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arweave_pointer_roundtrips() {
        // a real Arweave id is 32 bytes base64url; must survive id->ptr->id
        let ptr = "ab".repeat(32);
        let id = ptr_to_arweave_id(&ptr).unwrap();
        assert_eq!(arweave_id_to_ptr(&id).unwrap(), ptr);
        assert!(ptr_to_arweave_id("nothex").is_err());
        assert!(arweave_id_to_ptr("!!!!").is_err());
    }

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
