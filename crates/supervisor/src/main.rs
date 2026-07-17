use dd69_supervisor::{config::NodeConfig, health, process, rpc::RpcClient, state};
use serde_json::json;
use std::time::Duration;

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_else(|| "status".into());
    let result = match cmd.as_str() {
        "status" => status(),
        "stop" => stop(),
        _ => {
            eprintln!("usage: dd69 [status|stop]");
            std::process::exit(2);
        }
    };
    if let Err(e) = result {
        println!("Problem: {e}");
        std::process::exit(1);
    }
}

fn status() -> Result<(), String> {
    let cfg = NodeConfig::load()?;
    println!("Divi node folder: {}", cfg.datadir.display());

    match health::last_shutdown(&cfg.datadir) {
        health::LastShutdown::Clean => println!("Last shutdown: clean (no corruption expected)."),
        health::LastShutdown::Dirty => {
            println!("Last shutdown: NOT clean — the node was killed or lost power mid-write.")
        }
        health::LastShutdown::Unknown => println!("Last shutdown: unknown (no log entry found)."),
    }

    match process::daemon_pid(&cfg.datadir) {
        Some(pid) => println!("The node is running (pid {pid})."),
        None => {
            println!("The node is not running.");
            return Ok(());
        }
    }

    let rpc = RpcClient::new(&cfg);
    let blocks = rpc.call("getblockcount", json!([]))?;
    let conns = rpc.call("getconnectioncount", json!([]))?;
    println!("Blocks: {blocks}   Peers: {conns}");

    let staking = rpc.call("getstakingstatus", json!([]))?;
    println!("{}", state::staking_sentence(&staking));
    Ok(())
}

fn stop() -> Result<(), String> {
    let cfg = NodeConfig::load()?;
    let rpc = RpcClient::new(&cfg);
    println!("Asking the node to stop, then waiting for it to finish writing (do NOT force quit)...");
    let took = process::safe_stop(&rpc, &cfg.datadir, Duration::from_secs(120))?;
    println!("Node stopped cleanly in {:.1} seconds.", took.as_secs_f32());
    Ok(())
}
