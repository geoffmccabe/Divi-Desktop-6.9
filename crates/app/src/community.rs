//! Serving community apps to the webview.
//!
//! Each app is served from its OWN url scheme rather than injected into a frame
//! as inline content. That is not a style preference, it is the difference
//! between working and not: a frame built from inline content (srcdoc, blob or
//! data) inherits the CSP of the document that created it, so every community app
//! would inherit the wallet's own strict `script-src` and its code would be
//! blocked. Loading over a real scheme gives each app its own origin and its own
//! policy, set here in the response headers.
//!
//! The rules about what may be served live in `dd69_supervisor::appbundle`, away
//! from Tauri types so they can be tested directly. This file is the plumbing.

use std::borrow::Cow;

use dd69_supervisor::appbundle::{BuiltinBundle, BundleError, APP_CSP};
use tauri::http::{Request, Response};
use tauri::UriSchemeContext;

pub const SCHEME: &str = "divi-app";

/// Apps compiled into the wallet. Trusted because they shipped with it.
///
/// The escape-test harness is here rather than as an installed bundle on purpose:
/// it must be runnable on a clean machine with no store, no network and no
/// signing key, because its whole job is to prove the sandbox before any of that
/// exists.
static HARNESS_FILES: &[(&str, &[u8])] = &[
    ("index.html", include_bytes!("community/harness/index.html")),
    ("sdk.js", include_bytes!("community/harness/sdk.js")),
    ("thumb.svg", include_bytes!("community/harness/thumb.svg")),
];

static BUILTINS: &[BuiltinBundle] = &[BuiltinBundle {
    id: "io.divi.sandbox-test",
    manifest: include_str!("community/harness/manifest.json"),
    files: HARNESS_FILES,
}];

pub fn builtin(id: &str) -> Option<&'static BuiltinBundle> {
    BUILTINS.iter().find(|b| b.id == id)
}

/// The manifests of every built-in app, as raw JSON for the front end to parse
/// with the same validator it uses for everything else.
#[tauri::command]
pub fn community_builtin_apps() -> Vec<String> {
    BUILTINS.iter().map(|b| b.manifest.to_string()).collect()
}

/// The base url an app is served from.
///
/// Built in Rust because the shape differs by platform: Windows and Android
/// route custom schemes through a localhost http origin, everything else uses
/// the scheme directly. Getting this wrong in the front end would produce a
/// blank frame with no obvious cause.
#[tauri::command]
pub fn community_app_base(app_id: String) -> Result<String, String> {
    if builtin(&app_id).is_none() {
        return Err("unknown app".into());
    }
    Ok(base_url(&app_id))
}

fn base_url(app_id: &str) -> String {
    if cfg!(any(windows, target_os = "android")) {
        format!("http://{SCHEME}.localhost/{app_id}/")
    } else {
        format!("{SCHEME}://{app_id}/")
    }
}

/// Split a request into (app id, path within the bundle).
///
/// Windows and Android put the app id in the first path segment because the host
/// is fixed; elsewhere the app id is the host.
fn split_target(req: &Request<Vec<u8>>) -> Option<(String, String)> {
    let uri = req.uri();
    let path = uri.path().trim_start_matches('/').to_string();

    if cfg!(any(windows, target_os = "android")) {
        let mut parts = path.splitn(2, '/');
        let id = parts.next()?.to_string();
        let rest = parts.next().unwrap_or("").to_string();
        if id.is_empty() {
            return None;
        }
        Some((id, rest))
    } else {
        let host = uri.host()?.to_string();
        Some((host, path))
    }
}

fn error_response(status: u16, message: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        // Even an error page gets the app policy, so a mistake here cannot
        // become a document with no restrictions at all.
        .header("Content-Security-Policy", APP_CSP)
        .body(Cow::Owned(message.as_bytes().to_vec()))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"error".as_slice())))
}

pub fn handle<R: tauri::Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    // Community apps are read-only static bundles. Anything other than a plain
    // read is refused rather than quietly treated as a GET.
    if req.method() != "GET" {
        return error_response(405, "only GET is allowed");
    }

    let Some((app_id, path)) = split_target(&req) else {
        return error_response(400, "malformed app url");
    };

    // Percent-decoding happens once, here, before the path rules run, so those
    // rules see the real components rather than an encoded spelling of them.
    let decoded = percent_decode(&path);

    let Some(bundle) = builtin(&app_id) else {
        return error_response(404, "unknown app");
    };

    match bundle.serve(&decoded) {
        Ok(served) => Response::builder()
            .status(200)
            .header("Content-Type", served.mime)
            .header("Content-Security-Policy", APP_CSP)
            // Nothing about an app bundle should be sniffed, cached across
            // versions, or handed a referrer.
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(served.bytes))
            .unwrap_or_else(|_| error_response(500, "could not build response")),
        Err(e) => {
            let status = match e {
                BundleError::NotFound => 404,
                BundleError::BadPath | BundleError::UnsupportedType => 403,
                BundleError::TooLarge => 413,
                BundleError::NotVerified(_) => 403,
                BundleError::Io(_) => 500,
            };
            error_response(status, &e.to_string())
        }
    }
}

/// Minimal percent-decoder. Only used on a path that is then run through the
/// bundle path rules, which reject anything that is not a plain relative path.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_manifest_is_valid_json_and_matches_its_id() {
        let b = builtin("io.divi.sandbox-test").expect("harness is registered");
        let v: serde_json::Value = serde_json::from_str(b.manifest).expect("manifest parses");
        assert_eq!(v["id"], "io.divi.sandbox-test");
        // The thumbnail the manifest names must actually be in the bundle,
        // otherwise the store card renders a broken image.
        let thumb = v["media"]["thumbnail"].as_str().unwrap();
        assert!(b.files.iter().any(|(n, _)| *n == thumb));
    }

    #[test]
    fn harness_serves_its_own_files() {
        let b = builtin("io.divi.sandbox-test").unwrap();
        assert!(b.serve("index.html").is_ok());
        assert!(b.serve("sdk.js").is_ok());
        assert!(b.serve("").is_ok(), "empty path should serve index.html");
    }

    #[test]
    fn percent_encoded_traversal_is_decoded_then_refused() {
        // %2e%2e%2f is "../". If decoding happened after the path rules, this
        // would sail straight through them.
        let decoded = percent_decode("%2e%2e%2fsecret.html");
        assert_eq!(decoded, "../secret.html");
        let b = builtin("io.divi.sandbox-test").unwrap();
        assert!(matches!(b.serve(&decoded), Err(BundleError::BadPath)));
    }

    #[test]
    fn base_url_names_the_app() {
        assert!(base_url("io.divi.sandbox-test").contains("io.divi.sandbox-test"));
    }
}
