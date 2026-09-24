// ── Can the rest of the network actually reach this node? ──────────────────
//
// A node that only dials OUT works perfectly as a wallet and stakes perfectly
// well, but it is invisible: no other node can connect to it, so no peer lists
// it and its address never spreads through the network's address gossip.
//
// This was true of every DD69 install, silently, and the app never said so. A
// user set up a node in Nigeria, watched it stake, and could not understand why
// it never appeared on anyone's map. Nothing was broken. Nothing had told him.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::json;

/// Plain data. The app crate turns this into what the interface sees, the same
/// way it does for peers — this crate stays free of interface concerns.
#[derive(Default)]
pub struct Reachability {
    /// The node believes it has a usable public address.
    pub reachable: bool,
    /// Connections other nodes opened TO us. Zero is the symptom.
    pub inbound: u32,
    /// Connections we opened to others.
    pub outbound: u32,
    /// `listen=1`: the node is at least trying to accept connections.
    pub listening: bool,
    /// `upnp=1`: it is asking the router to open the port.
    pub upnp: bool,
    /// The port that must be reachable for anyone to dial in.
    pub port: u16,
    /// Public addresses the node has managed to advertise, if any.
    pub addresses: Vec<String>,
    /// True once we are confident, rather than merely still starting up.
    pub known: bool,
    /// ---- PEER RELAY (docs/PEER-RELAY-SPEC.md, node 69.0.5) ----
    /// Helpers that accepted us: reachable THROUGH them even with no port.
    pub helpers: Vec<String>,
    /// Home nodes this node is carrying for.
    pub helping: u32,
    /// Whether the node supports the relay at all (older nodes do not).
    pub relay_supported: bool,
}

/// The peer port. Not the RPC port, which must stay closed to the world.
pub const P2P_PORT: u16 = 51472;

pub fn status(cfg: &NodeConfig) -> Reachability {
    let rpc = RpcClient::new(cfg);
    let mut r = Reachability {
        port: P2P_PORT,
        ..Default::default()
    };

    let Ok(peers) = rpc.call("getpeerinfo", json!([])) else {
        return r; // node not answering yet: known stays false, we claim nothing
    };
    if let Some(list) = peers.as_array() {
        for p in list {
            if p["inbound"].as_bool().unwrap_or(false) {
                r.inbound += 1;
            } else {
                r.outbound += 1;
            }
        }
    }

    if let Ok(net) = rpc.call("getnetworkinfo", json!([])) {
        if let Some(addrs) = net["localaddresses"].as_array() {
            for a in addrs {
                if let Some(s) = a["address"].as_str() {
                    r.addresses.push(s.to_string());
                }
            }
        }
        // The node's own verdict per network. Any reachable network counts.
        if let Some(nets) = net["networks"].as_array() {
            r.reachable = nets
                .iter()
                .any(|n| n["reachable"].as_bool().unwrap_or(false));
        }
        // The relay (node 69.0.5+): helpers that accepted us, and how many
        // home nodes we carry. An older node has no "relay" field.
        if let Some(relay) = net.get("relay").filter(|v| v.is_object()) {
            r.relay_supported = true;
            if let Some(list) = relay["helpers"].as_array() {
                for h in list {
                    if h["accepted"].as_bool().unwrap_or(false) {
                        if let Some(a) = h["helper"].as_str() {
                            r.helpers.push(a.to_string());
                        }
                    }
                }
            }
            r.helping = relay["helping_nodes"].as_array().map(|a| a.len() as u32).unwrap_or(0);
        }
    }
    // An advertised address or a single inbound connection is proof, whatever
    // the node's own flags claim: somebody got through.
    if !r.addresses.is_empty() || r.inbound > 0 {
        r.reachable = true;
    }

    let conf = crate::install::read_conf_text().unwrap_or_default();
    r.listening = conf_flag(&conf, "listen").unwrap_or(true);
    r.upnp = conf_flag(&conf, "upnp").unwrap_or(false);
    r.known = true;
    r
}

fn conf_flag(conf: &str, key: &str) -> Option<bool> {
    conf.lines()
        .filter_map(|l| l.trim().strip_prefix(&format!("{key}=")))
        .last()
        .map(|v| v.trim() != "0")
}

/// Turn automatic router port-opening on or off.
///
/// Writes the setting and reports whether a restart is needed to apply it. It
/// deliberately does NOT restart the node: that is the caller's decision, and
/// silently bouncing the node under a staking user would be worse than waiting.
pub fn set_upnp(on: bool) -> Result<(), String> {
    crate::install::set_conf_flag("upnp", if on { "1" } else { "0" })?;
    crate::setuplog::log(format!(
        "node settings: automatic router port-opening turned {}",
        if on { "ON" } else { "OFF" }
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_value_wins_and_zero_means_off() {
        assert_eq!(conf_flag("upnp=1\nupnp=0\n", "upnp"), Some(false));
        assert_eq!(conf_flag("upnp=0\nupnp=1\n", "upnp"), Some(true));
        assert_eq!(conf_flag("listen=1\n", "upnp"), None);
        // Indented and padded lines are still settings.
        assert_eq!(conf_flag("  upnp = 1 \n", "upnp"), None); // spaces round '=' are NOT valid conf syntax
        assert_eq!(conf_flag("  upnp=1\n", "upnp"), Some(true));
    }
}
