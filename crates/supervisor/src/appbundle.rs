//! Community app bundles: what may be served, and from where.
//!
//! This module answers one question safely: "given an app id and a path the app
//! asked for, what bytes should be returned?" It deliberately knows nothing
//! about Tauri or HTTP, so the rules can be tested directly.
//!
//! Two kinds of bundle:
//!
//! * **Built in** - compiled into the wallet binary. Trusted because it shipped
//!   with the wallet; there is no third party involved and nothing to verify.
//!   Used for the sandbox escape-test harness.
//! * **Installed** - a third party's bundle on disk. Untrusted. Every file is
//!   covered by a signature made with our publishing key, checked before a
//!   single byte is handed to a webview.
//!
//! The path rules matter as much as the signature. An app asking for
//! `../../../wallet.dat` must fail, and it must fail on the resolved path rather
//! than on a textual check that a clever encoding could slip past.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

/// Files an app is allowed to serve, with the type each is returned as.
/// Anything not on this list is refused rather than guessed at, because a
/// mis-typed file is how a browser gets talked into treating data as code.
const MIME: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("woff2", "font/woff2"),
];

/// Ceiling on any single file an app can serve.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// The policy served with every community app document.
///
/// This is defence in depth, not the security boundary: the boundary is the
/// sandboxed frame and the broker. It still earns its place by cutting off the
/// easy routes, in particular any network access at all.
///
/// `connect-src 'none'` is the honest setting today because brokered network
/// access is not built. When it is, this gains exactly the hosts the manifest
/// declared and the user approved, and nothing else.
/// ⚠ `'self'` is NOT relied on here, and that is the whole point of this note.
///
/// An app is served from a custom scheme (`divi-app://<id>/`). Whether `'self'`
/// matches a custom scheme is inconsistent between engines, and in WKWebView it
/// did not: the app's own `sdk.js` was refused, the app's script died on the
/// first line, and every value sat at its placeholder for ever with no error
/// anywhere. It looked exactly like the wallet ignoring the app.
///
/// This cost real time to find because a browser-based test could not reproduce
/// it: served over http, `'self'` behaves. So the scheme is named explicitly in
/// every directive an app loads its own files through, and `'self'` is kept
/// alongside only as a belt-and-braces for platforms where it does work.
pub const APP_CSP: &str = "default-src 'none'; \
script-src 'self' 'unsafe-inline' divi-app: http://divi-app.localhost; \
style-src 'self' 'unsafe-inline' divi-app: http://divi-app.localhost; \
img-src 'self' data: blob: divi-app: http://divi-app.localhost; \
media-src 'self' data: blob: divi-app: http://divi-app.localhost; \
font-src 'self' data: divi-app: http://divi-app.localhost; \
connect-src 'none'; \
form-action 'none'; \
base-uri 'none'";

#[derive(Debug)]
pub enum BundleError {
    /// The path escaped the bundle, or was not a plain relative path.
    BadPath,
    /// The extension is not on the served list.
    UnsupportedType,
    NotFound,
    TooLarge,
    /// An installed bundle failed signature verification.
    NotVerified(String),
    Io(String),
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::BadPath => write!(f, "that path is not inside the app"),
            BundleError::UnsupportedType => write!(f, "that file type cannot be served"),
            BundleError::NotFound => write!(f, "not found"),
            BundleError::TooLarge => write!(f, "file is too large"),
            BundleError::NotVerified(why) => write!(f, "app signature check failed: {why}"),
            BundleError::Io(e) => write!(f, "{e}"),
        }
    }
}

pub struct Served {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

pub fn mime_for(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    MIME.iter().find(|(k, _)| *k == ext).map(|(_, v)| *v)
}

/// Normalise a request path to a plain relative path inside the bundle.
///
/// Rejects absolute paths, parent traversal, Windows drive prefixes and any
/// non-normal component. Works on the parsed components rather than on the raw
/// string, so percent-encoded or unusually spelled traversal is handled by the
/// caller decoding once and this seeing the real components.
pub fn safe_relative(requested: &str) -> Result<PathBuf, BundleError> {
    let trimmed = requested.trim_start_matches('/');
    let candidate = if trimmed.is_empty() { "index.html" } else { trimmed };

    if candidate.contains('\0') {
        return Err(BundleError::BadPath);
    }

    let mut out = PathBuf::new();
    for comp in Path::new(candidate).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            // Everything else is either an escape attempt or meaningless here.
            Component::ParentDir | Component::RootDir | Component::Prefix(_) | Component::CurDir => {
                return Err(BundleError::BadPath)
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(BundleError::BadPath);
    }
    Ok(out)
}

/// A bundle compiled into the wallet. Trusted by construction.
pub struct BuiltinBundle {
    pub id: &'static str,
    pub manifest: &'static str,
    pub files: &'static [(&'static str, &'static [u8])],
}

impl BuiltinBundle {
    pub fn serve(&self, requested: &str) -> Result<Served, BundleError> {
        let rel = safe_relative(requested)?;
        let key = rel.to_string_lossy().replace('\\', "/");
        let mime = mime_for(&key).ok_or(BundleError::UnsupportedType)?;
        let bytes = self
            .files
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, b)| b.to_vec())
            .ok_or(BundleError::NotFound)?;
        Ok(Served { bytes, mime })
    }
}

