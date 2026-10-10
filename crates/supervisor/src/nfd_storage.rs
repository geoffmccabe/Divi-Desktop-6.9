// Pluggable storage for NFD (Divi Collectibles) encrypted bundles.
//
// The mint/view flow only knows this trait; the backend is swappable. Today a
// local-filesystem stand-in makes the feature work end-to-end offline. Phase 3
// drops in a `Relay` backend (HTTPS POST to a Divi-funded Arweave/Turbo relay)
// with the SAME shape -- callers don't change. An Arweave tx id is 32 bytes,
// exactly the pointer size the on-chain NFD record carries.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Default Divi-funded Arweave relay host (see nfd-relay/).
pub const DEFAULT_RELAY_URL: &str = "https://nfds.divi.love";

/// The configured relay URL (NFD_RELAY_URL override, else the default host).
pub fn relay_url() -> String {
    std::env::var("NFD_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY_URL.to_string())
}

/// GET the relay's /health. `Ok(Some(winc))` = reachable and the balance is
/// known; `Ok(None)` = reachable but the balance is withheld (the relay only
/// returns the balance to an authenticated caller, so without NFD_UPLOAD_TOKEN
/// set — or with a token the relay doesn't accept — it answers `{ok:true}` with
/// no balance); `Err` = not reachable. Sends the same bearer token the upload
/// path uses, so a configured operator sees the real balance.
pub fn relay_balance(base_url: &str) -> Result<Option<String>, String> {
    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(12));
    if let Ok(token) = std::env::var("NFD_UPLOAD_TOKEN") {
        req = req.set("Authorization", &format!("Bearer {token}"));
    }
    let resp = req.call().map_err(|e| format!("relay unreachable: {e}"))?;
    let body = resp.into_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    // Reachable: a well-formed health response. Balance may be absent by design.
    Ok(v["balanceWinc"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| v["balanceWinc"].as_i64().map(|n| n.to_string())))
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

/// Public gateway URL for a stored pointer — used to embed a public asset (a
/// collection cover image) inside metadata JSON so marketplaces can resolve it.
pub fn gateway_url(ptr_hex: &str) -> Result<String, String> {
    Ok(format!("https://arweave.net/{}", ptr_to_arweave_id(ptr_hex)?))
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

/// Default GoBanq Assets host (devnet). Override with GOBANQ_API_URL or the
/// `baseUrl` in the credential file.
pub const DEFAULT_GOBANQ_URL: &str = "https://assets-devnet.gobanq.com";
const GOBANQ_UPLOAD_PATH: &str = "/v1/storage/uploads";

/// DD69's GoBanq Assets app login. GoBanq holds the funded Arweave account; DD69
/// only holds this app id + secret (this is NOT an Arweave key and cannot spend
/// Arweave funds directly — it authenticates DD69 to GoBanq, which uploads on its
/// behalf under a spending cap).
#[derive(Clone, Default)]
pub struct GoBanqCred {
    pub base_url: String,
    pub app_id: String,
    pub secret: String,
}

fn gobanq_cred_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("GOBANQ_CRED_FILE") {
        return Some(PathBuf::from(p));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".gobanq-dd69-devnet.json"))
}

