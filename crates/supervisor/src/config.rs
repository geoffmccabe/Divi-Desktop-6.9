use std::collections::HashMap;
use std::path::PathBuf;

/// Where the node lives and how to talk to it. Read from the standard Divi
/// datadir for this platform (or an explicit override) and its divi.conf.
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
        Self::load_from(default_datadir())
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
