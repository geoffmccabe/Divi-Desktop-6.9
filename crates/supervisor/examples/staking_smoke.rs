// Sanity-check the staking/lottery reads against a live node.
// DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example staking_smoke
use dd69_supervisor::{config::NodeConfig, wallet};

fn main() {
    let cfg = NodeConfig::load().expect("load node config (set DIVI_DATADIR)");

    let w = wallet::staking_wallets(&cfg);
    println!("staking wallets: {}", w.len());
    for x in w.iter().take(5) {
        println!(
            "  {}  size={:.4}  stakes={}  first={:?} last={:?}",
            x.address, x.size, x.stakes, x.first_stake, x.last_stake
        );
    }

    match wallet::lottery_info(&cfg) {
        Some(i) => println!("lottery: tip={} next_height={} next_eta={}", i.tip, i.next_height, i.next_eta),
        None => println!("lottery: (unreachable)"),
    }

    let addrs: Vec<String> = w.iter().map(|x| x.address.clone()).collect();
    let wins = wallet::lottery_wins(&cfg, &addrs);
    println!("lottery wins rows: {}", wins.len());
    for x in wins.iter().take(5) {
        println!("  {}  big={} small={}", x.address, x.big, x.small);
    }
}