/// Load the GoBanq credential: explicit env (GOBANQ_APP_ID/SECRET/API_URL) wins,
/// else a JSON credential file (GOBANQ_CRED_FILE, default
/// ~/.gobanq-dd69-devnet.json) shaped `{ baseUrl, appId, secret }`. Returns None
/// when no usable credential is found.
pub fn gobanq_cred() -> Option<GoBanqCred> {
    if let (Ok(app_id), Ok(secret)) = (std::env::var("GOBANQ_APP_ID"), std::env::var("GOBANQ_APP_SECRET")) {
        if !app_id.is_empty() && !secret.is_empty() {
            let base_url = std::env::var("GOBANQ_API_URL").unwrap_or_else(|_| DEFAULT_GOBANQ_URL.to_string());
            return Some(GoBanqCred { base_url, app_id, secret });
        }
    }
    let text = std::fs::read_to_string(gobanq_cred_path()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let app_id = v["appId"].as_str().unwrap_or_default().to_string();
    let secret = v["secret"].as_str().unwrap_or_default().to_string();
    if app_id.is_empty() || secret.is_empty() {
        return None;
    }
    let base_url = v["baseUrl"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| std::env::var("GOBANQ_API_URL").ok())
        .unwrap_or_else(|| DEFAULT_GOBANQ_URL.to_string());
    Some(GoBanqCred { base_url, app_id, secret })
}

/// GoBanq Assets: stores the bundle (encrypted bundle or public image) on Arweave
/// via GoBanq and returns the same 32-byte pointer the on-chain NFD record
/// carries. Every request is HMAC-SHA256 signed with the app login; downloads
/// come straight from a public gateway, so viewing never depends on GoBanq.
pub struct GoBanq {
    cred: GoBanqCred,
    gateway: String,
    cache: LocalDir,
}

impl GoBanq {
    pub fn new(cred: GoBanqCred, cache: LocalDir) -> Self {
        Self {
            cred,
            gateway: "https://arweave.net".to_string(),
            cache,
        }
    }

    fn configured(&self) -> bool {
        !self.cred.base_url.is_empty() && !self.cred.app_id.is_empty() && !self.cred.secret.is_empty()
    }

    fn now_ms() -> String {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
            .to_string()
    }

    fn nonce() -> String {
        let mut b = [0u8; 18];
        let _ = getrandom::getrandom(&mut b);
        URL_SAFE_NO_PAD.encode(b)
    }

    // canonical = METHOD\npathWithQuery\ntimestamp\nnonce\nsha256hex(body); signed
    // with HMAC-SHA256(secret). Matches GoBanq's client-kit exactly.
    fn sign(&self, method: &str, path: &str, ts: &str, nonce: &str, body: &[u8]) -> String {
        let body_hash: String = Sha256::digest(body).iter().map(|b| format!("{b:02x}")).collect();
        let canonical = format!("{}\n{}\n{}\n{}\n{}", method.to_uppercase(), path, ts, nonce, body_hash);
        let mut mac = Hmac::<Sha256>::new_from_slice(self.cred.secret.as_bytes()).expect("hmac accepts any key length");
        mac.update(canonical.as_bytes());
        mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
    }

    fn base(&self) -> &str {
        self.cred.base_url.trim_end_matches('/')
    }

    fn upload(&self, bytes: &[u8], content_type: &str, encrypted: bool) -> Result<String, String> {
        if !self.configured() {
            return Err("GoBanq storage is not configured (missing the app login at ~/.gobanq-dd69-devnet.json).".to_string());
        }
        let ts = Self::now_ms();
        let nonce = Self::nonce();
        let sig = self.sign("POST", GOBANQ_UPLOAD_PATH, &ts, &nonce, bytes);
        let idem = format!("dd69-{ts}-{}", &nonce[..nonce.len().min(16)]);
        let mut req = ureq::post(&format!("{}{}", self.base(), GOBANQ_UPLOAD_PATH))
            .timeout(std::time::Duration::from_secs(45))
            .set("content-type", content_type)
            .set("x-gobanq-app", &self.cred.app_id)
            .set("x-gobanq-timestamp", &ts)
            .set("x-gobanq-nonce", &nonce)
            .set("x-gobanq-signature", &sig)
            .set("idempotency-key", &idem);
        if encrypted {
            req = req.set("x-gobanq-encrypted", "true");
        }
        let body = req
            .send_bytes(bytes)
            .map_err(|e| format!("GoBanq upload failed: {e}"))?
            .into_string()
            .map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        // A deduplicated upload may already carry the Arweave id.
        if let Some(id) = v["upload"]["arweaveId"].as_str() {
            return arweave_id_to_ptr(id);
        }
        let upload_id = v["upload"]["uploadId"].as_str().ok_or("GoBanq returned no uploadId")?.to_string();
        // The upload runs as a job; poll (signed GET) for the Arweave id.
        for _ in 0..60 {
            let path = format!("{GOBANQ_UPLOAD_PATH}/{upload_id}");
            let ts = Self::now_ms();
            let nonce = Self::nonce();
            let sig = self.sign("GET", &path, &ts, &nonce, &[]);
            let st_body = ureq::get(&format!("{}{}", self.base(), path))
                .timeout(std::time::Duration::from_secs(15))
                .set("x-gobanq-app", &self.cred.app_id)
                .set("x-gobanq-timestamp", &ts)
                .set("x-gobanq-nonce", &nonce)
                .set("x-gobanq-signature", &sig)
                .call()
                .map_err(|e| e.to_string())?
                .into_string()
                .map_err(|e| e.to_string())?;
            let s: serde_json::Value = serde_json::from_str(&st_body).map_err(|e| e.to_string())?;
            if let Some(id) = s["upload"]["arweaveId"].as_str() {
                return arweave_id_to_ptr(id);
            }
            if s["upload"]["status"].as_str() == Some("failed") {
                return Err(format!("GoBanq reported the upload failed: {}", s["upload"]["error"].as_str().unwrap_or("")));
            }
            std::thread::sleep(std::time::Duration::from_millis(750));
        }
        Err("upload did not finish in time; it may still complete.".to_string())
    }
}

impl Storage for GoBanq {
    fn put(&self, bundle: &[u8]) -> Result<String, String> {
        let ptr = self.upload(bundle, "application/octet-stream", true)?;
        let _ = self.cache.put_at(&ptr, bundle);
        Ok(ptr)
    }
    fn put_public(&self, bytes: &[u8], content_type: &str) -> Result<String, String> {
        let ptr = self.upload(bytes, content_type, false)?;
        let _ = self.cache.put_at(&ptr, bytes);
        Ok(ptr)
    }
    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String> {
        if let Ok(b) = self.cache.get(pointer_hex) {
            return Ok(b);
        }
        let id = ptr_to_arweave_id(pointer_hex)?;
        let resp = ureq::get(&format!("{}/{}", self.gateway, id)).call().map_err(|e| format!("fetch failed: {e}"))?;
        let mut buf = Vec::new();
        resp.into_reader().take(64 * 1024 * 1024).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    }
}

/// DiviStore — Divi's own permanent storage. MODULE ONLY for now: it is wired
/// into the backend selector and the mint/view flow, but not yet available. To
/// turn it on when it ships, set `DIVISTORE_READY = true` and implement `put` /
/// `put_public` / `get` here. Until then it reports as unavailable and refuses
/// uploads, while reads fall back to the local cache.
pub const DIVISTORE_READY: bool = false;

pub struct DiviStore {
    cache: LocalDir,
}
impl DiviStore {
    pub fn new(cache: LocalDir) -> Self {
        Self { cache }
    }
}
impl Storage for DiviStore {
    fn put(&self, _bundle: &[u8]) -> Result<String, String> {
        Err("DiviStore is not available yet.".to_string())
    }
    fn put_public(&self, _bytes: &[u8], _content_type: &str) -> Result<String, String> {
        Err("DiviStore is not available yet.".to_string())
    }
    fn get(&self, pointer_hex: &str) -> Result<Vec<u8>, String> {
        self.cache.get(pointer_hex)
    }
}

/// The selectable storage backends.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Backend {
    Local,
    Relay,
    GoBanq,
    DiviStore,
}
impl Backend {
    pub fn id(self) -> &'static str {
        match self {
            Backend::Local => "local",
            Backend::Relay => "relay",
            Backend::GoBanq => "gobanq",
            Backend::DiviStore => "divistore",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Backend::Local => "On this device (testing)",
            Backend::Relay => "Arweave relay (Divi-funded)",
            Backend::GoBanq => "GoBanq (Arweave)",
            Backend::DiviStore => "DiviStore",
        }
    }
    pub fn from_id(s: &str) -> Option<Backend> {
        match s {
            "local" => Some(Backend::Local),
            "relay" => Some(Backend::Relay),
            "gobanq" => Some(Backend::GoBanq),
            "divistore" => Some(Backend::DiviStore),
            _ => None,
        }
    }
}

