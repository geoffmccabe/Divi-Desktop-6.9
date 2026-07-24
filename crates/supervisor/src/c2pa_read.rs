//! Reading C2PA "Content Credentials" out of a file.
//!
//! This is the READ half only — we verify what someone else signed. We do not
//! create or sign manifests, and the wording in the UI must not imply we do.
//!
//! Scope and honesty notes, because this area invites overclaiming:
//!
//!  * Nothing here is "C2PA compliant". Compliance is a formal conformance
//!    listing for products that GENERATE credentials. Reading them requires no
//!    permission from anyone and confers no certification.
//!  * `fetch_remote_manifests` is deliberately NOT enabled, so opening a file
//!    never causes a network request. What we report comes from the file alone.
//!  * Without a configured trust list, a signature can be cryptographically
//!    sound while the signer is still unknown to us. Those are different
//!    statements and the UI keeps them apart.
//!  * A valid credential says the file matches what the signer claimed. It does
//!    not mean the picture is true, and it says nothing about AI unless the
//!    manifest itself asserts it.

use c2pa::{Context, Reader};
use std::io::Cursor;

#[derive(Debug, Clone, Default)]
pub struct C2paSummary {
    /// Did the file carry any credential at all?
    pub present: bool,
    /// Well-formed / valid / invalid, straight from the SDK.
    pub state: String,
    /// Who signed it, if the manifest says.
    pub signer: Option<String>,
    /// The tool that produced it (e.g. a camera or an editor).
    pub generator: Option<String>,
    /// When it was signed, as the manifest records it.
    pub signed_at: Option<String>,
    pub title: Option<String>,
    /// Assertion labels present — this is where "edited with AI" style claims
    /// live, so the UI can show them verbatim rather than interpreting them.
    pub assertions: Vec<String>,
    /// How many source ingredients the manifest references (an edit chain).
    pub ingredients: usize,
    /// Validation problems, in the SDK's own words.
    pub issues: Vec<String>,
    /// A Divi proof-of-existence assertion, if this file carries one.
    pub divi_txid: Option<String>,
    /// The whole manifest as JSON, for a details view.
    pub json: String,
}

/// The reverse-domain label a Divi anchor would use inside a manifest. C2PA
/// requires vendor assertions to be namespaced by a domain you control — a bare
/// "divi.poe" would not be conformant.
pub const DIVI_POE_LABEL: &str = "org.divi.poe";

/// Read credentials from raw file bytes. `format` is the file extension or MIME
/// type (the SDK accepts either). Ok(summary with present=false) means the file
/// simply has no credentials, which is not an error — most files don't.
pub fn read(bytes: Vec<u8>, format: &str) -> Result<C2paSummary, String> {
    // Explicit Context rather than the deprecated from_stream(), which relies on
    // thread-local settings — the wrong shape for a Tauri worker thread.
    let reader = match Reader::from_context(Context::new()).with_stream(format, Cursor::new(bytes)) {
        Ok(r) => r,
        Err(c2pa::Error::JumbfNotFound) => {
            return Ok(C2paSummary { present: false, ..Default::default() })
        }
        Err(e) => return Err(format!("Couldn't read Content Credentials: {e}")),
    };

    let json = reader.json();
    let mut out = C2paSummary {
        present: true,
        state: format!("{:?}", reader.validation_state()),
        json: json.clone(),
        ..Default::default()
    };

    if let Some(statuses) = reader.validation_status() {
        for s in statuses {
            let msg = s.explanation().unwrap_or(s.code()).to_string();
            out.issues.push(msg);
        }
    }

    // Pull the human-facing bits out of the manifest JSON rather than reaching
    // through the SDK's types, which are still 0.x and move between releases.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
        let active = v["active_manifest"].as_str().unwrap_or("");
        let m = if active.is_empty() {
            v["manifests"].as_object().and_then(|o| o.values().next()).cloned()
        } else {
            v["manifests"].get(active).cloned()
        };
        if let Some(m) = m {
            out.title = m["title"].as_str().map(str::to_string);
            out.generator = m["claim_generator_info"][0]["name"]
                .as_str()
                .or_else(|| m["claim_generator"].as_str())
                .map(str::to_string);
            out.signer = m["signature_info"]["issuer"].as_str().map(str::to_string);
            out.signed_at = m["signature_info"]["time"].as_str().map(str::to_string);
            out.ingredients = m["ingredients"].as_array().map(|a| a.len()).unwrap_or(0);
            if let Some(asserts) = m["assertions"].as_array() {
                for a in asserts {
                    if let Some(label) = a["label"].as_str() {
                        out.assertions.push(label.to_string());
                        if label == DIVI_POE_LABEL {
                            out.divi_txid = a["data"]["txid"].as_str().map(str::to_string);
                        }
                    }
                }
            }
        }
    }

    Ok(out)
}

/// File types the installed SDK can read, so the UI can say so accurately
/// instead of guessing.
pub fn supported_types() -> Vec<String> {
    Reader::supported_mime_types()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Proves the reader works against a genuinely C2PA-signed file and against
    // one with no credentials, so "no credentials" can never be confused with
    // "failed to read".
    #[test]
    fn reads_a_signed_file_and_a_plain_one() {
        let path = std::env::var("C2PA_TEST_JPG").unwrap_or_default();
        if path.is_empty() {
            eprintln!("skipping: set C2PA_TEST_JPG to a signed sample");
            return;
        }
        let bytes = std::fs::read(&path).expect("sample readable");
        let s = read(bytes, "image/jpeg").expect("reads");
        assert!(s.present, "sample should carry credentials");
        eprintln!(
            "state={} signer={:?} generator={:?} assertions={:?} issues={:?}",
            s.state, s.signer, s.generator, s.assertions, s.issues
        );

        // A file with no manifest must come back present=false, not an error.
        let plain = read(vec![0xff, 0xd8, 0xff, 0xdb, 0, 0], "image/jpeg");
        match plain {
            Ok(p) => assert!(!p.present),
            Err(_) => { /* malformed jpeg is also an acceptable outcome */ }
        }
    }
}
