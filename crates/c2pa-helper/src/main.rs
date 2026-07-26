//! Standalone reader for C2PA "Content Credentials".
//!
//! This binary exists so the heavy `c2pa` dependency tree lives OUTSIDE the main
//! DD69 app. The app spawns this helper, writes a file's raw bytes to its stdin,
//! and reads a JSON summary back from stdout. Usage:
//!
//!     c2pa-helper <format>   < file-bytes-on-stdin
//!
//! `<format>` is the file extension or MIME type (the SDK accepts either).
//! On success it prints one JSON object (the summary) to stdout and exits 0.
//! On failure it prints a short message to stderr and exits 1. "No credentials"
//! is NOT a failure — it prints a summary with `present: false` and exits 0.
//!
//! Honesty notes carried over from the original in-app reader, because this area
//! invites overclaiming:
//!
//!  * Nothing here is "C2PA compliant". Compliance is a formal conformance
//!    listing for products that GENERATE credentials. Reading them requires no
//!    permission and confers no certification.
//!  * `fetch_remote_manifests` is deliberately NOT enabled, so reading a file
//!    never causes a network request. What we report comes from the file alone.
//!  * Without a configured trust list, a signature can be cryptographically
//!    sound while the signer is still unknown to us. Those are different
//!    statements and the UI keeps them apart.
//!  * A valid credential says the file matches what the signer claimed. It does
//!    not mean the picture is true, and it says nothing about AI unless the
//!    manifest itself asserts it.

use c2pa::{Context, Reader};
use serde_json::json;
use std::io::{Cursor, Read, Write};

/// The reverse-domain label a Divi anchor would use inside a manifest. C2PA
/// requires vendor assertions to be namespaced by a domain you control — a bare
/// "divi.poe" would not be conformant.
const DIVI_POE_LABEL: &str = "org.divi.poe";

fn main() {
    let format = std::env::args().nth(1).unwrap_or_default();
    if format.is_empty() {
        eprintln!("usage: c2pa-helper <format>  (file bytes on stdin)");
        std::process::exit(2);
    }

    let mut bytes = Vec::new();
    if let Err(e) = std::io::stdin().read_to_end(&mut bytes) {
        eprintln!("could not read the file from stdin: {e}");
        std::process::exit(1);
    }

    match read(bytes, &format) {
        Ok(summary) => {
            let mut out = std::io::stdout();
            if out.write_all(summary.to_string().as_bytes()).is_err() {
                std::process::exit(1);
            }
        }
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(1);
        }
    }
}

/// Read credentials from raw file bytes and return the summary as a JSON value.
/// The field names match the DTO the app expects (snake_case), so the app can
/// deserialize this without any transformation.
fn read(bytes: Vec<u8>, format: &str) -> Result<serde_json::Value, String> {
    // Explicit Context rather than the deprecated from_stream(), which relies on
    // thread-local settings — the wrong shape here.
    let reader = match Reader::from_context(Context::new()).with_stream(format, Cursor::new(bytes)) {
        Ok(r) => r,
        Err(c2pa::Error::JumbfNotFound) => {
            // A file with no credentials is the common case, not an error.
            return Ok(json!({
                "present": false,
                "state": "",
                "signer": null,
                "generator": null,
                "signed_at": null,
                "title": null,
                "assertions": [],
                "ingredients": 0,
                "issues": [],
                "divi_txid": null,
                "json": "",
            }));
        }
        Err(e) => return Err(format!("Couldn't read Content Credentials: {e}")),
    };

    let manifest_json = reader.json();

    let mut issues: Vec<String> = Vec::new();
    if let Some(statuses) = reader.validation_status() {
        for s in statuses {
            issues.push(s.explanation().unwrap_or(s.code()).to_string());
        }
    }

    // Pull the human-facing bits out of the manifest JSON rather than reaching
    // through the SDK's types, which are still 0.x and move between releases.
    let mut title: Option<String> = None;
    let mut generator: Option<String> = None;
    let mut signer: Option<String> = None;
    let mut signed_at: Option<String> = None;
    let mut ingredients: usize = 0;
    let mut assertions: Vec<String> = Vec::new();
    let mut divi_txid: Option<String> = None;

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&manifest_json) {
        let active = v["active_manifest"].as_str().unwrap_or("");
        let m = if active.is_empty() {
            v["manifests"].as_object().and_then(|o| o.values().next()).cloned()
        } else {
            v["manifests"].get(active).cloned()
        };
        if let Some(m) = m {
            title = m["title"].as_str().map(str::to_string);
            generator = m["claim_generator_info"][0]["name"]
                .as_str()
                .or_else(|| m["claim_generator"].as_str())
                .map(str::to_string);
            signer = m["signature_info"]["issuer"].as_str().map(str::to_string);
            signed_at = m["signature_info"]["time"].as_str().map(str::to_string);
            ingredients = m["ingredients"].as_array().map(|a| a.len()).unwrap_or(0);
            if let Some(asserts) = m["assertions"].as_array() {
                for a in asserts {
                    if let Some(label) = a["label"].as_str() {
                        assertions.push(label.to_string());
                        if label == DIVI_POE_LABEL {
                            divi_txid = a["data"]["txid"].as_str().map(str::to_string);
                        }
                    }
                }
            }
        }
    }

    Ok(json!({
        "present": true,
        "state": format!("{:?}", reader.validation_state()),
        "signer": signer,
        "generator": generator,
        "signed_at": signed_at,
        "title": title,
        "assertions": assertions,
        "ingredients": ingredients,
        "issues": issues,
        "divi_txid": divi_txid,
        "json": manifest_json,
    }))
}
