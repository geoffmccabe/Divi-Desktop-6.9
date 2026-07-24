use dd69_supervisor::{config::NodeConfig, report};
fn main() {
    let cfg = NodeConfig::load().expect("config");
    for i in 1..=4 {
        let r = report::status_report(&cfg);
        println!("try {i}: phase={} peers={:?} blocks={:?} :: {}", r.phase.slug(), r.peers, r.blocks, r.headline);
    }
}
