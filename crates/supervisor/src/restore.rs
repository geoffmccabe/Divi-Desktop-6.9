//! Restoring a wallet from a seed phrase, two ways: replace the wallet of the
//! node the app is pointed at, or create a second local node that runs on the
//! restored wallet alongside the first.
//!
//! HOW THE NODE RESTORES. Started with `hdseed=<hex>` in its settings while a
//! wallet file already exists, the node moves that file aside (renamed with a
//! timestamp, never deleted), builds a fresh wallet from the seed, and with
//! `rescan=1` walks the whole chain to find every coin that belongs to it.
//! The setting matters only at that one start.
//!
//! WHERE THE SECRET GOES, AND DOES NOT. The seed is written into the node's
//! own settings file (owner-only permissions, in the folder that already holds
//! the wallet itself) for the duration of ONE start, then removed. It is never
//! passed on the command line, where any process on the machine could read it
//! from the process list, and never written to any log. Every ordinary start
//! also strips any leftover `hdseed=`/`mnemonic=` line, so a crash in the
//! middle cannot leave the seed lying in the file.

use crate::config::NodeConfig;
use crate::process;
use crate::rpc::RpcClient;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// What a wallet holds, for the "you are about to lose this" warning.
pub struct Holdings {
    pub divi: f64,
    pub address_count: usize,
}

pub fn holdings(cfg: &NodeConfig) -> Option<Holdings> {
    let rpc = RpcClient::new(cfg);
    let w = rpc.call("getwalletinfo", serde_json::json!([])).ok()?;
    let divi = w["balance"].as_f64().unwrap_or(0.0)
        + w["immature_balance"].as_f64().unwrap_or(0.0)
        + w["unconfirmed_balance"].as_f64().unwrap_or(0.0);
    let address_count = rpc
        .call("getaddressesbyaccount", serde_json::json!([""]))
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);
    Some(Holdings { divi, address_count })
}

fn strip_seed_lines(text: &str) -> String {
    text.lines()
        .filter(|l| {
            let t = l.trim_start();
            !(t.starts_with("hdseed=") || t.starts_with("mnemonic=") || t.starts_with("rescan="))
        })
        .map(|l| format!("{l}\n"))
        .collect()
}

/// Remove any seed left in a settings file. Called on every ordinary start.
pub fn scrub_conf(conf: &Path) {
    if let Ok(text) = std::fs::read_to_string(conf) {
        let clean = strip_seed_lines(&text);
        if clean != text {
            let _ = std::fs::write(conf, clean);
            crate::setuplog::log("restore: removed a leftover seed line from the node settings");
        }
    }
}

