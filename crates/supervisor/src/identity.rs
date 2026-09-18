//! This install's own node identity: a stable ID and a user-chosen node name.
//!
//! The ID is random, generated once, and kept in the app config folder. Its job
//! is to answer "is this the same node?" when the public IP changes — a laptop
//! that moves between towns or ISPs gets a new IP each time, and without a stable
//! ID every old IP looks like a separate node. The ID never changes, so the map
//! (and, later, the network) can group all of a node's IPs under one identity.
//!
//! The name is just for fun: the user types it in Settings and it rides along
//! with the ID. A future option will let the name instead be the node's registered
//! Agent identity (which is provable); we keep a `name_source` field now so that
//! switch is a data change, not a schema change. Nothing here is on-chain and
//! nothing here is a secret.

use std::path::PathBuf;

fn path() -> PathBuf {
    crate::config::dd69_config_dir().join("node-identity.json")
}

/// A fresh random identifier: 16 bytes of OS randomness as hex. Not a wallet key
/// and not secret — just a stable, collision-free handle for this install.
fn new_id() -> String {
    let mut buf = [0u8; 16];
    // getrandom is already a dependency and works on every platform. If it ever
    // failed we still want a usable (if less unique) id rather than a hard error.
    let _ = getrandom::getrandom(&mut buf);
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    format!("nd-{hex}")
}

/// The node's identity for the UI: stable id, the chosen name (may be empty),
/// and where the name comes from ("custom" now; "agent" later).
pub fn to_json() -> serde_json::Value {
    let (id, name, source) = load_or_create();
    serde_json::json!({ "id": id, "name": name, "nameSource": source })
}

/// Read the identity file, creating it with a new id the first time. Returns
/// (id, name, name_source).
pub fn load_or_create() -> (String, String, String) {
    let p = path();
    if let Ok(text) = std::fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let source = v
                    .get("nameSource")
                    .and_then(|x| x.as_str())
                    .unwrap_or("custom")
                    .to_string();
                return (id, name, source);
            }
        }
    }
    // No usable file yet: mint an id and persist it.
    let id = new_id();
    write(&id, "", "custom");
    (id, String::new(), "custom".to_string())
}

fn write(id: &str, name: &str, source: &str) {
    let p = path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let body = serde_json::json!({ "id": id, "name": name, "nameSource": source });
    let _ = std::fs::write(&p, serde_json::to_string_pretty(&body).unwrap_or_default());
}

/// Set (or clear) the node name. `source` is "custom" for a typed name or
/// "agent" when the user later points it at their Agent identity. The id is
/// preserved. The name is trimmed and length-capped so a stray paste can't write
/// a giant value that later gets broadcast.
pub fn set_name(name: &str, source: &str) -> serde_json::Value {
    let (id, _, _) = load_or_create();
    let clean: String = name.trim().chars().take(40).collect();
    let src = if source == "agent" { "agent" } else { "custom" };
    write(&id, &clean, src);
    serde_json::json!({ "id": id, "name": clean, "nameSource": src })
}
