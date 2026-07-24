use dd69_supervisor::network;
fn main() {
    let ips: Vec<String> = ["216.144.229.195","94.130.151.81","104.168.43.240","1.2.3.4"].iter().map(|s|s.to_string()).collect();
    let r = network::probe(&ips, 51472); // parallel batch, as the app calls it
    for (ip, online) in r { println!("  {ip:<18} online={online}"); }
}
