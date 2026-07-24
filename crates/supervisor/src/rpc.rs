use crate::config::NodeConfig;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

/// One shared, connection-pooling agent for the whole app. The legacy node's RPC
/// server drops connections under churn (a new socket per call overwhelms its
/// accept loop — "RPCAcceptHandler: Invalid argument"), so we keep connections
/// alive and reuse them instead of opening a fresh one for every request.
fn shared_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(8))
            .timeout_read(Duration::from_secs(30))
            .timeout_write(Duration::from_secs(30))
            .max_idle_connections(16)
            .max_idle_connections_per_host(16)
            .build()
    })
}

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
            url: format!("http://{}:{}/", cfg.rpc_host, cfg.rpc_port),
            auth: format!("Basic {}", token),
        }
    }

    // Send the request and return the full JSON-RPC envelope ({result, error}),
    // or Err only on a transport/parse failure.
    fn send(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "1.0", "id": "dd69", "method": method, "params": params});
        // Reuse a pooled keep-alive connection (see shared_agent). The 30s read
        // timeout tolerates the node's bursty spells; these run off the UI thread
        // (spawn_blocking) so waiting never freezes anything.
        let resp = shared_agent()
            .post(&self.url)
            .set("Authorization", &self.auth)
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
