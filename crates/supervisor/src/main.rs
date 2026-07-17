use dd69_supervisor::{config::NodeConfig, health, process, rpc::RpcClient, state};
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

struct Args {
    cmd: String,
    datadir: Option<PathBuf>,
    divid: Option<PathBuf>,
    yes: bool,
}

fn parse_args() -> Args {
    let mut args = Args { cmd: "status".into(), datadir: None, divid: None, yes: false };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--datadir" => args.datadir = it.next().map(PathBuf::from),
            "--divid" => args.divid = it.next().map(PathBuf::from),
            "--yes" => args.yes = true,
            "status" | "start" | "stop" => args.cmd = a,
            other => {
                eprintln!("unknown argument: {other}\nusage: dd69 [status|start|stop] [--datadir PATH] [--divid PATH] [--yes]");
                std::process::exit(2);
            }
        }
    }
    args
}

fn load_cfg(args: &Args) -> Result<NodeConfig, String> {
    match &args.datadir {
        Some(d) => NodeConfig::load_from(d.clone()),
        None => NodeConfig::load(),
    }
}

fn main() {
    // Die quietly when piped into `head` etc. instead of panicking.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
    let args = parse_args();
    let result = match args.cmd.as_str() {
        "status" => status(&args),
        "start" => start(&args),
        "stop" => stop(&args),
        _ => unreachable!(),
    };
    if let Err(e) = result {
        println!("Problem: {e}");
        std::process::exit(1);
    }
}

fn status(args: &Args) -> Result<(), String> {
    let cfg = load_cfg(args)?;
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
            if health::stale_pid_file(&cfg.datadir, false) {
                println!("The node is not running — and it did NOT stop cleanly (crashed, killed, or lost power). Repair may be needed on next start.");
            } else {
                println!("The node is not running.");
            }
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

fn start(args: &Args) -> Result<(), String> {
    let cfg = load_cfg(args)?;
    let divid = process::find_divid(args.divid.clone())?;
    println!("Starting the node ({})...", divid.display());
    let rpc = RpcClient::new(&cfg);
    let pid = process::start_daemon(&divid, &cfg.datadir, &rpc, Duration::from_secs(120))?;
    println!("Node is running and answering (pid {pid}).");
    Ok(())
}

fn stop(args: &Args) -> Result<(), String> {
    let cfg = load_cfg(args)?;
    if !args.yes {
        print!(
            "This will stop the Divi node in {} (staking pauses until it's started again). Type y to continue: ",
            cfg.datadir.display()
        );
        std::io::stdout().flush().ok();
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer).ok();
        if answer.trim().to_lowercase() != "y" {
            println!("Cancelled — the node keeps running.");
            return Ok(());
        }
    }
    let rpc = RpcClient::new(&cfg);
    println!("Asking the node to stop, then waiting for it to finish writing (do NOT force quit)...");
    let took = process::safe_stop(&rpc, &cfg.datadir, Duration::from_secs(120))?;
    println!("Node stopped cleanly in {:.1} seconds.", took.as_secs_f32());
    Ok(())
}
