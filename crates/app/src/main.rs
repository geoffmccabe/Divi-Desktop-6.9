// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dd69_supervisor::{config::NodeConfig, network, poe, report, wallet};
use serde::Serialize;

#[derive(Serialize)]
struct BalanceDto {
    spendable: f64,
    staking: f64,
    pending: f64,
    immature: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddrDto {
    address: String,
    is_main: bool,
    receives: i64,
    sends: i64,
    stakes: i64,
}

/// The account's deposit addresses with per-address counts.
#[tauri::command]
async fn wallet_addresses() -> Vec<AddrDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else { return vec![] };
        wallet::addresses(&cfg)
            .into_iter()
            .map(|a| AddrDto {
                address: a.address,
                is_main: a.is_main,
                receives: a.receives,
                sends: a.sends,
                stakes: a.stakes,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
struct TxDto {
    kind: String,
    amount: f64,
    address: String,
    confirmations: i64,
    txid: String,
    time: i64,
}

// ── IMPORTANT ─────────────────────────────────────────────────────────────
// Every command that talks to the node does BLOCKING RPC. Tauri runs a sync
// command on the UI thread, so a slow/dead node would freeze the window and
// lock the user out. So each of these is `async` + `spawn_blocking`: the wait
// happens on a worker thread and the UI stays responsive no matter what.
// ──────────────────────────────────────────────────────────────────────────

/// Read-only: wallet balances. None if the node/wallet isn't reachable.
#[tauri::command]
async fn wallet_balance() -> Option<BalanceDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().ok()?;
        wallet::balance(&cfg).map(|b| BalanceDto {
            spendable: b.spendable,
            staking: b.staking,
            pending: b.pending,
            immature: b.immature,
        })
    })
    .await
    .ok()
    .flatten()
}

