//! Public pay-per-launch client for GoBanq Assets.
//!
//! These endpoints need NO app credential: a confirmed DIVI payment to the
//! treasury is the gate. DD69 uses them so ANY user can permanently store a
//! collection's art on Arweave (via GoBanq's own funded account, server-side)
//! WITHOUT holding a GoBanq secret file. See `collectibles::launch_quote` and
//! `collectibles::launch_execute` for the flow:
//!   quote(files)                -> a DIVI price + an order id
//!   pay(orderId, txid)          -> settle once the on-chain payment confirms
//!   upload_file(orderId, bytes) -> store one file on Arweave
//!   status(orderId)             -> the permanent arweave.net links
//!
//! The matching server lives in Go-Banq/Assets `src/launch/` (POST /v1/launch/*).

use crate::nfd_storage::DEFAULT_GOBANQ_URL;
use serde_json::{json, Value};
use std::time::Duration;

/// Base URL for the launch endpoints (GOBANQ_API_URL override, else the devnet host).
pub fn base_url() -> String {
    std::env::var("GOBANQ_API_URL").unwrap_or_else(|_| DEFAULT_GOBANQ_URL.to_string())
}

fn base() -> String {
    base_url().trim_end_matches('/').to_string()
}

/// A GoBanq error response (`{ error: { code, message, retryable } }`) plus its
/// HTTP status. The launch flow inspects `status`/`code` to tell "payment not
/// confirmed yet" (retry) from a hard failure (abort).
pub struct ApiErr {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ApiErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

fn read_err(status: u16, body: String) -> ApiErr {
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let code = v["error"]["code"].as_str().unwrap_or("ERROR").to_string();
    let message = v["error"]["message"].as_str().unwrap_or(&body).to_string();
    ApiErr { status, code, message }
}

/// Turn a ureq call result into a parsed JSON body or a structured error.
fn finish(resp: Result<ureq::Response, ureq::Error>) -> Result<Value, ApiErr> {
    match resp {
        Ok(r) => {
            let body = r
                .into_string()
                .map_err(|e| ApiErr { status: 0, code: "IO".into(), message: e.to_string() })?;
            serde_json::from_str(&body)
                .map_err(|e| ApiErr { status: 0, code: "BAD_JSON".into(), message: e.to_string() })
        }
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            Err(read_err(code, body))
        }
        Err(ureq::Error::Transport(t)) => {
            Err(ApiErr { status: 0, code: "NETWORK".into(), message: format!("GoBanq unreachable: {t}") })
        }
    }
}

/// Price a fixed set of files and open a quoted order. `files` is a JSON array of
/// `{ sha256, bytes, contentType }`. Returns the quote view (orderId, divi,
/// duffs, treasury, ...).
pub fn quote(files: &Value) -> Result<Value, String> {
    let url = format!("{}/v1/launch/quote", base());
    let body = json!({ "files": files }).to_string();
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(30))
        .set("content-type", "application/json")
        .send_bytes(body.as_bytes());
    finish(resp).map_err(|e| e.to_string())
}

/// Settle a quoted order with a confirmed DIVI payment. Structured error so the
/// caller can retry while GoBanq waits for confirmations (status 402 /
/// PAYMENT_NOT_CONFIRMED) and abort otherwise.
pub fn pay(order_id: &str, txid: &str) -> Result<Value, ApiErr> {
    let url = format!("{}/v1/launch/pay", base());
    let body = json!({ "orderId": order_id, "txid": txid }).to_string();
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(30))
        .set("content-type", "application/json")
        .send_bytes(body.as_bytes());
    finish(resp)
}

/// Store one file of a paid order on Arweave (raw bytes). Returns the file view.
pub fn upload_file(order_id: &str, bytes: &[u8], content_type: &str) -> Result<Value, String> {
    let url = format!("{}/v1/launch/{}/file", base(), order_id);
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(90))
        .set("content-type", content_type)
        .send_bytes(bytes);
    let body = finish(resp).map_err(|e| e.to_string())?;
    Ok(body["file"].clone())
}

/// Order status and the Arweave links once each file is stored.
pub fn status(order_id: &str) -> Result<Value, String> {
    let url = format!("{}/v1/launch/{}", base(), order_id);
    let resp = ureq::get(&url).timeout(Duration::from_secs(30)).call();
    finish(resp).map_err(|e| e.to_string())
}
