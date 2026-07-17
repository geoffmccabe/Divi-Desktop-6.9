use std::collections::HashMap;
use std::path::PathBuf;

/// Where the node lives and how to talk to it. Read from the standard Divi
/// datadir for this platform and its divi.conf.
pub struct NodeConfig {
    pub datadir: PathBuf,
    pub rpc_user: String,
    pub rpc_pass: String,
    pub rpc_port: u16,
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

impl NodeConfig {
    pub fn load() -> Result<Self, String> {
        let datadir = default_datadir();
        let conf_path = datadir.join("divi.conf");
        let conf = std::fs::read_to_string(&conf_path)
            .map_err(|e| format!("cannot read {}: {}", conf_path.display(), e))?;
        let map: HashMap<&str, &str> = conf
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                if l.starts_with('#') {
                    return None;
                }
                l.split_once('=')
            })
            .collect();
        Ok(NodeConfig {
            rpc_user: map.get("rpcuser").copied().unwrap_or("").to_string(),
            rpc_pass: map.get("rpcpassword").copied().unwrap_or("").to_string(),
            rpc_port: map
                .get("rpcport")
                .and_then(|p| p.trim().parse().ok())
                .unwrap_or(51473),
            datadir,
        })
    }
}