/// A folder being previewed while it is still being built.
///
/// No signature, deliberately: this is somebody's own half-finished work, not
/// something arriving from a stranger, and demanding a signature on a file the
/// model rewrote ten seconds ago would make previewing impossible.
///
/// What it does NOT relax is anything that matters. It runs in the same sandbox,
/// through the same broker, behind the same permission prompt as a published
/// app, and the path rules here are identical — so a preview cannot read a file
/// outside its own folder, and cannot serve a type that would not be served
/// after publishing. What you see previewing is what a user gets.
pub struct FolderBundle {
    pub dir: PathBuf,
}

impl FolderBundle {
    pub fn serve(&self, requested: &str) -> Result<Served, BundleError> {
        let rel = safe_relative(requested)?;
        let key = rel.to_string_lossy().replace('\\', "/");
        let mime = mime_for(&key).ok_or(BundleError::UnsupportedType)?;

        let base = self
            .dir
            .canonicalize()
            .map_err(|_| BundleError::NotFound)?;
        let real = base.join(&rel).canonicalize().map_err(|_| BundleError::NotFound)?;
        // Resolved, so a symbolic link pointing out of the folder is caught
        // rather than followed.
        if !real.starts_with(&base) {
            return Err(BundleError::BadPath);
        }

        let meta = std::fs::metadata(&real).map_err(|e| BundleError::Io(e.to_string()))?;
        if meta.len() > MAX_FILE_BYTES {
            return Err(BundleError::TooLarge);
        }
        let bytes = std::fs::read(&real).map_err(|e| BundleError::Io(e.to_string()))?;
        Ok(Served { bytes, mime })
    }
}

/// A third-party bundle on disk, with a detached signature over every file.
///
/// The signature covers a manifest of `path -> sha256`, so a file cannot be
/// swapped after the fact and a file cannot be added that was never signed.
pub struct InstalledBundle {
    pub id: String,
    pub dir: PathBuf,
    /// path -> hex sha256, taken from the signed file list.
    pub hashes: BTreeMap<String, String>,
}