fn storage_config_path(datadir: &Path) -> PathBuf {
    datadir.join("nfd_storage_config.json")
}
fn read_backend_choice(datadir: &Path) -> Option<Backend> {
    let text = std::fs::read_to_string(storage_config_path(datadir)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    Backend::from_id(v["backend"].as_str()?)
}

/// The active backend: env `NFD_STORAGE` wins (back-compat with regtest tests),
/// else the saved choice, else the local stub.
pub fn active_backend(datadir: &Path) -> Backend {
    if let Ok(e) = std::env::var("NFD_STORAGE") {
        if let Some(b) = Backend::from_id(&e) {
            return b;
        }
    }
    read_backend_choice(datadir).unwrap_or(Backend::Local)
}

/// Persist the active backend. Refuses DiviStore until it is ready.
pub fn set_backend(datadir: &Path, id: &str) -> Result<(), String> {
    let b = Backend::from_id(id).ok_or_else(|| "unknown storage backend".to_string())?;
    if b == Backend::DiviStore && !DIVISTORE_READY {
        return Err("DiviStore is not available yet.".to_string());
    }
    std::fs::create_dir_all(datadir).map_err(|e| e.to_string())?;
    std::fs::write(storage_config_path(datadir), serde_json::json!({ "backend": b.id() }).to_string()).map_err(|e| e.to_string())
}

/// The backend list + which is active, for the panel's Storage section.
pub fn backends_status(datadir: &Path) -> serde_json::Value {
    let active = active_backend(datadir);
    let gb = gobanq_cred();
    serde_json::json!({
        "active": active.id(),
        "backends": [
            { "id": "local", "label": Backend::Local.label(), "available": true, "detail": "Stored on this device only — for testing." },
            { "id": "relay", "label": Backend::Relay.label(), "available": true, "detail": format!("Uploads to {}", relay_url()) },
            { "id": "gobanq", "label": Backend::GoBanq.label(), "available": gb.is_some(),
              "detail": match &gb { Some(c) => format!("Uploads to Arweave via GoBanq ({}).", c.base_url), None => "Not configured yet — missing the GoBanq app login.".to_string() } },
            { "id": "divistore", "label": Backend::DiviStore.label(), "available": DIVISTORE_READY,
              "detail": if DIVISTORE_READY { "Divi's own permanent storage.".to_string() } else { "Coming soon — Divi's own permanent storage.".to_string() } }
        ]
    })
}

/// Pick the storage backend for a node, honoring the active selection. The local
/// stub works offline; Relay and GoBanq both cache locally so a just-uploaded
/// item is viewable before a gateway serves it; DiviStore is a wired-but-off
/// module. Default is the local stub.
pub fn for_node(datadir: &Path) -> Box<dyn Storage> {
    match active_backend(datadir) {
        Backend::Relay => Box::new(CachedRelay::new(Relay::new(&relay_url()), LocalDir::under_datadir(datadir))),
        Backend::GoBanq => Box::new(GoBanq::new(gobanq_cred().unwrap_or_default(), LocalDir::under_datadir(datadir))),
        Backend::DiviStore => Box::new(DiviStore::new(LocalDir::under_datadir(datadir))),
        Backend::Local => Box::new(LocalDir::under_datadir(datadir)),
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
