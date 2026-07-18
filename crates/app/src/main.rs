// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dd69_supervisor::{chaintips, coins, config::NodeConfig, network, poe, price, report, security, wallet};
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

/// Our own approximate location (caller IP), so the map can center before peers.
#[tauri::command]
async fn self_geo() -> Option<GeoDto> {
    tauri::async_runtime::spawn_blocking(|| {
        network::self_geo().map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country, isp: g.isp })
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
            .map(|g| GeoDto { ip: g.ip, lat: g.lat, lon: g.lon, city: g.city, country: g.country, isp: g.isp })
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
struct PriceDto {
    prices: std::collections::HashMap<String, f64>,
    coingecko_ok: bool,
    coinmarketcap_ok: bool,
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
        }
    })
    .await
    .unwrap_or(PriceDto {
        prices: std::collections::HashMap::new(),
        coingecko_ok: false,
        coinmarketcap_ok: false,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            node_status,
            recent_blocks,
            chain_orphans,
            lottery_board,
            start_staking,
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
            probe_peers,
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
            divi_prices
        ])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
