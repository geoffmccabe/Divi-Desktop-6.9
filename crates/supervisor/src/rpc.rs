use crate::config::NodeConfig;
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

/// Minimal JSON-RPC client for the local divid. Local loopback only.
pub struct RpcClient {
    url: String,
    auth: String,
}

/// Project rule: no raw daemon error ever reaches a user. Errors are turned
/// into a plain sentence here, at the boundary, so every caller inherits it.
fn humanize(code: i64, msg: &str) -> String {
    match code {
        -28 => format!("The node is still starting up ({}).", msg.trim_end_matches("...")),
        -13 => "The wallet is locked — unlock it first.".into(),
        -6 => "Not enough funds for that.".into(),
        _ => msg.to_string(),
    }
}

impl RpcClient {
    pub fn new(cfg: &NodeConfig) -> Self {
        let token = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", cfg.rpc_user, cfg.rpc_pass));
        RpcClient {
            url: format!("http://127.0.0.1:{}/", cfg.rpc_port),
            auth: format!("Basic {}", token),
        }
    }

    // Send the request and return the full JSON-RPC envelope ({result, error}),
    // or Err only on a transport/parse failure.
    fn send(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "1.0", "id": "dd69", "method": method, "params": params});
        let resp = ureq::post(&self.url)
            .set("Authorization", &self.auth)
            // Patient timeout: the legacy Divi node's RPC is bursty — a cold call
            // can take 10-25s before it warms up and answers instantly. These
            // calls run off the UI thread (spawn_blocking), so waiting doesn't
            // freeze anything; giving up too early just mislabels a live node as
            // "starting". 30s tolerates the slow spells; truly-down fails fast
            // because the connection is refused, not merely slow.
            .timeout(Duration::from_secs(30))
            .send_string(&body.to_string());
        let text = match resp {
            Ok(r) => r.into_string().map_err(|e| e.to_string())?,
            // divid returns RPC errors with non-200 status but a JSON body.
            Err(ureq::Error::Status(_, r)) => r.into_string().map_err(|e| e.to_string())?,
            Err(e) => return Err(format!("cannot reach the node: {e}")),
        };
        serde_json::from_str(&text).map_err(|_| "the node sent an unreadable reply".to_string())
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let v = self.send(method, params)?;
        if !v["error"].is_null() {
            let code = v["error"]["code"].as_i64().unwrap_or(0);
            let msg = v["error"]["message"].as_str().unwrap_or("unknown node error");
            return Err(humanize(code, msg));
        }
        Ok(v["result"].clone())
    }

    /// Like `call`, but returns Ok(None) when the node doesn't recognize the
    /// method (JSON-RPC "Method not found", -32601). This is how we prefer the
    /// new soft-fork RPCs (createpoe/verifypoe) and fall back cleanly to the
    /// forkless path on any node that hasn't shipped them yet.
    pub fn call_optional(&self, method: &str, params: Value) -> Result<Option<Value>, String> {
        let v = self.send(method, params)?;
        if !v["error"].is_null() {
            let code = v["error"]["code"].as_i64().unwrap_or(0);
            if code == -32601 {
                return Ok(None);
            }
            let msg = v["error"]["message"].as_str().unwrap_or("unknown node error");
            return Err(humanize(code, msg));
        }
        Ok(Some(v["result"].clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_error_is_humanized() {
        let s = humanize(-28, "Loading block index...");
        assert!(s.contains("starting up"));
        assert!(!s.contains("-28"));
    }
}
