// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dd69_supervisor::{c2pa_read, chaintips, coins, config, config::NodeConfig, network, payreq, poe, price, report, security, wallet};
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

/// Does the connected node own any of these addresses? Gates admin-only UI.
#[tauri::command]
async fn wallet_owns(addresses: Vec<String>) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        NodeConfig::load()
            .ok()
            .map(|cfg| wallet::owns_any(&cfg, &addresses))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Open an http(s) URL in the user's default browser (e.g. a block explorer).
#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
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
async fn poe_timestamp(
    hash: String,
    fee: Option<f64>,
    payoutAddr: Option<String>,
    payoutDivi: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        poe::timestamp(
            &cfg,
            &hash,
            poe::AnchorCost {
                fee_divi: fee,
                payout_addr: payoutAddr,
                payout_divi: payoutDivi,
            },
        )
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
#[serde(rename_all = "camelCase")]
struct GeoDto {
    ip: String,
    lat: f64,
    lon: f64,
    city: String,
    country: String,
    country_code: String,
    isp: String,
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

#[derive(Serialize)]
struct NodePingDto {
    ip: String,
    online: bool,
    ms: u32,
}

/// Time-ping a list of nodes (TCP round-trip to the P2P port) for the
/// fastest-nodes list. Works for any node, connected or not.
#[tauri::command]
async fn ping_nodes(ips: Vec<String>) -> Vec<NodePingDto> {
    tauri::async_runtime::spawn_blocking(move || {
        network::ping_latency(&ips, 51472)
            .into_iter()
            .map(|(ip, online, ms)| NodePingDto { ip, online, ms })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Our own approximate location (caller IP), so the map can center before peers.
#[tauri::command]
async fn self_geo() -> Option<GeoDto> {
    tauri::async_runtime::spawn_blocking(|| {
        network::self_geo().map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country, country_code: g.country_code, isp: g.isp })
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
            .map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country, country_code: g.country_code, isp: g.isp })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockDto {
    height: i64,
    time: i64,
    txids: Vec<String>,
    stake_winner: Option<String>,
    stake_amount: Option<f64>,
}

/// Newest blocks + their transactions, for the block-chain visualization.
#[tauri::command]
async fn recent_blocks(count: i64) -> Vec<BlockDto> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(cfg) = NodeConfig::load() else { return Vec::new() };
        wallet::recent_blocks(&cfg, count.clamp(1, 20))
            .into_iter()
            .map(|b| BlockDto { height: b.height, time: b.time, txids: b.txids, stake_winner: b.stake_winner, stake_amount: b.stake_amount })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StaleBlockDto {
    height: i64,
    status: String,
    branch_len: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrphanReportDto {
    stale: Vec<StaleBlockDto>,
    tip: i64,
    span: i64,
    rate_pct: f64,
}

/// Stale ("orphan") blocks our node has seen.
///
/// ⚠ The underlying getchaintips takes ~18 SECONDS and holds the node's main
/// lock. Never call this on a timer — `force` only in response to a user
/// action; otherwise it serves a cached report.
#[tauri::command]
async fn chain_orphans(force: Option<bool>) -> Option<OrphanReportDto> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().ok()?;
        let r = chaintips::orphans(&cfg, force.unwrap_or(false))?;
        Some(OrphanReportDto {
            stale: r
                .stale
                .into_iter()
                .map(|s| StaleBlockDto { height: s.height, status: s.status, branch_len: s.branch_len })
                .collect(),
            tip: r.tip,
            span: r.span,
            rate_pct: r.rate_pct,
        })
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StakeStartDto {
    staking: bool,
    needs_passphrase: bool,
    message: String,
}

/// Start staking (staking-only-unlocks an encrypted wallet with the passphrase).
#[tauri::command]
async fn start_staking(passphrase: Option<String>) -> StakeStartDto {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(cfg) = NodeConfig::load() else {
            return StakeStartDto { staking: false, needs_passphrase: false, message: "No node.".into() };
        };
        let r = wallet::start_staking(&cfg, passphrase.as_deref());
        StakeStartDto { staking: r.staking, needs_passphrase: r.needs_passphrase, message: r.message }
    })
    .await
    .unwrap_or(StakeStartDto { staking: false, needs_passphrase: false, message: "internal error".into() })
}

#[derive(Serialize)]
struct LotteryLeaderDto {
    address: String,
    big: i64,
    small: i64,
    points: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LotteryBoardDto {
    leaders: Vec<LotteryLeaderDto>,
    your_big: i64,
    your_small: i64,
    your_points: i64,
}

/// Lottery leaderboard (top 10 by Big×10+Small) + the user's own win tally.
#[tauri::command]
async fn lottery_board(addresses: Vec<String>) -> LotteryBoardDto {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(cfg) = NodeConfig::load() else {
            return LotteryBoardDto { leaders: vec![], your_big: 0, your_small: 0, your_points: 0 };
        };
        let b = wallet::lottery_board(&cfg, &addresses);
        LotteryBoardDto {
            leaders: b.leaders.into_iter().map(|e| LotteryLeaderDto { address: e.address, big: e.big, small: e.small, points: e.points }).collect(),
            your_big: b.your_big,
            your_small: b.your_small,
            your_points: b.your_points,
        }
    })
    .await
    .unwrap_or(LotteryBoardDto { leaders: vec![], your_big: 0, your_small: 0, your_points: 0 })
}

// ---- Coin maturity ------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UtxoDto {
    address: String,
    amount: f64,
    confirmations: i64,
    matured: bool,
    pct: f64,
    stakeable_at: i64,
}

/// Every unspent output with how mature it is for staking (combined across all
/// addresses). A single listunspent call; the countdown is approximate.
#[tauri::command]
async fn coin_maturity() -> Vec<UtxoDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else { return Vec::new() };
        coins::coin_maturity(&cfg)
            .into_iter()
            .map(|u| UtxoDto {
                address: u.address,
                amount: u.amount,
                confirmations: u.confirmations,
                matured: u.matured,
                pct: u.pct,
                stakeable_at: u.stakeable_at,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

// ---- Wallet password / encryption ---------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletStatusDto {
    encrypted: bool,
    unlocked: bool,
    staking_only: bool,
    remembered: bool,
    status: String,
}

/// Lock/encryption state, plus whether a password is saved in the OS store.
#[tauri::command]
async fn wallet_status() -> WalletStatusDto {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else {
            return WalletStatusDto {
                encrypted: false,
                unlocked: true,
                staking_only: false,
                remembered: false,
                status: "no-node".into(),
            };
        };
        let s = security::status(&cfg);
        WalletStatusDto {
            encrypted: s.encrypted,
            unlocked: s.unlocked,
            staking_only: s.staking_only,
            remembered: security::recall().is_some(),
            status: s.status,
        }
    })
    .await
    .unwrap_or(WalletStatusDto {
        encrypted: false,
        unlocked: true,
        staking_only: false,
        remembered: false,
        status: "error".into(),
    })
}

