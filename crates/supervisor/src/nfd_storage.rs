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

/// The configured relay URL (NFD_RELAY_URL override, else the default host).
pub fn relay_url() -> String {
    std::env::var("NFD_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY_URL.to_string())
}

/// GET the relay's /health, returning the Turbo credit balance (winc) or an
/// error if the relay isn't reachable/configured.
pub fn relay_balance(base_url: &str) -> Result<String, String> {
    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let resp = ureq::get(&url).timeout(std::time::Duration::from_secs(12)).call().map_err(|e| format!("relay unreachable: {e}"))?;
    let body = resp.into_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    v["balanceWinc"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| v["balanceWinc"].as_i64().map(|n| n.to_string()))
        .ok_or_else(|| "relay returned no balance".to_string())
}

pub trait Storage {
    /// Store a bundle; return its 32-byte pointer as hex (Arweave tx id for the
    /// real backend; content hash for the local stub).
    fn put(&self, bundle: &[u8]) -> Result<String, String>;
    /// Fetch a bundle by its pointer hex.
    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String>;
    /// Store PUBLIC (unencrypted) bytes tagged with a content type, so a gateway
    /// serves them correctly — used for the optional public thumbnail. Defaults
    /// to `put` for backends that don't distinguish (the local stub).
    fn put_public(&self, bytes: &[u8], _content_type: &str) -> Result<String, String> {
        self.put(bytes)
    }
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

    /// Store a bundle at an explicit pointer (used as a cache keyed by the
    /// Arweave id, so a just-uploaded item is viewable before the gateway serves it).
    pub fn put_at(&self, pointer_hex: &str, bundle: &[u8]) -> Result<(), String> {
        if !is_pointer(pointer_hex) {
            return Err("bad storage pointer".into());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        std::fs::write(self.dir.join(format!("{pointer_hex}.bin")), bundle).map_err(|e| e.to_string())?;
        Ok(())
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

    // The relay tags the Arweave upload with this Content-Type, so a gateway
    // serves it correctly (opaque octet-stream for the encrypted bundle; the
    // real image type for a public thumbnail).
    fn upload(&self, bytes: &[u8], content_type: &str) -> Result<String, String> {
        let mut req = ureq::post(&self.upload_url).set("Content-Type", content_type);
        if let Ok(token) = std::env::var("NFD_UPLOAD_TOKEN") {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let resp = req.send_bytes(bytes).map_err(|e| format!("upload failed: {e}"))?;
        let body = resp.into_string().map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let id = v["id"].as_str().ok_or("relay returned no id")?;
        arweave_id_to_ptr(id)
    }
}

impl Storage for Relay {
    fn put(&self, bundle: &[u8]) -> Result<String, String> {
        self.upload(bundle, "application/octet-stream")
    }

    fn put_public(&self, bytes: &[u8], content_type: &str) -> Result<String, String> {
        self.upload(bytes, content_type)
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

/// Relay + local cache. Uploads go to Arweave (permanent source of truth) AND a
/// local copy, so view is instant even before the gateway serves the new item;
/// get() prefers the cache and falls back to the gateway.
pub struct CachedRelay {
    relay: Relay,
    cache: LocalDir,
}

impl CachedRelay {
    pub fn new(relay: Relay, cache: LocalDir) -> Self {
        Self { relay, cache }
    }
}

impl Storage for CachedRelay {
    fn put(&self, bundle: &[u8]) -> Result<String, String> {
        let ptr = self.relay.put(bundle)?; // Arweave id = the on-chain pointer
        let _ = self.cache.put_at(&ptr, bundle); // best-effort local cache
        Ok(ptr)
    }

    fn put_public(&self, bytes: &[u8], content_type: &str) -> Result<String, String> {
        let ptr = self.relay.put_public(bytes, content_type)?;
        let _ = self.cache.put_at(&ptr, bytes);
        Ok(ptr)
    }

    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String> {
        match self.cache.get(pointer_hex) {
            Ok(b) => Ok(b),
            Err(_) => self.relay.get(pointer_hex),
        }
    }
}

/// Pick the storage backend. Default is the local stub (works offline, for
/// testing); set `NFD_STORAGE=relay` to use the Divi-funded Arweave relay
/// (`NFD_RELAY_URL` overrides the default host), which also caches locally.
pub fn for_node(datadir: &Path) -> Box<dyn Storage> {
    if std::env::var("NFD_STORAGE").as_deref() == Ok("relay") {
        let url = std::env::var("NFD_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY_URL.to_string());
        Box::new(CachedRelay::new(Relay::new(&url), LocalDir::under_datadir(datadir)))
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
    fn put_at_explicit_pointer() {
        let dir = std::env::temp_dir().join(format!("nfd_cache_test_{}", std::process::id()));
        let s = LocalDir::new(dir.clone());
        let ptr = "cd".repeat(32);
        s.put_at(&ptr, b"cached bundle").unwrap();
        assert_eq!(s.get(&ptr).unwrap(), b"cached bundle");
        assert!(s.put_at("bad", b"x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_rejects_bad_pointer_and_missing() {
        let s = LocalDir::new(std::env::temp_dir().join("nfd_store_test_none"));
        assert!(s.get("../etc/passwd").is_err());
        assert!(s.get(&"ab".repeat(32)).is_err()); // well-formed but absent
    }
}
