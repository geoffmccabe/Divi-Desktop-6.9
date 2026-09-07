//! Prove the wallet's embedded index reads real records off a real chain.
//!
//! Everything else about the index is unit tested. This is the one thing tests
//! cannot cover: that the wallet's own node connection, the shared block parser
//! and the shared scanning loop actually agree with each other on a live chain.
//!
//! Points at a regtest node, never a wallet's real one:
//!
//! ```text
//! cargo run --example dmt_index_smoke -- 54900 dmt dmt_local_regtest_only
//! ```

use std::path::PathBuf;
use std::time::{Duration, Instant};

use dd69_supervisor::config::NodeConfig;
use dd69_supervisor::dmt_index::TokenIndex;
use dvxp_scan::query;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: dmt_index_smoke <rpc_port> <rpc_user> <rpc_pass>");
        std::process::exit(2);
    }

    let cfg = NodeConfig {
        datadir: PathBuf::from("."),
        rpc_host: "127.0.0.1".into(),
        rpc_user: args[2].clone(),
        rpc_pass: args[3].clone(),
        rpc_port: args[1].parse().expect("rpc port"),
        remote: false,
    };

    println!("starting the wallet's embedded index");
    let index = TokenIndex::start(&cfg);

    let started = Instant::now();
    loop {
        let s = index.status();
        if let Some(why) = &s.unavailable {
            eprintln!("index did not start: {why}");
            std::process::exit(1);
        }
        if let Some(why) = &s.halted {
            eprintln!("index halted: {why}");
            std::process::exit(1);
        }
        if s.caught_up && s.tip > 0 {
            println!(
                "caught up: height {} of {}, trustworthy {}",
                s.height,
                s.tip,
                s.trustworthy()
            );
            break;
        }
        if started.elapsed() > Duration::from_secs(300) {
            eprintln!("gave up waiting at height {} of {}", s.height, s.tip);
            std::process::exit(1);
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    // Read through the same query layer the explorer uses.
    let shown = index.read(|o| {
        let tokens = query::all_tokens(o);
        let mut out = String::new();
        for t in &tokens {
            out.push_str(&format!(
                "  token {}  supply {}  locked {}  issuer {:?}\n",
                query::token_id_string(t.token),
                t.total_supply,
                t.supply_locked,
                t.issuer.0
            ));
            for h in query::token_history(o, t.token, 10) {
                out.push_str(&format!("      {} {}\n", h.kind.as_str(), h.amount));
            }
        }
        format!("tokens found: {}\n{out}", tokens.len())
    });

    match shown {
        Some(text) => println!("{text}"),
        None => println!("the index was mid-slice; ask again"),
    }

    index.stop();
}
