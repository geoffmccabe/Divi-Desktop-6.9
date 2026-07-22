use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

/// Where the node lives and how to talk to it. Read from the standard Divi
/// datadir for this platform (or an explicit override) and its divi.conf.
pub struct NodeConfig {
    pub datadir: PathBuf,
    /// RPC host — 127.0.0.1 for a local node or a remote node reached over an
    /// SSH tunnel (the usual case). A profile may override it for a direct host.
    pub rpc_host: String,
    pub rpc_user: String,
    pub rpc_pass: String,
    pub rpc_port: u16,
    /// True when we're talking to a node on another machine (over an SSH tunnel),
    /// so there's no local pid/datadir to inspect — status comes purely from RPC.
    pub remote: bool,
}

/// One selectable node in the "My Nodes" settings tab. The built-in "Desktop"
/// node is always present; extra nodes (e.g. a personal DIVI LOVE SCAN node)
/// live only in the per-machine nodes.json, so they never ship to other users.
#[derive(Clone)]
pub struct NodeProfile {
    pub id: String,
    pub label: String,
    pub mode: String, // "local" | "remote"
    pub datadir: Option<String>,
    pub rpc_host: Option<String>,
    pub rpc_port: Option<u16>,
    pub rpc_user: Option<String>,
    pub rpc_pass: Option<String>,
    pub builtin: bool,
}

/// DD69's own config directory (NOT the Divi datadir) — holds nodes.json.
pub fn dd69_config_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support/divi-desktop-69")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("divi-desktop-69")
    } else {
        home().join(".config/divi-desktop-69")
    }
}
fn nodes_path() -> PathBuf {
    dd69_config_dir().join("nodes.json")
}

fn desktop_profile() -> NodeProfile {
    NodeProfile {
        id: "desktop".into(),
        label: "Desktop".into(),
        mode: "local".into(),
        datadir: None,
        rpc_host: None,
        rpc_port: None,
        rpc_user: None,
        rpc_pass: None,
        builtin: true,
    }
}

fn str_field(o: &Value, k: &str) -> Option<String> {
    o.get(k).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// Read the per-machine nodes.json → (active id, user-defined profiles).
fn read_nodes_file() -> (Option<String>, Vec<NodeProfile>) {
    let text = match std::fs::read_to_string(nodes_path()) {
        Ok(t) => t,
        Err(_) => return (None, vec![]),
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (None, vec![]),
    };
    let active = str_field(&v, "active");
    let mut out = vec![];
    if let Some(arr) = v.get("nodes").and_then(|n| n.as_array()) {
        for n in arr {
            let id = match str_field(n, "id") {
                Some(id) if !id.is_empty() && id != "desktop" => id,
                _ => continue,
            };
            out.push(NodeProfile {
                label: str_field(n, "label").unwrap_or_else(|| id.clone()),
                mode: str_field(n, "mode").unwrap_or_else(|| "remote".into()),
                datadir: str_field(n, "datadir"),
                rpc_host: str_field(n, "rpc_host"),
                rpc_port: n.get("rpc_port").and_then(|p| p.as_u64()).map(|p| p as u16),
                rpc_user: str_field(n, "rpc_user"),
                rpc_pass: str_field(n, "rpc_pass"),
                builtin: false,
                id,
            });
        }
    }
    (active, out)
}

/// All selectable nodes (Desktop first, then any personal ones) + the active id.
pub fn list_profiles() -> (String, Vec<NodeProfile>) {
    let (active, users) = read_nodes_file();
    let mut profiles = vec![desktop_profile()];
    profiles.extend(users);
    let active = active
        .filter(|a| profiles.iter().any(|p| &p.id == a))
        .unwrap_or_else(|| "desktop".into());
    (active, profiles)
}

/// Point the wallet at a different node. Persists the choice; the next status
/// poll re-reads it, so the switch takes effect within a few seconds.
pub fn set_active(id: &str) -> Result<(), String> {
    let (_, profiles) = list_profiles();
    if !profiles.iter().any(|p| p.id == id) {
        return Err(format!("unknown node '{id}'"));
    }
    let mut v: Value = std::fs::read_to_string(nodes_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({ "nodes": [] }));
    v["active"] = json!(id);
    let dir = dd69_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    std::fs::write(nodes_path(), serde_json::to_string_pretty(&v).unwrap_or_default())
        .map_err(|e| format!("cannot save nodes.json: {e}"))
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
}

pub fn default_datadir() -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support/DIVI")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("DIVI")
    } else {
        home().join(".divi")
    }
}