/// Unlock: staking-only (seconds 0 = until locked) or full for sends.
#[tauri::command]
async fn unlock_wallet(passphrase: String, staking_only: bool, seconds: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        security::unlock(&cfg, &passphrase, staking_only, seconds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn lock_wallet() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        security::lock(&cfg)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn change_passphrase(old: String, new: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        security::change_passphrase(&cfg, &old, &new)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn encrypt_wallet(passphrase: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        security::encrypt(&cfg, &passphrase)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// BIP39 seed words for the forced backup (wallet must be unlocked if encrypted).
#[tauri::command]
async fn wallet_seed() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        security::seed_words(&cfg)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save / clear the passphrase in the OS credential store (opt-in).
#[tauri::command]
async fn remember_password(passphrase: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || security::remember(&passphrase))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn forget_password() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(security::forget)
        .await
        .map_err(|e| e.to_string())?
}

// ── AI provider keys (bring-your-own-key), OS keychain only, local machine ──

/// Store a provider secret ("claude" | "grok" | "gateway"). Empty clears it.
#[tauri::command]
async fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || security::ai_set(&provider, &key))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[tauri::command]
async fn ai_clear_key(provider: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || security::ai_clear(&provider))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
struct AiStatusDto {
    /// Whether each key is present — the values themselves are never returned.
    claude: bool,
    grok: bool,
    /// The gateway URL is not a secret, so it's safe to show.
    gateway: String,
}

/// Which AI keys are configured (booleans only) + the gateway URL.
#[tauri::command]
async fn ai_status() -> AiStatusDto {
    tauri::async_runtime::spawn_blocking(|| AiStatusDto {
        claude: security::ai_get("claude").is_some(),
        grok: security::ai_get("grok").is_some(),
        gateway: security::ai_get("gateway").unwrap_or_default(),
    })
    .await
    .unwrap_or(AiStatusDto { claude: false, grok: false, gateway: String::new() })
}

// ── My Nodes: switch which node the wallet reads (Desktop, or a personal node
// like DIVI LOVE SCAN that only exists in this machine's nodes.json) ──────────
#[derive(Serialize)]
struct NodeDto {
    id: String,
    label: String,
    mode: String,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    has_pass: bool, // the password itself never crosses to the UI
    datadir: Option<String>,
    builtin: bool,
}
#[derive(Serialize)]
struct NodesDto {
    active: String,
    nodes: Vec<NodeDto>,
}

#[tauri::command]
async fn list_nodes() -> NodesDto {
    tauri::async_runtime::spawn_blocking(|| {
        let (active, profiles) = config::list_profiles();
        let nodes = profiles
            .into_iter()
            .map(|p| NodeDto {
                id: p.id,
                label: p.label,
                mode: p.mode,
                host: p.rpc_host,
                port: p.rpc_port,
                user: p.rpc_user,
                has_pass: p.rpc_pass.map(|s| !s.is_empty()).unwrap_or(false),
                datadir: p.datadir,
                builtin: p.builtin,
            })
            .collect();
        NodesDto { active, nodes }
    })
    .await
    .unwrap_or(NodesDto { active: "desktop".into(), nodes: vec![] })
}

#[tauri::command]
async fn set_active_node(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || config::set_active(&id))
        .await
        .unwrap_or_else(|_| Err("failed to switch node".into()))
}

/// Auto-resume staking on launch: recall the saved password (if any), staking-
/// only unlock, and start. The password never crosses into the UI layer.
#[tauri::command]
async fn resume_staking() -> StakeStartDto {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(cfg) = NodeConfig::load() else {
            return StakeStartDto { staking: false, needs_passphrase: false, message: "No node.".into() };
        };
        let pass = security::recall();
        let r = wallet::start_staking(&cfg, pass.as_deref());
        StakeStartDto { staking: r.staking, needs_passphrase: r.needs_passphrase, message: r.message }
    })
    .await
    .unwrap_or(StakeStartDto { staking: false, needs_passphrase: false, message: "internal error".into() })
}