/// Reserve and return a fresh receiving address.
#[tauri::command]
async fn new_receive_address() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        wallet::new_address(&cfg)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// A page of transactions (newest window; `from` skips that many recent ones).
/// None = node unreachable (vs Some([]) = genuinely no more transactions).
#[tauri::command]
async fn list_transactions(count: i64, from: i64) -> Option<Vec<TxDto>> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().ok()?;
        Some(
            wallet::list(&cfg, count, from)?
                .into_iter()
                .map(|t| TxDto {
                    kind: t.kind,
                    amount: t.amount,
                    address: t.address,
                    confirmations: t.confirmations,
                    txid: t.txid,
                    time: t.time,
                })
                .collect(),
        )
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn recent_activity() -> Vec<TxDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else { return vec![] };
        wallet::recent(&cfg, 25)
            .into_iter()
            .map(|t| TxDto {
                kind: t.kind,
                amount: t.amount,
                address: t.address,
                confirmations: t.confirmations,
                txid: t.txid,
                time: t.time,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Validate a destination address (used before send). Safe/read-only.
#[tauri::command]
async fn validate_address(address: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        NodeConfig::load()
            .ok()
            .map(|cfg| wallet::is_valid_address(&cfg, &address))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Open an http(s) URL in the user's default browser (e.g. a block explorer).
#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
}

/// Render an address as a QR-code SVG (generated locally; no network).
#[tauri::command]
fn address_qr(address: String) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::QrCode;
    let code = QrCode::new(address.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(180, 180)
        .quiet_zone(true)
        .dark_color(svg::Color("#0e0b16"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

#[derive(Serialize)]
struct NodeStatusDto {
    running: bool,
    phase: String,
    headline: String,
    blocks: Option<i64>,
    peers: Option<i64>,
}

/// Read-only status poll — the only call the status line makes. Off the UI
/// thread so a hung node can never freeze the window.
#[tauri::command]
async fn node_status() -> NodeStatusDto {
    tauri::async_runtime::spawn_blocking(|| match NodeConfig::load() {
        Ok(cfg) => {
            let r = report::status_report(&cfg);
            NodeStatusDto {
                running: r.running,
                phase: r.phase.slug().to_string(),
                headline: r.headline,
                blocks: r.blocks,
                peers: r.peers,
            }
        }
        Err(_) => NodeStatusDto {
            running: false,
            phase: "stopped".into(),
            headline: "No Divi node is set up on this computer yet.".into(),
            blocks: None,
            peers: None,
        },
    })
    .await
    .unwrap_or_else(|_| NodeStatusDto {
        running: false,
        phase: "starting".into(),
        headline: "Checking the node…".into(),
        blocks: None,
        peers: None,
    })
}

/// Proof of existence: anchor a document's SHA-256 hash on-chain. The UI hashes
/// the file locally (Web Crypto) and passes only the hash, so the document never
/// leaves the machine. Returns the anchoring transaction id.
#[tauri::command]
async fn poe_timestamp(hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        poe::timestamp(&cfg, &hash)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
struct PoeProofDto {
    matched: bool,
    confirmations: i64,
    block_time: Option<i64>,
}

/// Verify a prior anchor: does `txid` contain this file's hash, and how deep is it?
#[tauri::command]
async fn poe_verify(txid: String, hash: String) -> Result<PoeProofDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let p = poe::verify(&cfg, &txid, &hash)?;
        Ok(PoeProofDto {
            matched: p.matched,
            confirmations: p.confirmations,
            block_time: p.block_time,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StakeWalletDto {
    address: String,
    size: f64,
    stakes: i64,
    first_stake: Option<i64>,
    last_stake: Option<i64>,
}

/// The wallet's staking addresses (largest first) with stake counts + dates.
#[tauri::command]
async fn staking_wallets() -> Vec<StakeWalletDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else { return Vec::new() };
        wallet::staking_wallets(&cfg)
            .into_iter()
            .map(|w| StakeWalletDto {
                address: w.address,
                size: w.size,
                stakes: w.stakes,
                first_stake: w.first_stake,
                last_stake: w.last_stake,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LotteryInfoDto {
    tip: i64,
    next_height: i64,
    next_eta: i64,
}

/// Height + estimated time of the next weekly lottery draw (null if unreachable).
#[tauri::command]
async fn lottery_info() -> Option<LotteryInfoDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().ok()?;
        wallet::lottery_info(&cfg).map(|i| LotteryInfoDto {
            tip: i.tip,
            next_height: i.next_height,
            next_eta: i.next_eta,
        })
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
struct LotteryWinDto {
    address: String,
    big: i64,
    small: i64,
}

/// Historical big/small lottery wins for the given addresses (a chain scan).
#[tauri::command]
async fn lottery_wins(addresses: Vec<String>) -> Vec<LotteryWinDto> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(cfg) = NodeConfig::load() else { return Vec::new() };
        wallet::lottery_wins(&cfg, &addresses)
            .into_iter()
            .map(|w| LotteryWinDto { address: w.address, big: w.big, small: w.small })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerDto {
    ip: String,
    inbound: bool,
    ping_ms: f64,
    conn_secs: i64,
    bytes_sent: i64,
    bytes_recv: i64,
    subver: String,
    height: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerSnapshotDto {
    peers: Vec<PeerDto>,
    self_ip: Option<String>,
}

/// Connected peers + our public IP, for the network map.
#[tauri::command]
async fn network_peers() -> Option<PeerSnapshotDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().ok()?;
        let s = network::peers(&cfg)?;
        Some(PeerSnapshotDto {
            peers: s
                .peers
                .into_iter()
                .map(|p| PeerDto {
                    ip: p.ip,
                    inbound: p.inbound,
                    ping_ms: p.ping_ms,
                    conn_secs: p.conn_secs,
                    bytes_sent: p.bytes_sent,
                    bytes_recv: p.bytes_recv,
                    subver: p.subver,
                    height: p.height,
                })
                .collect(),
            self_ip: s.self_ip,
        })
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
struct GeoDto {
    ip: String,
    lat: f64,
    lon: f64,
    city: String,
    country: String,
}

#[derive(Serialize)]
struct ProbeDto {
    ip: String,
    online: bool,
}

/// Probe known peer IPs for reachability (TCP connect to the Divi P2P port).
#[tauri::command]
async fn probe_peers(ips: Vec<String>) -> Vec<ProbeDto> {
    tauri::async_runtime::spawn_blocking(move || {
        network::probe(&ips, 51472)
            .into_iter()
            .map(|(ip, online)| ProbeDto { ip, online })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Our own approximate location (caller IP), so the map can center before peers.
#[tauri::command]
async fn self_geo() -> Option<GeoDto> {
    tauri::async_runtime::spawn_blocking(|| {
        network::self_geo().map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country })
    })
    .await
    .ok()
    .flatten()
}

/// Geolocate peer IPs (free batch lookup). Public IPs only; cache on the client.
#[tauri::command]
async fn geolocate_ips(ips: Vec<String>) -> Vec<GeoDto> {
    tauri::async_runtime::spawn_blocking(move || {
        network::geolocate(&ips)
            .into_iter()
            .map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            node_status,
            wallet_balance,
            wallet_addresses,
            new_receive_address,
            recent_activity,
            list_transactions,
            validate_address,
            address_qr,
            open_url,
            poe_timestamp,
            poe_verify,
            staking_wallets,
            lottery_info,
            lottery_wins,
            network_peers,
            geolocate_ips,
            self_geo,
            probe_peers
        ])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
