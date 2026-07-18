use std::collections::HashMap;
use std::path::PathBuf;

/// Where the node lives and how to talk to it. Read from the standard Divi
/// datadir for this platform (or an explicit override) and its divi.conf.
pub struct NodeConfig {
    pub datadir: PathBuf,
    pub rpc_user: String,
    pub rpc_pass: String,
    pub rpc_port: u16,
    /// True when we're talking to a node on another machine (over an SSH tunnel),
    /// so there's no local pid/datadir to inspect — status comes purely from RPC.
    pub remote: bool,
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
        // DIVI_REMOTE=1 points the wallet at a node reached over an SSH tunnel
        // (127.0.0.1:PORT forwarded to a server), using creds from the env. No
        // local datadir/pid exists, so status is derived from RPC only.
        if std::env::var("DIVI_REMOTE").is_ok() {
            let user = std::env::var("DIVI_RPC_USER").unwrap_or_default();
            let pass = std::env::var("DIVI_RPC_PASS").unwrap_or_default();
            if user.is_empty() || pass.is_empty() {
                return Err("DIVI_REMOTE set but DIVI_RPC_USER/DIVI_RPC_PASS are missing".into());
            }
            return Ok(NodeConfig {
                datadir: default_datadir(),
                rpc_user: user,
                rpc_pass: pass,
                rpc_port: std::env::var("DIVI_RPC_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(51473),
                remote: true,
            });
        }
        // DIVI_DATADIR lets you point the wallet at a specific local node (a test /
        // regtest node, or a non-standard install) instead of the default.
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
