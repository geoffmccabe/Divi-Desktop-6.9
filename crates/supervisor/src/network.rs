//! Network map data: who we're connected to (from getpeerinfo) and where those
//! IPs are (from a free batch geolocation service). The blockchain carries no
//! location for transactions, so this is strictly peer/connection geography —
//! honest network topology, not invented transaction origins.

use crate::config::NodeConfig;
use crate::rpc::RpcClient;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct Peer {
    pub ip: String,
    pub inbound: bool,
    pub ping_ms: f64,
    pub conn_secs: i64,
    pub bytes_sent: i64,
    pub bytes_recv: i64,
    pub subver: String,
    pub height: i64,
}

pub struct PeerSnapshot {
    pub peers: Vec<Peer>,
    pub self_ip: Option<String>,
}

fn strip_port(addr: &str) -> String {
    // "1.2.3.4:51472" -> "1.2.3.4"; also tolerate bracketed IPv6.
    match addr.rfind(':') {
        Some(i) if !addr[..i].contains(':') || addr.starts_with('[') => addr[..i]
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_string(),
        _ => addr.to_string(),
    }
}

/// Connected peers plus our own public IP (as peers report seeing us).
pub fn peers(cfg: &NodeConfig) -> Option<PeerSnapshot> {
    let rpc = RpcClient::new(cfg);
    let arr = rpc.call("getpeerinfo", json!([])).ok()?;
    let arr = arr.as_array()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);

    let mut self_votes: HashMap<String, i32> = HashMap::new();
    let mut peers = Vec::new();
    for p in arr {
        let ip = strip_port(p["addr"].as_str().unwrap_or(""));
        if ip.is_empty() {
            continue;
        }
        if let Some(local) = p["addrlocal"].as_str() {
            let li = strip_port(local);
            if !li.is_empty() {
                *self_votes.entry(li).or_insert(0) += 1;
            }
        }
        let conntime = p["conntime"].as_i64().unwrap_or(now);
        peers.push(Peer {
            ip,
            inbound: p["inbound"].as_bool().unwrap_or(false),
            ping_ms: (p["pingtime"].as_f64().unwrap_or(0.0) * 1000.0).round(),
            conn_secs: (now - conntime).max(0),
            bytes_sent: p["bytessent"].as_i64().unwrap_or(0),
            bytes_recv: p["bytesrecv"].as_i64().unwrap_or(0),
            subver: p["subver"].as_str().unwrap_or("").trim_matches('/').to_string(),
            height: p["synced_blocks"].as_i64().unwrap_or(0),
        });
    }
    let self_ip = self_votes.into_iter().max_by_key(|(_, n)| *n).map(|(ip, _)| ip);
    Some(PeerSnapshot { peers, self_ip })
}

pub struct Geo {
    pub ip: String,
    pub lat: f64,
    pub lon: f64,
    pub city: String,
    pub country: String,
    pub isp: String,
}

/// A real liveness probe: try to open a TCP connection to each peer's Divi P2P
/// port. It's not a full handshake, but an open port is a genuine "this node is
/// reachable right now" signal — honest, and all the webview-side map needs to
/// light a known peer as online. Bounded parallelism, short timeout.
pub fn probe(ips: &[String], port: u16) -> Vec<(String, bool)> {
    use std::net::{TcpStream, ToSocketAddrs};
    let handles: Vec<_> = ips
        .iter()
        .take(80)
        .cloned()
        .map(|ip| {
            std::thread::spawn(move || {
                let ok = format!("{ip}:{port}")
                    .to_socket_addrs()
                    .ok()
                    .and_then(|mut a| a.next())
                    .map(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(2500)).is_ok())
                    .unwrap_or(false);
                (ip, ok)
            })
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

/// Time a TCP connection to each node's P2P port as a latency measure. Returns
/// (ip, reachable, round-trip ms). Unreachable/timed-out => (ip, false, 0). This
/// is the "ping" behind the fastest-nodes list; it works for any node, connected
/// or not (a connected peer also has a more exact P2P pingtime in getpeerinfo).
pub fn ping_latency(ips: &[String], port: u16) -> Vec<(String, bool, u32)> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Instant;
    let handles: Vec<_> = ips
        .iter()
        .take(160)
        .cloned()
        .map(|ip| {
            std::thread::spawn(move || {
                let sa = format!("{ip}:{port}").to_socket_addrs().ok().and_then(|mut a| a.next());
                match sa {
                    Some(sa) => {
                        let t = Instant::now();
                        match TcpStream::connect_timeout(&sa, Duration::from_millis(3000)) {
                            Ok(_) => (ip, true, t.elapsed().as_millis() as u32),
                            Err(_) => (ip, false, 0),
                        }
                    }
                    None => (ip, false, 0),
                }
            })
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

/// Our own approximate location, from the caller IP as the geo service sees it.
/// Works before any peer connects, so the map can center on us at boot.
pub fn self_geo() -> Option<Geo> {
    let resp = ureq::get("http://ip-api.com/json?fields=status,country,city,lat,lon,isp,query")
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?;
    let v: Value = serde_json::from_str(&resp.into_string().ok()?).ok()?;
    if v["status"].as_str() != Some("success") {
        return None;
    }
    Some(Geo {
        ip: v["query"].as_str().unwrap_or("").to_string(),
        lat: v["lat"].as_f64()?,
        lon: v["lon"].as_f64()?,
        city: v["city"].as_str().unwrap_or("").to_string(),
        country: v["country"].as_str().unwrap_or("").to_string(),
        isp: v["isp"].as_str().unwrap_or("").to_string(),
    })
}

/// Geolocate up to 100 IPs in one call via ip-api.com's free batch endpoint.
/// Only public peer IPs are sent; the wallet/keys are never involved. Callers
/// cache results (IPs rarely move) so this is hit rarely.
pub fn geolocate(ips: &[String]) -> Vec<Geo> {
    if ips.is_empty() {
        return Vec::new();
    }
    let body = Value::Array(ips.iter().take(100).map(|ip| json!(ip)).collect());
    let resp = ureq::post("http://ip-api.com/batch?fields=status,country,city,lat,lon,isp,query")
        .timeout(Duration::from_secs(12))
        .send_string(&body.to_string());
    let text = match resp {
        Ok(r) => r.into_string().unwrap_or_default(),
        Err(_) => return Vec::new(),
    };
    let arr: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    arr.as_array()
        .map(|a| {
            a.iter()
                .filter(|e| e["status"].as_str() == Some("success"))
                .filter_map(|e| {
                    Some(Geo {
                        ip: e["query"].as_str()?.to_string(),
                        lat: e["lat"].as_f64()?,
                        lon: e["lon"].as_f64()?,
                        city: e["city"].as_str().unwrap_or("").to_string(),
                        country: e["country"].as_str().unwrap_or("").to_string(),
                        isp: e["isp"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
