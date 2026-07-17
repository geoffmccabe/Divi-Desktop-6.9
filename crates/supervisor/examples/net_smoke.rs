use dd69_supervisor::{config::NodeConfig, network};
fn main() {
    let cfg = NodeConfig::load().expect("config");
    let snap = network::peers(&cfg).expect("peers");
    println!("peers: {}  self_ip: {:?}", snap.peers.len(), snap.self_ip);
    let mut ips: Vec<String> = snap.peers.iter().take(6).map(|p| p.ip.clone()).collect();
    if let Some(s) = &snap.self_ip { ips.push(s.clone()); }
    let geos = network::geolocate(&ips);
    println!("geolocated {} of {}:", geos.len(), ips.len());
    for g in &geos { println!("  {:<16} {:>7.2},{:>7.2}  {}, {}", g.ip, g.lat, g.lon, g.city, g.country); }
}
