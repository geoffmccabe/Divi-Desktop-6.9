use crate::config::NodeConfig;
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

/// Minimal JSON-RPC client for the local divid. Local loopback only.
pub struct RpcClient {
    url: String,
    auth: String,
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

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "1.0", "id": "dd69", "method": method, "params": params});
        let resp = ureq::post(&self.url)
            .set("Authorization", &self.auth)
            .timeout(Duration::from_secs(20))
            .send_string(&body.to_string());
        let text = match resp {
            Ok(r) => r.into_string().map_err(|e| e.to_string())?,
            // divid returns RPC errors with non-200 status but a JSON body.
            Err(ureq::Error::Status(_, r)) => r.into_string().map_err(|e| e.to_string())?,
            Err(e) => return Err(e.to_string()),
        };
        let v: Value =
            serde_json::from_str(&text).map_err(|e| format!("unparseable RPC reply: {e}"))?;
        if !v["error"].is_null() {
            return Err(v["error"].to_string());
        }
        Ok(v["result"].clone())
    }
}