/// Tolerates whitespace around keys/values and comment lines.
pub fn parse_conf(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.starts_with('#') {
                return None;
            }
            l.split_once('=')
                .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

impl NodeConfig {
    pub fn load() -> Result<Self, String> {
        // Settings → My Nodes (nodes.json) is the source of truth for which node
        // the wallet talks to, and it is AUTHORITATIVE — it overrides any legacy
        // DIVI_REMOTE environment variable, so switching in the UI always works.
        let (active, profiles) = list_profiles();
        if let Some(p) = profiles.iter().find(|p| p.id == active) {
            if p.mode == "remote" {
                let user = p.rpc_user.clone().unwrap_or_default();
                let pass = p.rpc_pass.clone().unwrap_or_default();
                if user.is_empty() || pass.is_empty() {
                    return Err(format!("node '{}' is missing its RPC username/password", p.label));
                }
                return Ok(NodeConfig {
                    datadir: default_datadir(),
                    rpc_host: p.rpc_host.clone().unwrap_or_else(|| "127.0.0.1".into()),
                    rpc_user: user,
                    rpc_pass: pass,
                    rpc_port: p.rpc_port.unwrap_or(51473),
                    remote: true,
                });
            }
            // Local node (e.g. Desktop): its own datadir if set, else DIVI_DATADIR,
            // else the standard Divi folder for this platform.
            let dir = p
                .datadir
                .clone()
                .map(PathBuf::from)
                .or_else(|| std::env::var("DIVI_DATADIR").ok().map(PathBuf::from))
                .unwrap_or_else(default_datadir);
            return Self::load_from(dir);
        }

        // No My Nodes profile resolved (shouldn't happen — Desktop is built in).
        // Legacy fallbacks, kept for safety only.
        if std::env::var("DIVI_REMOTE").is_ok() {
            let user = std::env::var("DIVI_RPC_USER").unwrap_or_default();
            let pass = std::env::var("DIVI_RPC_PASS").unwrap_or_default();
            if user.is_empty() || pass.is_empty() {
                return Err("DIVI_REMOTE set but DIVI_RPC_USER/DIVI_RPC_PASS are missing".into());
            }
            return Ok(NodeConfig {
                datadir: default_datadir(),
                rpc_host: "127.0.0.1".into(),
                rpc_user: user,
                rpc_pass: pass,
                rpc_port: std::env::var("DIVI_RPC_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(51473),
                remote: true,
            });
        }
        let dir = std::env::var("DIVI_DATADIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_datadir());
        Self::load_from(dir)
    }

    pub fn load_from(datadir: PathBuf) -> Result<Self, String> {
        // divid resolves relative -conf/-datadir paths against each other,
        // silently doubling them. Absolute paths only, always.
        let datadir = std::fs::canonicalize(&datadir).unwrap_or(datadir);
        let conf_path = datadir.join("divi.conf");
        let conf = std::fs::read_to_string(&conf_path)
            .map_err(|e| format!("cannot read {}: {}", conf_path.display(), e))?;
        let map = parse_conf(&conf);
        let cfg = NodeConfig {
            rpc_host: "127.0.0.1".into(),
            rpc_user: map.get("rpcuser").cloned().unwrap_or_default(),
            rpc_pass: map.get("rpcpassword").cloned().unwrap_or_default(),
            rpc_port: map
                .get("rpcport")
                .and_then(|p| p.parse().ok())
                .unwrap_or(51473),
            datadir,
            remote: false,
        };
        if cfg.rpc_user.is_empty() || cfg.rpc_pass.is_empty() {
            return Err(format!(
                "divi.conf in {} has no rpcuser/rpcpassword — the supervisor cannot talk to the node without them",
                cfg.datadir.display()
            ));
        }
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spaces_and_comments() {
        let m = parse_conf("# comment\nrpcuser = alice\nrpcport= 51999 \n\nbad line\nrpcpassword=p=w");
        assert_eq!(m.get("rpcuser").unwrap(), "alice");
        assert_eq!(m.get("rpcport").unwrap(), "51999");
        // value containing '=' keeps everything after the first '='
        assert_eq!(m.get("rpcpassword").unwrap(), "p=w");
        assert!(!m.contains_key("bad line"));
    }
}
