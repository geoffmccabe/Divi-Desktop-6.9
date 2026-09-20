fn main() {
    let ips: Vec<String> = std::env::args().skip(1).collect();
    let res = dd69_supervisor::crawl::crawl(&ips, 3);
    let alive = res.iter().filter(|r| r.alive).count();
    println!("checked {} nodes, {} completed a real Divi handshake", res.len(), alive);
    let mut found = std::collections::BTreeSet::new();
    for r in &res {
        if r.alive {
            println!("  {:16} {:22} height {}  gave {} addresses", r.ip, r.subver, r.height, r.addrs.len());
        }
        for a in &r.addrs { found.insert(a.clone()); }
    }
    let new: Vec<_> = found.iter().filter(|a| !ips.contains(a)).collect();
    println!("total distinct addresses learned: {}", found.len());
    println!("NOT among the nodes we asked (invisible to us before): {}", new.len());
    for a in new.iter() { println!("    {a}"); }
}