fn write_conf_with_seed(conf: &Path, seed_hex: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(conf).map_err(|e| format!("cannot read the node settings: {e}"))?;
    let mut out = strip_seed_lines(&text);
    out.push_str(&format!("hdseed={seed_hex}\nrescan=1\n"));
    std::fs::write(conf, out).map_err(|e| format!("cannot write the node settings: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(conf, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// REPLACE the wallet of the node in `cfg` with one restored from `seed_hex`.
/// Stops the node politely, restarts it once with the seed, waits for it to
/// answer (the rescan runs first and can take a long while), then removes the
/// seed from the settings. The previous wallet file is renamed, not deleted.
pub fn replace_wallet(cfg: &NodeConfig, seed_hex: &str) -> Result<String, String> {
    if cfg.remote {
        return Err("This node is on another machine; restore its wallet there.".into());
    }
    let conf = cfg.datadir.join("divi.conf");
    let bin = crate::install::managed_divid().ok_or("the node program is not installed")?;
    let rpc = RpcClient::new(cfg);

    crate::setuplog::log("restore: replacing this node's wallet from a seed phrase");
    if process::daemon_pid(&cfg.datadir).is_some() {
        process::safe_stop(&rpc, &cfg.datadir, Duration::from_secs(1200))
            .map_err(|e| format!("could not stop the node first: {e}"))?;
    }
    write_conf_with_seed(&conf, seed_hex)?;
    // One start with the seed. Long timeout: the rescan of a 4M-block chain
    // happens before the node answers.
    let result = process::start_with_recovery(
        &bin,
        &cfg.datadir,
        &rpc,
        Duration::from_secs(3600),
        Duration::from_secs(3600),
    );
    // Out of the file the moment the start is over, success or not.
    scrub_conf(&conf);
    let rep = result.map_err(|e| format!("the node did not start with the restored wallet: {e}"))?;
    crate::setuplog::log(format!(
        "restore: node running on the restored wallet (pid {}); previous wallet file kept, renamed",
        rep.pid
    ));
    Ok("Restored. The previous wallet file was kept alongside it, renamed with the date.".into())
}

/// CREATE a second local node, with its own data folder and ports, whose
/// wallet is restored from `seed_hex`. The chain is copied from `from_datadir`
/// so it need not be downloaded again. Returns the new profile's id.
pub fn create_second_node(
    from_datadir: &Path,
    label: &str,
    seed_hex: &str,
    progress: &dyn Fn(&str),
) -> Result<String, String> {
    let id = format!("node{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    let root = crate::config::dd69_datadir()
        .parent()
        .map(|p| p.join("nodes").join(&id).join("data"))
        .ok_or("cannot place the new node's folder")?;
    std::fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

    // Ports that will not collide with the first node.
    let (p2p, rpc_port) = free_port_pair(51482);

    progress("Copying the blockchain to the new node (no download needed)…");
    for dir in ["blocks", "chainstate", "sporks"] {
        let src = from_datadir.join(dir);
        if src.is_dir() {
            copy_dir(&src, &root.join(dir))
                .map_err(|e| format!("could not copy {dir}: {e}"))?;
        }
    }

    let user = format!("dd69n{}", &id[4..]);
    let pass: String = {
        use sha2::{Digest, Sha256};
        let seed = format!("{}{}", id, std::process::id());
        Sha256::digest(seed.as_bytes()).iter().take(24).map(|b| format!("{b:02x}")).collect()
    };
    let conf = root.join("divi.conf");
    let body = format!(
        "# Written by DD69 for a second local node. Edit freely; DD69 will not rewrite it.\n\
         rpcuser={user}\nrpcpassword={pass}\nrpcport={rpc_port}\nport={p2p}\n\
         server=1\nlisten=1\nupnp=0\ndiscover=1\nrpcthreads=64\nrpcworkqueue=64\nmaxconnections=32\naddressindex=1\n\
         hdseed={seed_hex}\nrescan=1\n"
    );
    std::fs::write(&conf, body).map_err(|e| format!("cannot write the new node's settings: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&conf, std::fs::Permissions::from_mode(0o600));
    }

    crate::config::add_local_profile(&id, label, &root, &user, &pass, rpc_port)?;

    progress("Starting the new node and finding your coins (this can take a long while)…");
    let cfg = NodeConfig::load_from(root.clone())?;
    let bin = crate::install::managed_divid().ok_or("the node program is not installed")?;
    let rpc = RpcClient::new(&cfg);
    let result = process::start_with_recovery(&bin, &root, &rpc, Duration::from_secs(3600), Duration::from_secs(3600));
    scrub_conf(&conf);
    result.map_err(|e| format!("the new node did not start: {e}"))?;
    crate::setuplog::log(format!("restore: second node '{label}' created ({id}) on ports {p2p}/{rpc_port}"));
    Ok(id)
}

fn free_port_pair(start: u16) -> (u16, u16) {
    use std::net::TcpListener;
    let mut p = start;
    loop {
        let a = TcpListener::bind(("127.0.0.1", p)).is_ok();
        let b = TcpListener::bind(("127.0.0.1", p + 1)).is_ok();
        if a && b {
            return (p, p + 1);
        }
        p += 2;
        if p > start + 200 {
            return (start, start + 1);
        }
    }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to: PathBuf = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_lines_are_stripped_and_nothing_else_is_touched() {
        let t = "rpcuser=a\nhdseed=deadbeef\nserver=1\nmnemonic=x y z\nrescan=1\nlisten=1\n";
        assert_eq!(strip_seed_lines(t), "rpcuser=a\nserver=1\nlisten=1\n");
    }

    #[test]
    fn writing_the_seed_then_scrubbing_leaves_the_file_as_it_was() {
        let dir = std::env::temp_dir().join(format!("dd69-restore-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conf = dir.join("divi.conf");
        std::fs::write(&conf, "rpcuser=a\nserver=1\n").unwrap();
        write_conf_with_seed(&conf, "00ff").unwrap();
        assert!(std::fs::read_to_string(&conf).unwrap().contains("hdseed=00ff"));
        scrub_conf(&conf);
        assert_eq!(std::fs::read_to_string(&conf).unwrap(), "rpcuser=a\nserver=1\n");
        std::fs::remove_dir_all(&dir).ok();
    }
}
