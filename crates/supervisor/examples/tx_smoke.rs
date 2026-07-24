use dd69_supervisor::{config::NodeConfig, wallet};
fn main() {
    let cfg = NodeConfig::load().expect("config");
    let txs = wallet::list(&cfg, 12, 0).unwrap_or_default();
    let mut counts = std::collections::HashMap::new();
    for t in &txs { *counts.entry(t.kind.clone()).or_insert(0) += 1; }
    println!("kinds in newest 12: {:?}", counts);
    for t in txs.iter().take(6) {
        println!("  kind={:<8} amount={:>8.2} conf={}", t.kind, t.amount, t.confirmations);
    }
}
