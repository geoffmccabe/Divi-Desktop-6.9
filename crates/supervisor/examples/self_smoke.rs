use dd69_supervisor::network;
fn main() {
    match network::self_geo() {
        Some(g) => println!("self: {},{} {}, {}", g.lat, g.lon, g.city, g.country),
        None => println!("self: (none)"),
    }
}