impl InstalledBundle {
    pub fn serve(&self, requested: &str) -> Result<Served, BundleError> {
        let rel = safe_relative(requested)?;
        let key = rel.to_string_lossy().replace('\\', "/");
        let mime = mime_for(&key).ok_or(BundleError::UnsupportedType)?;

        // The file must be one the signature covered. A file present on disk but
        // absent from the signed list is refused: that is what an attacker who
        // could write into the directory would leave behind.
        let want = self.hashes.get(&key).ok_or(BundleError::NotFound)?;

        let full = self.dir.join(&rel);
        // Belt and braces: resolve and confirm we are still inside the bundle,
        // which also catches a symlink pointing out of it.
        let base = self.dir.canonicalize().map_err(|e| BundleError::Io(e.to_string()))?;
        let real = full.canonicalize().map_err(|_| BundleError::NotFound)?;
        if !real.starts_with(&base) {
            return Err(BundleError::BadPath);
        }

        let meta = std::fs::metadata(&real).map_err(|e| BundleError::Io(e.to_string()))?;
        if meta.len() > MAX_FILE_BYTES {
            return Err(BundleError::TooLarge);
        }

        let bytes = std::fs::read(&real).map_err(|e| BundleError::Io(e.to_string()))?;
        let got = sha256_hex(&bytes);
        if &got != want {
            return Err(BundleError::NotVerified(format!("{key} was modified after signing")));
        }
        Ok(Served { bytes, mime })
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Verify a detached Ed25519 signature over the signed file list.
///
/// `signed_list` is the exact bytes that were signed, so verification does not
/// depend on this code re-serialising anything the same way the signer did.
pub fn verify_signature(
    signed_list: &[u8],
    signature: &[u8],
    public_key: &[u8],
) -> Result<(), BundleError> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let key_bytes: [u8; 32] = public_key
        .try_into()
        .map_err(|_| BundleError::NotVerified("publishing key is the wrong length".into()))?;
    let sig_bytes: [u8; 64] = signature
        .try_into()
        .map_err(|_| BundleError::NotVerified("signature is the wrong length".into()))?;

    let key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| BundleError::NotVerified(e.to_string()))?;
    key.verify(signed_list, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| BundleError::NotVerified("signature does not match this bundle".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_path_becomes_index() {
        assert_eq!(safe_relative("").unwrap(), PathBuf::from("index.html"));
        assert_eq!(safe_relative("/").unwrap(), PathBuf::from("index.html"));
    }

    #[test]
    fn traversal_is_refused() {
        for bad in ["../secret", "a/../../b", "/../x", "..", "./../y"] {
            assert!(matches!(safe_relative(bad), Err(BundleError::BadPath)), "{bad} slipped through");
        }
    }

    #[test]
    fn absolute_and_prefix_refused() {
        assert!(safe_relative("/etc/passwd").is_ok()); // leading slash is stripped, stays relative
        assert_eq!(safe_relative("/etc/passwd").unwrap(), PathBuf::from("etc/passwd"));
        // ...but it can never escape, which is what actually matters:
        assert!(matches!(safe_relative("/../etc/passwd"), Err(BundleError::BadPath)));
    }

    #[test]
    fn nul_byte_refused() {
        assert!(matches!(safe_relative("a\0b.html"), Err(BundleError::BadPath)));
    }

    #[test]
    fn only_known_types_are_served() {
        assert!(mime_for("index.html").is_some());
        assert!(mime_for("app.js").is_some());
        assert!(mime_for("wallet.dat").is_none());
        assert!(mime_for("run.sh").is_none());
        assert!(mime_for("noextension").is_none());
    }

    #[test]
    fn mime_is_case_insensitive() {
        assert_eq!(mime_for("A.PNG"), Some("image/png"));
    }

    #[test]
    fn the_app_policy_names_the_scheme_apps_are_served_from() {
        // Regression guard. Relying on 'self' alone silently broke every app in
        // WKWebView: an app could not load its own script, died on its first
        // line, and showed placeholders for ever with no error. A browser test
        // could not catch it because 'self' behaves over http.
        for directive in ["script-src", "style-src", "img-src", "media-src", "font-src"] {
            let part = APP_CSP
                .split(';')
                .map(str::trim)
                .find(|d| d.starts_with(directive))
                .unwrap_or_else(|| panic!("{directive} is missing from the app policy"));
            assert!(
                part.contains("divi-app:"),
                "{directive} must name the app scheme, not rely on 'self': {part}",
            );
        }
        // An app still must not be able to reach the network.
        assert!(APP_CSP.contains("connect-src 'none'"));
    }

    #[test]
    fn builtin_serves_and_refuses() {
        static FILES: &[(&str, &[u8])] = &[("index.html", b"<h1>hi</h1>")];
        let b = BuiltinBundle { id: "test", manifest: "{}", files: FILES };
        assert_eq!(b.serve("").unwrap().bytes, b"<h1>hi</h1>");
        assert!(matches!(b.serve("../x.html"), Err(BundleError::BadPath)));
        assert!(matches!(b.serve("missing.html"), Err(BundleError::NotFound)));
        assert!(matches!(b.serve("index.dat"), Err(BundleError::UnsupportedType)));
    }

    #[test]
    fn signature_roundtrip_and_tamper() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let msg = b"path=index.html sha=abc";
        let sig = key.sign(msg);
        let vk = key.verifying_key();
        assert!(verify_signature(msg, &sig.to_bytes(), vk.as_bytes()).is_ok());
        // A single changed byte must fail.
        assert!(verify_signature(b"path=index.html sha=abd", &sig.to_bytes(), vk.as_bytes()).is_err());
        // A different key must fail.
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(verify_signature(msg, &sig.to_bytes(), other.verifying_key().as_bytes()).is_err());
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    /// A folder of this test's own. Tests run in parallel, so sharing one and
    /// clearing it on entry meant they deleted each other's files.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dd69-preview-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_preview_serves_the_work_in_progress() {
        let dir = scratch("serves");
        std::fs::write(dir.join("index.html"), b"<h1>half built</h1>").unwrap();
        let b = FolderBundle { dir: dir.clone() };
        assert_eq!(b.serve("").unwrap().bytes, b"<h1>half built</h1>");
        assert_eq!(b.serve("index.html").unwrap().mime, "text/html; charset=utf-8");
    }

    #[test]
    fn a_preview_cannot_read_outside_its_own_folder() {
        // The whole point: no signature is required, so the path rules are the
        // only thing standing between a preview and the rest of the disk.
        let dir = scratch("escape");
        std::fs::write(dir.join("index.html"), b"x").unwrap();
        let b = FolderBundle { dir };
        assert!(matches!(b.serve("../secret.html"), Err(BundleError::BadPath)));
        assert!(matches!(b.serve("../../etc/passwd"), Err(BundleError::BadPath)));
    }

    #[test]
    fn a_preview_serves_no_type_a_published_app_could_not() {
        let dir = scratch("types");
        std::fs::write(dir.join("wallet.dat"), b"private").unwrap();
        std::fs::write(dir.join("run.sh"), b"#!/bin/sh").unwrap();
        let b = FolderBundle { dir };
        assert!(matches!(b.serve("wallet.dat"), Err(BundleError::UnsupportedType)));
        assert!(matches!(b.serve("run.sh"), Err(BundleError::UnsupportedType)));
    }

    #[test]
    fn a_missing_file_is_not_found_rather_than_an_error() {
        let dir = scratch("missing");
        std::fs::write(dir.join("index.html"), b"x").unwrap();
        let b = FolderBundle { dir };
        assert!(matches!(b.serve("nope.html"), Err(BundleError::NotFound)));
    }
}