/// Send DIVI. `passphrase` is supplied only when the wallet must be unlocked
/// just for this send (encrypted + ask-on-send). Returns the txid.
#[tauri::command]
async fn send_coins(address: String, amount: f64, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        wallet::send_coins(&cfg, &address, amount, passphrase.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PayReqDto {
    txid: String,
    pay_to: String,
    pay_to_address: Option<String>,
    amount_sats: u64,
    expiry: u32,
    memo: String,
    confirmations: i64,
    time: i64,
    notify_vout: Option<u32>,
}

/// Send an on-chain payment request to someone.
///
/// This only ASKS. It cannot move the recipient's money -- paying is a separate
/// act they sign themselves.
#[tauri::command]
async fn payment_request_create(
    payer: String,
    payTo: String,
    amount: f64,
    expiry: u32,
    memo: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        payreq::create(&cfg, &payer, &payTo, amount, expiry, &memo)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Payment requests addressed to this wallet, newest first.
#[tauri::command]
async fn payment_requests_inbox(count: Option<i64>) -> Result<Vec<PayReqDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let list = payreq::inbox(&cfg, count.unwrap_or(100))?;
        Ok(list
            .into_iter()
            .map(|r| PayReqDto {
                pay_to_address: payreq::pay_to_address(&cfg, &r.pay_to),
                txid: r.txid,
                pay_to: r.pay_to,
                amount_sats: r.amount_sats,
                expiry: r.expiry,
                memo: r.memo,
                confirmations: r.confirmations,
                time: r.time,
                notify_vout: r.notify_vout,
            })
            .collect())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct C2paDto {
    present: bool,
    state: String,
    signer: Option<String>,
    generator: Option<String>,
    signed_at: Option<String>,
    title: Option<String>,
    assertions: Vec<String>,
    ingredients: usize,
    issues: Vec<String>,
    divi_txid: Option<String>,
    json: String,
}

/// Read C2PA Content Credentials out of a file the user picked.
///
/// The bytes come from the UI because a browser File has no real path. Nothing
/// is uploaded anywhere: the SDK is built without remote-manifest fetching, so
/// this reads the file and nothing else.
#[tauri::command]
async fn c2pa_inspect(bytes: Vec<u8>, format: String) -> Result<C2paDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = c2pa_read::read(bytes, &format)?;
        Ok(C2paDto {
            present: s.present,
            state: s.state,
            signer: s.signer,
            generator: s.generator,
            signed_at: s.signed_at,
            title: s.title,
            assertions: s.assertions,
            ingredients: s.ingredients,
            issues: s.issues,
            divi_txid: s.divi_txid,
            json: s.json,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PriceDto {
    prices: std::collections::HashMap<String, f64>,
    coingecko_ok: bool,
    coinmarketcap_ok: bool,
    cmc_error: Option<String>,
}

/// Current DIVI price in the requested fiat currencies (CoinGecko + optional
/// CoinMarketCap). Runs off the UI thread; empty prices = sources unavailable.
#[tauri::command]
async fn divi_prices(currencies: Vec<String>, cmc_key: Option<String>, use_coingecko: bool) -> PriceDto {
    tauri::async_runtime::spawn_blocking(move || {
        let r = price::divi_prices(&currencies, cmc_key.as_deref(), use_coingecko);
        PriceDto {
            prices: r.prices,
            coingecko_ok: r.coingecko_ok,
            coinmarketcap_ok: r.coinmarketcap_ok,
            cmc_error: r.cmc_error,
        }
    })
    .await
    .unwrap_or(PriceDto {
        prices: std::collections::HashMap::new(),
        coingecko_ok: false,
        coinmarketcap_ok: false,
        cmc_error: None,
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // First-launch bring-up: create the config, download and verify
            // divid69, and start the node — all in the background so the window
            // opens immediately and the UI shows sync progress via node_status.
            // Idempotent, so on later launches this is a near-instant no-op.
            tauri::async_runtime::spawn_blocking(|| {
                let _ = dd69_supervisor::install::first_run_bringup(|stage| {
                    println!("[bringup] {stage}");
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            node_status,
            recent_blocks,
            c2pa_inspect,
            payment_request_create,
            payment_requests_inbox,
            chain_orphans,
            lottery_board,
            start_staking,
            wallet_balance,
            wallet_addresses,
            new_receive_address,
            recent_activity,
            list_transactions,
            validate_address,
            wallet_owns,
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
            probe_peers,
            ping_nodes,
            coin_maturity,
            wallet_status,
            unlock_wallet,
            lock_wallet,
            change_passphrase,
            encrypt_wallet,
            wallet_seed,
            remember_password,
            forget_password,
            resume_staking,
            send_coins,
            divi_prices,
            ai_set_key,
            ai_clear_key,
            ai_status,
            list_nodes,
            set_active_node
        ])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
