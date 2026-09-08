// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use dd69_supervisor::{applog, bearer, c2pa_read, chaintips, chart, coins, collectibles, collectibles_import, config, config::NodeConfig, dmt, escrow, fastsend, marketmaker, mempool, multisig, names, network, payreq, poe, price, report, security, wallet};
use serde::Serialize;
use serde_json::Value;

// Serves community app bundles over their own url scheme. Kept in its own module
// so this file only gains the three lines that wire it in.
mod community;

// Starts the small Node process the App Builder needs, so nobody has to open a
// terminal to use a feature in a desktop wallet.
mod builder_service;

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

/// The address this node signs identity records with (its account address).
#[tauri::command]
async fn signing_address() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| NodeConfig::load().ok().and_then(|cfg| wallet::signing_address(&cfg)))
        .await
        .ok()
        .flatten()
}

/// Sign a message with an owned address (wallet-auth for identity publishing).
/// Requires the wallet unlocked.
#[tauri::command]
async fn wallet_sign(address: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        wallet::sign_message(&cfg, &address, &message)
    })
    .await
    .map_err(|_| "internal error".to_string())?
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

/// First-run setup detection (read-only). Tells the UI which track the user is
/// on (new / has Divi Desktop 2.0 / already ready) and what local data we could
/// reuse, so the install panel can show the right flow.
#[tauri::command]
async fn setup_info() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(|| dd69_supervisor::setup::detect().to_json())
        .await
        .unwrap_or_else(|_| dd69_supervisor::setup::SetupInfo::default().to_json())
}

/// Resolve the DIVI snapshot server's real IP, so the setup map can draw the
/// download firehose from its actual geographic location (not a made-up point).
#[tauri::command]
async fn snapshot_source_ip() -> Option<String> {
    use std::net::ToSocketAddrs;
    tauri::async_runtime::spawn_blocking(|| {
        ("snapshots.diviproject.org", 443u16)
            .to_socket_addrs()
            .ok()
            .and_then(|mut it| it.next())
            .map(|a| a.ip().to_string())
    })
    .await
    .ok()
    .flatten()
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
    passphrase: Option<String>,
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
            passphrase.as_deref(),
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

// ── Human Readable Addresses (Divi Names) ─────────────────────────────────
//
// Every one of these is a thin wrapper: the rules live in the vendored
// `name-registry` crate and the flows in `supervisor::names`, so the wallet, an
// explorer and any indexer answer identically. Nothing here decides anything.

macro_rules! hra_blocking {
    ($body:expr) => {
        tauri::async_runtime::spawn_blocking(move || {
            let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
            #[allow(clippy::redundant_closure_call)]
            ($body)(&cfg)
        })
        .await
        .map_err(|_| "internal error".to_string())?
    };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HraQuoteDto {
    canonical: String,
    registration_divi: u64,
    renewal_divi: u64,
    can_be_ticker: bool,
    available: Option<bool>,
    owner: Option<String>,
}

/// Validate and price a typed name, and say whether it is taken.
#[tauri::command]
async fn hra_quote(input: String) -> Result<HraQuoteDto, String> {
    hra_blocking!(move |cfg: &NodeConfig| {
        names::quote(cfg, &input).map(|q| HraQuoteDto {
            canonical: q.canonical,
            registration_divi: q.registration_divi,
            renewal_divi: q.renewal_divi,
            can_be_ticker: q.can_be_ticker,
            available: q.available,
            owner: q.owner,
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HraSyncDto {
    activated: bool,
    activation_height: u64,
    scanned_height: u64,
    tip: u64,
    caught_up: bool,
    names_known: u64,
    treasury_configured: bool,
    txindex: bool,
    note: String,
}

/// Read another chunk of the chain into the local name index.
#[tauri::command]
async fn hra_sync() -> Result<HraSyncDto, String> {
    hra_blocking!(move |cfg: &NodeConfig| {
        names::sync(cfg).map(|s| HraSyncDto {
            activated: s.activated,
            activation_height: s.activation_height,
            scanned_height: s.scanned_height,
            tip: s.tip,
            caught_up: s.caught_up,
            names_known: s.names_known,
            treasury_configured: s.treasury_configured,
            txindex: s.txindex,
            note: s.note,
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HraPendingDto {
    name: String,
    txid: String,
    commit_height: u64,
    blocks_remaining: u64,
    ready: bool,
}

#[tauri::command]
async fn hra_pending() -> Result<Vec<HraPendingDto>, String> {
    hra_blocking!(move |cfg: &NodeConfig| {
        names::pending(cfg).map(|v| {
            v.into_iter()
                .map(|p| HraPendingDto {
                    name: p.name,
                    txid: p.txid,
                    commit_height: p.commit_height,
                    blocks_remaining: p.blocks_remaining,
                    ready: p.ready,
                })
                .collect()
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HraNameDto {
    name: String,
    owner: String,
    divi_address: Option<String>,
    registered_height: u64,
    expires_height: u64,
    records: Vec<(u8, String)>,
    is_primary: bool,
    listed_price_divi: Option<f64>,
    from_reserve: bool,
    perpetual: bool,
}

#[tauri::command]
async fn hra_my_names() -> Result<Vec<HraNameDto>, String> {
    hra_blocking!(move |cfg: &NodeConfig| {
        names::my_names(cfg).map(|v| {
            v.into_iter()
                .map(|n| HraNameDto {
                    name: n.name,
                    owner: n.owner,
                    divi_address: n.divi_address,
                    registered_height: n.registered_height,
                    expires_height: n.expires_height,
                    records: n.records,
                    is_primary: n.is_primary,
                    listed_price_divi: n.listed_price_divi,
                    from_reserve: n.from_reserve,
                    perpetual: n.perpetual,
                })
                .collect()
        })
    })
}

/// Step 1: reserve a name by publishing only a salted hash of it.
#[tauri::command]
async fn hra_commit(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::commit(cfg, &name))
}

/// Step 2: reveal the name and pay the registration fee.
#[tauri::command]
async fn hra_register(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::register(cfg, &name))
}

#[tauri::command]
async fn hra_forget(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || names::forget_pending(&name))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[tauri::command]
async fn hra_set_divi_address(name: String, address: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::set_divi_address(cfg, &name, &address))
}

#[tauri::command]
async fn hra_set_record(name: String, key: u8, valueHex: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::set_record(cfg, &name, key, &valueHex))
}

#[tauri::command]
async fn hra_clear_record(name: String, keys: Vec<u8>) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::clear_record(cfg, &name, keys))
}

#[tauri::command]
async fn hra_transfer(name: String, newOwner: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::transfer(cfg, &name, &newOwner))
}

#[tauri::command]
async fn hra_set_primary(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::set_primary(cfg, &name))
}

#[tauri::command]
async fn hra_renew(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::renew(cfg, &name))
}

/// Look up the Divi address a name points at, from THIS wallet's own index.
/// Never asks a remote service: a wrong answer here sends money to a stranger.
#[tauri::command]
async fn hra_resolve(name: String) -> Result<Option<String>, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::resolve(cfg, &name))
}

/// The name an address displays as, if both directions agree.
///
/// Decoration for an address already on screen, so it degrades to "no name"
/// rather than an error when the index is behind. That asymmetry is
/// deliberate: showing nothing costs the user nothing, whereas a wrong forward
/// resolution moves money.
#[tauri::command]
async fn hra_reverse(address: String) -> Result<Option<String>, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::reverse(cfg, &address))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HraListingDto {
    name: String,
    seller: String,
    price_divi: f64,
    fee_divi: f64,
    locked_for_blocks: u64,
    is_mine: bool,
}

/// Every name currently for sale.
#[tauri::command]
async fn hra_market() -> Result<Vec<HraListingDto>, String> {
    hra_blocking!(move |cfg: &NodeConfig| {
        names::market(cfg).map(|v| {
            v.into_iter()
                .map(|l| HraListingDto {
                    name: l.name,
                    seller: l.seller,
                    price_divi: l.price_divi,
                    fee_divi: l.fee_divi,
                    locked_for_blocks: l.locked_for_blocks,
                    is_mine: l.is_mine,
                })
                .collect()
        })
    })
}

#[tauri::command]
async fn hra_list_for_sale(name: String, priceDivi: f64, minLifetimeBlocks: u64) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::list_for_sale(cfg, &name, priceDivi, minLifetimeBlocks))
}

#[tauri::command]
async fn hra_delist(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::delist(cfg, &name))
}

/// Buy a listed name. One transaction pays the seller and claims it.
#[tauri::command]
async fn hra_buy(name: String) -> Result<String, String> {
    hra_blocking!(move |cfg: &NodeConfig| names::buy(cfg, &name))
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
struct MemEntryDto {
    txid: String,
    size: i64,
    fee_sats: i64,
    time: i64,
    decoded: bool,
    mine: bool,
    category: String,
    amount_mine: f64,
    has_data: bool,
    fast: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictDto {
    outpoint: String,
    kept: String,
    rejected: String,
    time: i64,
}

/// Recent double-spend conflicts the node saw. Empty on daemons without the RPC.
#[tauri::command]
async fn mempool_conflicts() -> Vec<ConflictDto> {
    tauri::async_runtime::spawn_blocking(|| {
        NodeConfig::load()
            .map(|cfg| {
                mempool::conflicts(&cfg)
                    .into_iter()
                    .map(|c| ConflictDto { outpoint: c.outpoint, kept: c.kept, rejected: c.rejected, time: c.time })
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MempoolDto {
    tip: i64,
    best_hash: String,
    entries: Vec<MemEntryDto>,
}

/// Live mempool snapshot. `known` = txids the UI already classified, so only new
/// transactions get decoded. Polled quickly while the Mempool panel is open.
#[tauri::command]
async fn mempool_snapshot(known: Vec<String>) -> Option<MempoolDto> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().ok()?;
        let s = mempool::snapshot(&cfg, &known)?;
        Some(MempoolDto {
            tip: s.tip,
            best_hash: s.best_hash,
            entries: s
                .entries
                .into_iter()
                .map(|e| MemEntryDto {
                    txid: e.txid,
                    size: e.size,
                    fee_sats: e.fee_sats,
                    time: e.time,
                    decoded: e.decoded,
                    mine: e.mine,
                    category: e.category,
                    amount_mine: e.amount_mine,
                    has_data: e.has_data,
                    fast: e.fast,
                })
                .collect(),
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
struct PricePointDto {
    ts: String,
    close: f64,
}

/// DIVI price time-series (oldest first) for the in-app price chart, read from
/// the Supabase series sourced from CoinMarketCap (daily + hourly + 15-min).
#[tauri::command]
async fn price_history() -> Vec<PricePointDto> {
    tauri::async_runtime::spawn_blocking(|| {
        chart::price_history()
            .into_iter()
            .map(|p| PricePointDto { ts: p.ts, close: p.close.unwrap_or(0.0) })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// The latest DIVI/USD price from the shared CMC feed, for pricing the PoE fee
/// with no per-user API key. None if the feed is unavailable.
#[tauri::command]
async fn price_latest() -> Option<f64> {
    tauri::async_runtime::spawn_blocking(chart::price_latest)
        .await
        .ok()
        .flatten()
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
#[serde(rename_all = "camelCase")]
struct AiStatusDto {
    /// Whether each key is present — the values themselves are never returned.
    claude: bool,
    grok: bool,
    /// A token for the gateway, which is not a model key.
    gateway_token: bool,
    /// The gateway URL is not a secret, so it's safe to show.
    gateway: String,
}

/// Which AI keys are configured (booleans only) + the gateway URL.
#[tauri::command]
async fn ai_status() -> AiStatusDto {
    tauri::async_runtime::spawn_blocking(|| AiStatusDto {
        claude: security::ai_get("claude").is_some(),
        grok: security::ai_get("grok").is_some(),
        gateway_token: security::ai_get("gateway_token").is_some(),
        // From a plain file, not the keychain: a URL is not a secret, and
        // keeping it there cost a permission prompt for no protection.
        gateway: builder_service::read_gateway_url().unwrap_or_default(),
    })
    .await
    .unwrap_or(AiStatusDto {
        claude: false,
        grok: false,
        gateway_token: false,
        gateway: String::new(),
    })
}

// ── Market Maker: trade-only exchange API keys (OS keychain), plus a read-only
// connection check. The secret never crosses back to the UI — only balances do ──

/// Save trade-only API keys for one exchange (by catalog slug) into the keychain.
#[tauri::command]
async fn mm_save_credentials(
    slug: String,
    api_key: String,
    api_secret: String,
    passphrase: Option<String>,
) -> Result<(), String> {
    let pass = passphrase.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || marketmaker::save(&slug, &api_key, &api_secret, &pass))
        .await
        .map_err(|_| "internal error".to_string())?
}

/// Whether keys are stored for this exchange (used to show connected state).
#[tauri::command]
async fn mm_has_credentials(slug: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || marketmaker::has(&slug))
        .await
        .map_err(|_| "internal error".to_string())
}

/// Remove the stored keys for one exchange.
#[tauri::command]
async fn mm_clear_credentials(slug: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || marketmaker::clear(&slug))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MmBalanceDto {
    asset: String,
    free: f64,
    locked: f64,
}

/// Verify the stored keys by reading account balances (read-only — never trades).
/// `connector` and `rest_url` come from the exchange catalog the UI already has.
#[tauri::command]
async fn mm_test_connection(
    slug: String,
    connector: String,
    rest_url: String,
) -> Result<Vec<MmBalanceDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        marketmaker::test_connection(&slug, &connector, &rest_url).map(|rows| {
            rows.into_iter()
                .map(|b| MmBalanceDto { asset: b.asset, free: b.free, locked: b.locked })
                .collect::<Vec<MmBalanceDto>>()
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Start the live market maker with a laddered config.
#[tauri::command]
async fn mm_start(
    slug: String,
    connector: String,
    rest_url: String,
    symbol: String,
    levels: Vec<f64>,
    commit_usdt: f64,
    refresh_secs: u64,
    protect_pct: f64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        marketmaker::start(marketmaker::MmConfig {
            slug, connector, rest_url, symbol, levels, commit_usdt, refresh_secs, protect_pct,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Stop the live market maker (cancels all resting orders).
#[tauri::command]
async fn mm_stop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(marketmaker::stop)
        .await
        .map_err(|_| "internal error".to_string())?
}

/// Cancel every resting order for a pair, even if the engine isn't running —
/// clears orders left on the exchange after an unclean stop. Returns the count.
#[tauri::command]
async fn mm_cancel_all(slug: String, connector: String, rest_url: String, symbol: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || marketmaker::cancel_all_orders(&slug, &connector, &rest_url, &symbol))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MmStatusDto {
    running: bool,
    message: String,
    mid: f64,
    open_orders: usize,
    base_free: f64,
    base_held: f64,
    quote_free: f64,
    quote_held: f64,
    cycles: u64,
}

/// Current engine status (polled by the UI).
#[tauri::command]
async fn mm_status() -> MmStatusDto {
    tauri::async_runtime::spawn_blocking(|| {
        let s = marketmaker::status();
        MmStatusDto {
            running: s.running, message: s.message, mid: s.mid, open_orders: s.open_orders,
            base_free: s.base_free, base_held: s.base_held, quote_free: s.quote_free,
            quote_held: s.quote_held, cycles: s.cycles,
        }
    })
    .await
    .unwrap_or(MmStatusDto {
        running: false, message: String::new(), mid: 0.0, open_orders: 0,
        base_free: 0.0, base_held: 0.0, quote_free: 0.0, quote_held: 0.0, cycles: 0,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BookLevelDto { price: f64, size: f64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenOrderDto { side: String, price: f64, size: f64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MmBookDto {
    mid: f64,
    best_bid: f64,
    best_ask: f64,
    asks: Vec<BookLevelDto>,
    bids: Vec<BookLevelDto>,
    our_orders: Vec<OpenOrderDto>,
    base_free: f64,
    base_held: f64,
    quote_free: f64,
    quote_held: f64,
}

/// A live order-book snapshot for the depth-ladder view: public book + our own
/// resting orders + mid + balances, in one read-only call. Polled by the UI.
#[tauri::command]
async fn mm_book(slug: String, connector: String, rest_url: String, symbol: String) -> Result<MmBookDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let b = marketmaker::book(&slug, &connector, &rest_url, &symbol)?;
        Ok::<MmBookDto, String>(MmBookDto {
            mid: b.mid,
            best_bid: b.best_bid,
            best_ask: b.best_ask,
            asks: b.asks.into_iter().map(|l| BookLevelDto { price: l.price, size: l.size }).collect(),
            bids: b.bids.into_iter().map(|l| BookLevelDto { price: l.price, size: l.size }).collect(),
            our_orders: b.our_orders.into_iter().map(|o| OpenOrderDto { side: o.side, price: o.price, size: o.size }).collect(),
            base_free: b.base_free,
            base_held: b.base_held,
            quote_free: b.quote_free,
            quote_held: b.quote_held,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TradePnlDto {
    fills: usize,
    buys: usize,
    sells: usize,
    divi_bought: f64,
    divi_sold: f64,
    usdt_spent: f64,
    usdt_recv: f64,
    avg_buy: f64,
    avg_sell: f64,
    net_divi: f64,
    net_usdt: f64,
    gross_volume: f64,
    mid: f64,
    total_pnl: f64,
    first_ms: i64,
    last_ms: i64,
}

/// Realized market-making P&L, reconstructed from the exchange's own filled-order
/// history. This is how a node holder audits where their money went. Read-only.
#[tauri::command]
async fn mm_trade_history(slug: String, connector: String, rest_url: String, symbol: String, source: String) -> Result<TradePnlDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = marketmaker::trade_history(&slug, &connector, &rest_url, &symbol, &source)?;
        Ok::<TradePnlDto, String>(TradePnlDto {
            fills: p.fills, buys: p.buys, sells: p.sells,
            divi_bought: p.divi_bought, divi_sold: p.divi_sold,
            usdt_spent: p.usdt_spent, usdt_recv: p.usdt_recv,
            avg_buy: p.avg_buy, avg_sell: p.avg_sell,
            net_divi: p.net_divi, net_usdt: p.net_usdt, gross_volume: p.gross_volume,
            mid: p.mid, total_pnl: p.total_pnl, first_ms: p.first_ms, last_ms: p.last_ms,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Place a manual buy/sell (the user's own order, not the engine's). Market or
/// limit; quantity is always in the base coin. Returns the new order id.
#[tauri::command]
async fn mm_place_order(slug: String, connector: String, rest_url: String, symbol: String,
                        side: String, order_type: String, quantity: f64, price: Option<f64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        marketmaker::place_order(&slug, &connector, &rest_url, &symbol, &side, &order_type, quantity, price)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Cancel one of the user's orders by id.
#[tauri::command]
async fn mm_cancel_order(slug: String, connector: String, rest_url: String, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        marketmaker::cancel_order(&slug, &connector, &rest_url, &id)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManualOrderDto {
    id: String,
    side: String,
    order_type: String,
    price: f64,
    qty: f64,
    from_mm: bool,
    created_ms: i64,
}

/// The user's currently-open orders on a pair, with ids for the Trade panel.
#[tauri::command]
async fn mm_open_orders(slug: String, connector: String, rest_url: String, symbol: String) -> Result<Vec<ManualOrderDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let orders = marketmaker::open_orders(&slug, &connector, &rest_url, &symbol)?;
        Ok::<Vec<ManualOrderDto>, String>(orders.into_iter().map(|o| ManualOrderDto {
            id: o.id, side: o.side, order_type: o.order_type, price: o.price, qty: o.qty, from_mm: o.from_mm, created_ms: o.created_ms,
        }).collect())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DexPoolDto {
    reserve_edivi: f64,
    reserve_weth: f64,
    eth_usd: f64,
    edivi_decimals: u32,
}

/// Read the eDIVI/WETH Uniswap V2 pool (reserves + on-chain ETH/USD) for the DEX
/// tab. Read-only — no keys, no signing.
#[tauri::command]
async fn dex_pool() -> Result<DexPoolDto, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let p = dd69_supervisor::dex::pool()?;
        Ok::<DexPoolDto, String>(DexPoolDto {
            reserve_edivi: p.reserve_edivi,
            reserve_weth: p.reserve_weth,
            eth_usd: p.eth_usd,
            edivi_decimals: p.edivi_decimals,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Try to (re)start the local node. Re-runs the idempotent first-run bring-up,
/// which ensures the config + divid69 and starts the node with crash recovery.
/// Used by the startup modal's "Try to start the node" button.
#[tauri::command]
async fn restart_node() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        dd69_supervisor::install::first_run_bringup(|_| {}).map(|_| ())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppLogDto {
    ts_ms: u64,
    msg: String,
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeLogsDto {
    node_log: String,
    app_log: Vec<AppLogDto>,
}

/// Read the tail of a possibly-huge log file without loading it all into memory.
fn tail_file(path: &std::path::Path, max_bytes: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => return format!("(couldn't open {}: {e})", path.display()),
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(max_bytes);
    let _ = f.seek(SeekFrom::Start(start));
    let mut buf = String::new();
    let _ = f.take(max_bytes).read_to_string(&mut buf);
    // Drop the partial first line when we seeked into the middle.
    if start > 0 {
        if let Some(i) = buf.find('\n') {
            buf = buf[i + 1..].to_string();
        }
    }
    buf
}

/// Collapse runs of identical lines (ignoring each line's leading timestamp) into
/// one line + a "[^^ xN]" marker, so repeated spam doesn't bloat the log view.
fn collapse_lines(text: &str) -> String {
    fn body(line: &str) -> &str {
        // Node lines look like "2026-08-26 12:19:47 <message>"; compare the part
        // after the 19-char timestamp so identical events collapse across times.
        let b = line.as_bytes();
        if b.len() > 20 && b[4] == b'-' && b[10] == b' ' {
            &line[20..]
        } else {
            line
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut iter = text.lines().peekable();
    while let Some(line) = iter.next() {
        let mut count = 1u32;
        while iter.peek().map(|n| body(n) == body(line)).unwrap_or(false) {
            iter.next();
            count += 1;
        }
        out.push_str(line);
        out.push('\n');
        if count > 1 {
            out.push_str(&format!("[^^ x{count}]\n"));
        }
    }
    out
}

/// The node's own log (collapsed) plus the app's event log, for Settings → Logs.
/// Read-only, so it never hangs on a busy node.
#[tauri::command]
async fn node_logs() -> NodeLogsDto {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = config::dd69_datadir();
        let raw = tail_file(&dir.join("debug.log"), 60_000);
        let app_log = applog::entries()
            .into_iter()
            .map(|e| AppLogDto { ts_ms: e.ts_ms, msg: e.msg, count: e.count })
            .collect();
        NodeLogsDto { node_log: collapse_lines(&raw), app_log }
    })
    .await
    .unwrap_or(NodeLogsDto { node_log: String::new(), app_log: Vec::new() })
}

/// The full, detailed first-run setup log as one copy-pasteable block, for the
/// ⌘L "copy setup log" shortcut. Read-only; contains no secrets (never the
/// wallet password, seed phrase, keys, or the node's rpcpassword).
#[tauri::command]
async fn setup_log_report() -> String {
    tauri::async_runtime::spawn_blocking(dd69_supervisor::setuplog::report)
        .await
        .unwrap_or_else(|_| "setup log unavailable".into())
}

/// This install's node identity: a stable id (survives IP changes) plus the
/// user's chosen node name. Read on startup so the map can label the user's own
/// node and, later, group its many IPs into one.
#[tauri::command]
async fn node_identity() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(dd69_supervisor::identity::to_json)
        .await
        .unwrap_or_else(|_| serde_json::json!({ "id": "", "name": "", "nameSource": "custom" }))
}

/// Set (or clear) this node's name. `source` is "custom" for a typed name, or
/// "agent" when the name comes from the node's registered Agent identity.
#[tauri::command]
async fn set_node_name(name: String, source: Option<String>) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        dd69_supervisor::identity::set_name(&name, source.as_deref().unwrap_or("custom"))
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "id": "", "name": "", "nameSource": "custom" }))
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TxStatusDto {
    found: bool,
    confirmations: i64,
    time: i64,
    amount: f64,
    category: String,
}

/// Live status of one wallet transaction, polled by the Fast Send tracker.
#[tauri::command]
async fn tx_status(txid: String) -> TxStatusDto {
    tauri::async_runtime::spawn_blocking(move || {
        let s = NodeConfig::load()
            .map(|cfg| wallet::tx_status(&cfg, &txid))
            .unwrap_or(wallet::TxStatus { found: false, confirmations: 0, time: 0, amount: 0.0, category: String::new() });
        TxStatusDto { found: s.found, confirmations: s.confirmations, time: s.time, amount: s.amount, category: s.category }
    })
    .await
    .unwrap_or(TxStatusDto { found: false, confirmations: 0, time: 0, amount: 0.0, category: String::new() })
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

/// Fast Send: a raw transaction paying a ~5x priority fee and carrying the
/// on-chain "DFS1" marker. A hard fee cap is checked against the final signed
/// tx before broadcast. Returns the txid.
#[tauri::command]
async fn fast_send(address: String, amount: f64, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|e| e.to_string())?;
        fastsend::fast_send(&cfg, &address, amount, passphrase.as_deref())
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
// ---- Bearer transactions (redeemable claim codes) ----
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BearerCreatedDto {
    code: String,
    address: String,
    txid: String,
    vout: u32,
    amount: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BearerStatusDto {
    funded: bool,
    claimed: bool,
    value: f64,
    receivable: f64,
    confirmations: i64,
}

/// Create a redeemable bearer code funded with `amount` DIVI. Revocable: the
/// key stays in this wallet, so the sender can reclaim an unredeemed code.
#[tauri::command]
async fn bearer_create(amount: f64, passphrase: Option<String>) -> Result<BearerCreatedDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        bearer::create(&cfg, amount, passphrase.as_deref()).map(|b| BearerCreatedDto {
            code: b.code,
            address: b.address,
            txid: b.txid,
            vout: b.vout,
            amount: b.amount,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Sweep a bearer code to `dest`. Used to claim (recipient) or reclaim (sender).
#[tauri::command]
async fn bearer_sweep(code: String, dest: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        bearer::sweep(&cfg, &code, &dest)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Is a bearer code still claimable? Reads the UTXO set only.
#[tauri::command]
async fn bearer_status(code: String) -> Result<BearerStatusDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        bearer::status(&cfg, &code).map(|s| BearerStatusDto {
            funded: s.funded,
            claimed: s.claimed,
            value: s.value,
            receivable: s.receivable,
            confirmations: s.confirmations,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

// ---- Pin Code Send: on-chain escrow (HTLC) ----
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EscrowCreatedDto {
    ticket: String,
    txid: String,
    vout: u32,
    amount: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EscrowStatusDto {
    funded: bool,
    claimed: bool,
    amount: f64,
    confirmations: i64,
    recipient: String,
    sender: String,
    locktime: u32,
}

/// Create an escrow: lock `amount` to `recipient`, refundable to the sender after
/// `locktime` (unix), unlockable only by revealing `code` (a long random release
/// code generated in the UI). Sender pays the fee.
#[tauri::command]
async fn escrow_create(
    recipient: String,
    amount: f64,
    code: String,
    locktime: u32,
    passphrase: Option<String>,
) -> Result<EscrowCreatedDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        escrow::create(&cfg, &recipient, amount, &code, locktime, passphrase.as_deref()).map(|e| EscrowCreatedDto {
            ticket: e.ticket,
            txid: e.txid,
            vout: e.vout,
            amount: e.amount,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// What a ticket holder can see without the code (committed amount, parties, refund date).
#[tauri::command]
async fn escrow_status(ticket: String) -> Result<EscrowStatusDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        escrow::status(&cfg, &ticket).map(|s| EscrowStatusDto {
            funded: s.funded,
            claimed: s.claimed,
            amount: s.amount,
            confirmations: s.confirmations,
            recipient: s.recipient,
            sender: s.sender,
            locktime: s.locktime,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Recipient claims by revealing the code (their wallet must own the recipient address).
#[tauri::command]
async fn escrow_claim(ticket: String, code: String, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        escrow::claim(&cfg, &ticket, &code, passphrase.as_deref())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Sender reclaims after the timelock (no code needed).
#[tauri::command]
async fn escrow_refund(ticket: String, passphrase: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        escrow::refund(&cfg, &ticket, passphrase.as_deref())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

// ---- MultiSig (native P2SH N-of-M) + treasury balances ----
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddrBalanceDto {
    available: bool,
    balance: f64,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MultisigWalletDto {
    label: String,
    address: String,
    m: u32,
    n: u32,
    participants: Vec<String>,
    balance: f64,
    balance_available: bool,
    definition: String,
    created_at: i64,
}

impl From<multisig::WalletView> for MultisigWalletDto {
    fn from(w: multisig::WalletView) -> Self {
        MultisigWalletDto {
            label: w.label,
            address: w.address,
            m: w.m,
            n: w.n,
            participants: w.participants,
            balance: w.balance,
            balance_available: w.balance_available,
            definition: w.definition,
            created_at: w.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpendOutputDto {
    address: String,
    amount: f64,
    is_change: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpendPreviewDto {
    from: String,
    mixed_sources: bool,
    source_ok: bool,
    total_in: f64,
    outputs: Vec<SpendOutputDto>,
    total_out: f64,
    fee: f64,
    signed: u32,
    required: u32,
    complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingSpendDto {
    blob: String,
    from: String,
    to: String,
    amount: f64,
    fee: f64,
    required: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignResultDto {
    blob: String,
    complete: bool,
    added: bool,
    signed: u32,
    required: u32,
    from: String,
    to: String,
    amount: f64,
    fee: f64,
}

/// Confirmed balance of any address (treasury wallets, or a multisig), via the
/// node's address index. `available=false` (with a reason) rather than an error
/// when the index is still building, so the UI can show "unavailable" calmly.
#[tauri::command]
async fn address_balance(address: String) -> Result<AddrBalanceDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        Ok(match multisig::address_balance(&cfg, &address) {
            Ok(balance) => AddrBalanceDto { available: true, balance, message: String::new() },
            Err(msg) => AddrBalanceDto { available: false, balance: 0.0, message: msg },
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Every multisig wallet this app knows, each with a freshly read balance.
#[tauri::command]
async fn multisig_list() -> Result<Vec<MultisigWalletDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        Ok(multisig::list_wallets(&cfg).into_iter().map(Into::into).collect())
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Create an m-of-n P2SH multisig address from a set of co-signer keys
/// (hex pubkeys or addresses the node knows). Derives + stores it; imports
/// nothing and needs no unlock.
#[tauri::command]
async fn multisig_create(m: u32, keys: Vec<String>, label: String) -> Result<MultisigWalletDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::create_wallet(&cfg, m, keys, &label).map(|w| MultisigWalletDto {
            definition: multisig::definition_blob(&w),
            label: w.label,
            address: w.address,
            m: w.m,
            n: w.n,
            participants: w.participants,
            balance: 0.0,
            balance_available: false,
            created_at: w.created_at,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Add a shared wallet someone else built, from its definition blob. Imports it
/// so this wallet can co-sign; derives the same address as everyone else.
#[tauri::command]
async fn multisig_import(definition: String) -> Result<MultisigWalletDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::import_wallet(&cfg, &definition).map(|w| MultisigWalletDto {
            definition: multisig::definition_blob(&w),
            label: w.label,
            address: w.address,
            m: w.m,
            n: w.n,
            participants: w.participants,
            balance: 0.0,
            balance_available: false,
            created_at: w.created_at,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Decode the REAL transaction a pending spend will make, so the signer can
/// verify the recipient and amount before approving.
#[tauri::command]
async fn multisig_inspect(blob: String) -> Result<SpendPreviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::inspect_spend(&cfg, &blob).map(|p| SpendPreviewDto {
            from: p.from,
            mixed_sources: p.mixed_sources,
            source_ok: p.source_ok,
            total_in: p.total_in,
            outputs: p
                .outputs
                .into_iter()
                .map(|o| SpendOutputDto { address: o.address, amount: o.amount, is_change: o.is_change })
                .collect(),
            total_out: p.total_out,
            fee: p.fee,
            signed: p.signed,
            required: p.required,
            complete: p.complete,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Remove a multisig wallet from this app's list (local only; moves no coins).
#[tauri::command]
async fn multisig_forget(address: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || multisig::forget_wallet(&address))
        .await
        .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityDto {
    txid: String,
    amount: f64,
    height: i64,
    time: i64,
    confirmations: i64,
}

/// Recent deposits and spends for a shared wallet (the treasury audit trail).
#[tauri::command]
async fn multisig_activity(address: String, limit: Option<usize>) -> Result<Vec<ActivityDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::wallet_activity(&cfg, &address, limit.unwrap_or(25)).map(|list| {
            list.into_iter()
                .map(|a| ActivityDto {
                    txid: a.txid,
                    amount: a.amount,
                    height: a.height,
                    time: a.time,
                    confirmations: a.confirmations,
                })
                .collect()
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Propose a spend from a multisig wallet. Returns a shareable blob the
/// co-signers add their signatures to. Signs nothing.
#[tauri::command]
async fn multisig_propose(fromAddress: String, to: String, amount: f64) -> Result<PendingSpendDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::propose_spend(&cfg, &fromAddress, &to, amount).map(|p| PendingSpendDto {
            blob: p.blob,
            from: p.from,
            to: p.to,
            amount: p.amount,
            fee: p.fee,
            required: p.required,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Add this wallet's signature to a pending spend and hand back the updated blob.
#[tauri::command]
async fn multisig_sign(blob: String, passphrase: Option<String>) -> Result<SignResultDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::sign_spend(&cfg, &blob, passphrase.as_deref()).map(|s| SignResultDto {
            blob: s.blob,
            complete: s.complete,
            added: s.added,
            signed: s.signed,
            required: s.required,
            from: s.from,
            to: s.to,
            amount: s.amount,
            fee: s.fee,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Broadcast a fully-signed multisig spend. Returns the txid.
#[tauri::command]
async fn multisig_broadcast(blob: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::broadcast_spend(&cfg, &blob)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MyKeyDto {
    address: String,
    pubkey: String,
}

/// A fresh address + its public key, to hand to co-signers when creating a
/// shared wallet (the wallet keeps the private key so this address can sign).
#[tauri::command]
async fn multisig_my_pubkey() -> Result<MyKeyDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        multisig::new_shareable_pubkey(&cfg).map(|k| MyKeyDto {
            address: k.address,
            pubkey: k.pubkey,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NfdMintDto {
    txid: String,
    owner_addr: String,
    content_hash: String,
    arweave_ptr: String,
    thumb_ptr: Option<String>,
}

/// Mint a Divi Collectible (NFD). The UI passes the file bytes as base64; the
/// content is encrypted to the owner locally and only the encrypted bundle is
/// stored. If the creator opted into a public preview, `thumbnail_b64` +
/// `thumbnail_mime` carry a small unencrypted thumbnail. Returns the handle the
/// UI keeps to view it later.
#[tauri::command]
async fn nfd_mint(
    content_b64: String,
    content_mime: String,
    encrypted: bool,
    thumbnail_b64: Option<String>,
    thumbnail_mime: Option<String>,
    collection_id: Option<String>,
    creator_addr: Option<String>,
    traits_json: Option<String>,
) -> Result<NfdMintDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let bytes = STANDARD.decode(&content_b64).map_err(|_| "bad file data".to_string())?;
        let thumb_bytes = match &thumbnail_b64 {
            Some(b64) => Some(STANDARD.decode(b64).map_err(|_| "bad thumbnail data".to_string())?),
            None => None,
        };
        let thumbnail = match (&thumb_bytes, &thumbnail_mime) {
            (Some(b), Some(mime)) => Some((b.as_slice(), mime.as_str())),
            _ => None,
        };
        // Mint into a collection when the UI supplied the collection id, its
        // creator address, and the public traits JSON.
        let collection = match (&collection_id, &creator_addr, &traits_json) {
            (Some(cid), Some(ca), Some(tj)) => Some(collectibles::CollectionMint {
                creator_addr: ca.as_str(),
                collection_id: cid.as_str(),
                traits_json: tj.as_bytes(),
            }),
            _ => None,
        };
        let d = collectibles::mint(&cfg, &bytes, &content_mime, encrypted, thumbnail, collection)?;
        Ok(NfdMintDto {
            txid: d.txid,
            owner_addr: d.owner_addr,
            content_hash: d.content_hash,
            arweave_ptr: d.arweave_ptr,
            thumb_ptr: d.thumb_ptr,
        })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Fetch, decrypt, and authenticate a collectible you own. Returns the original
/// file bytes as base64 for the UI to display. Errors if not authentic / not yours.
#[tauri::command]
async fn nfd_view(owner_addr: String, arweave_ptr: String, content_hash: String, encrypted: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let bytes = collectibles::view(&cfg, &owner_addr, &arweave_ptr, &content_hash, encrypted)?;
        Ok(STANDARD.encode(bytes))
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NfdCollectionDto {
    txid: String,
    meta_ptr: String,
    creator_addr: String,
}

/// Create a collection. `creator_addr` is the stable address that owns the
/// collection and must mint every item into it; it needs a little DIVI. `cover`
/// is an optional public banner image. Returns the collection id (the txid).
#[tauri::command]
async fn nfd_create_collection(
    creator_addr: String,
    name: String,
    description: String,
    max_supply: u32,
    cover_b64: Option<String>,
    cover_mime: Option<String>,
) -> Result<NfdCollectionDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let cover_bytes = match &cover_b64 {
            Some(b64) => Some(STANDARD.decode(b64).map_err(|_| "bad cover data".to_string())?),
            None => None,
        };
        let cover = match (&cover_bytes, &cover_mime) {
            (Some(b), Some(mime)) => Some((b.as_slice(), mime.as_str())),
            _ => None,
        };
        let c = collectibles::create_collection(&cfg, &creator_addr, &name, &description, cover, max_supply)?;
        Ok(NfdCollectionDto { txid: c.txid, meta_ptr: c.meta_ptr, creator_addr })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Open + validate a Kinet.ink collection import (.zip). Unpacks and returns a
/// plan (collection meta + per-item ok/error) WITHOUT publishing anything.
#[tauri::command]
async fn nfd_import_open(zip_path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        collectibles_import::open(&cfg, &zip_path)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Read one item's bytes + metadata (base64) from an opened import, for minting.
#[tauri::command]
async fn nfd_import_read_item(import_dir: String, edition: u64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        collectibles_import::read_item(&cfg, &import_dir, edition)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Pre-split the creator's coins into `count` spendable UTXOs so a batch of that
/// many mints doesn't stall. Returns the fan-out txid to wait on, or null if the
/// address already has enough UTXOs.
#[tauri::command]
async fn nfd_prepare_funding(address: String, count: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        collectibles::prepare_funding(&cfg, &address, count as usize)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Confirmations for a txid (-1 if not yet in a block). For waiting on the fan-out.
#[tauri::command]
async fn nfd_tx_confirmations(txid: String) -> i64 {
    tauri::async_runtime::spawn_blocking(move || {
        match NodeConfig::load() {
            Ok(cfg) => collectibles::tx_confirmations(&cfg, &txid),
            Err(_) => -1,
        }
    })
    .await
    .unwrap_or(-1)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiveCodeDto {
    address: String,
    enc_pubkey: String,
}

/// My receive code (address + encryption pubkey) to share with a sender.
#[tauri::command]
async fn nfd_receive_code(address: String) -> Result<ReceiveCodeDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let c = collectibles::receive_code(&cfg, &address)?;
        Ok(ReceiveCodeDto { address: c.address, enc_pubkey: c.enc_pubkey })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferDto {
    txid: String,
    wrapkey_ptr: String,
}

/// Transfer an NFD you own to a recipient's receive code.
#[tauri::command]
async fn nfd_transfer(
    owner_addr: String,
    mint_txid: String,
    recipient_addr: String,
    recipient_enc_pubkey: String,
) -> Result<TransferDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let t = collectibles::transfer(&cfg, &owner_addr, &mint_txid, &recipient_addr, &recipient_enc_pubkey)?;
        Ok(TransferDto { txid: t.txid, wrapkey_ptr: t.wrapkey_ptr })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Claim (fetch + decrypt) a collectible transferred to you. Returns base64.
#[tauri::command]
async fn nfd_claim(my_addr: String, mint_txid: String, wrapkey_ptr: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let bytes = collectibles::claim(&cfg, &my_addr, &mint_txid, &wrapkey_ptr)?;
        Ok(STANDARD.encode(bytes))
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

// ── Admin: fees / treasury (public config only — no keys) ──────────────────
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeeConfigDto {
    treasury_address: String,
    nfd_mint: f64,
}

/// Read the fee/treasury config (public address + per-action amounts).
#[tauri::command]
async fn nfd_fee_config() -> Result<FeeConfigDto, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let f = dd69_supervisor::fees::FeeConfig::load(&cfg);
        Ok(FeeConfigDto { treasury_address: f.treasury_address, nfd_mint: f.nfd_mint })
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

/// Set the fee/treasury config (superadmin). Stores only the public address +
/// amounts — never any key.
#[tauri::command]
async fn nfd_set_fee_config(treasury_address: String, nfd_mint: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        dd69_supervisor::fees::FeeConfig { treasury_address, nfd_mint }.save(&cfg)
    })
    .await
    .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayStatusDto {
    relay_url: String,
    reachable: bool,
    balance_winc: Option<String>,
}

/// Arweave uploader status: its URL, reachability, and Turbo credit balance.
#[tauri::command]
async fn nfd_relay_status() -> RelayStatusDto {
    tauri::async_runtime::spawn_blocking(|| {
        let url = dd69_supervisor::nfd_storage::relay_url();
        match dd69_supervisor::nfd_storage::relay_balance(&url) {
            Ok(b) => RelayStatusDto { relay_url: url, reachable: true, balance_winc: Some(b) },
            Err(_) => RelayStatusDto { relay_url: url, reachable: false, balance_winc: None },
        }
    })
    .await
    .unwrap_or(RelayStatusDto { relay_url: String::new(), reachable: false, balance_winc: None })
}


// ── Divi Meta Tokens ──────────────────────────────────────────────────────
//
// Every one of these pins `from`: a record's author is the address that funds
// vin[0], so an ordinary coin selection would attribute the record to a change
// address holding no tokens. It would then be mined, cost a fee, and be ignored,
// with nothing said. See crates/supervisor/src/dmt.rs.
//
// Amounts cross this boundary as STRINGS. A token with 8 decimals and a large
// supply exceeds what a JavaScript number holds exactly, and silently rounding
// somebody's balance is not acceptable.

fn parse_units(amount: &str) -> Result<u64, String> {
    amount
        .trim()
        .parse::<u64>()
        .map_err(|_| "That amount is not a whole number of the token's smallest unit.".to_string())
}

#[tauri::command]
async fn token_create(
    from: String,
    premine: String,
    decimals: u8,
    fee: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        dmt::create_token(&cfg, &from, parse_units(&premine)?, decimals, fee.unwrap_or(0.0001))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn token_send(
    from: String,
    token: String,
    amount: String,
    to: String,
    fee: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        dmt::send_tokens(&cfg, &from, &token, parse_units(&amount)?, &to, fee.unwrap_or(0.0001))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn token_airdrop(
    from: String,
    token: String,
    payouts: Vec<(String, String)>,
    fee: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let parsed = payouts
            .iter()
            .map(|(addr, amount)| Ok((addr.clone(), parse_units(amount)?)))
            .collect::<Result<Vec<_>, String>>()?;
        dmt::airdrop(&cfg, &from, &token, &parsed, fee.unwrap_or(0.0001))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn token_burn(
    from: String,
    token: String,
    amount: String,
    fee: Option<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        dmt::burn_tokens(&cfg, &from, &token, parse_units(&amount)?, fee.unwrap_or(0.0001))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn token_lock_supply(from: String, token: String, fee: Option<f64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        dmt::lock_supply(&cfg, &from, &token, fee.unwrap_or(0.0001))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reserve a ticker. Returns the txid and the salt, hex encoded.
///
/// **The caller must keep the salt.** The reveal cannot be built without it and
/// it is not recoverable from the chain: that is what makes the commitment a
/// commitment rather than a public announcement of the name.
#[tauri::command]
async fn token_commit_ticker(
    from: String,
    ticker: String,
    fee: Option<f64>,
) -> Result<(String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let (txid, salt) = dmt::commit_ticker(&cfg, &from, &ticker, fee.unwrap_or(0.0001))?;
        Ok((txid, salt.iter().map(|b| format!("{b:02x}")).collect::<String>()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        // Community apps load from divi-app://<id>/ so each one gets its own
        // origin and its own content policy. See crates/app/src/community.rs for
        // why inline frame content would not work here.
        .register_uri_scheme_protocol(community::SCHEME, community::handle)
        .setup(|app| {
            // Stamp the detailed setup log with this build's version and open a
            // fresh setup-log session (environment, disk, folder) BEFORE bring-up,
            // so ⌘L always has a complete, persistent record for diagnosis.
            dd69_supervisor::setuplog::set_app_version(&app.package_info().version.to_string());
            dd69_supervisor::setuplog::start_session();
            // First-launch bring-up: create the config, download and verify
            // divid69, and start the node — in the background so the window opens
            // immediately and the UI shows sync progress via node_status.
            tauri::async_runtime::spawn_blocking(|| {
                applog::log("startup: app opened — bringing up the node");
                let r = dd69_supervisor::install::first_run_bringup(|stage| {
                    println!("[bringup] {stage}");
                    applog::log(format!("startup: {stage}"));
                });
                match &r {
                    Ok(_) => applog::log("startup: node bring-up finished"),
                    Err(e) => applog::log(format!("startup: node bring-up stopped — {e}")),
                }
            });
            // The App Builder's service, started beside the wallet, in the
            // background so the window need not wait on finding Node.
            tauri::async_runtime::spawn_blocking(builder_service::start);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            node_status,
            setup_info,
            snapshot_source_ip,
            recent_blocks,
            price_history,
            price_latest,
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
            signing_address,
            wallet_sign,
            address_qr,
            open_url,
            poe_timestamp,
            poe_verify,
            hra_quote,
            hra_sync,
            hra_pending,
            hra_my_names,
            hra_commit,
            hra_register,
            hra_forget,
            hra_set_divi_address,
            hra_set_record,
            hra_clear_record,
            hra_transfer,
            hra_set_primary,
            hra_renew,
            hra_resolve,
            hra_reverse,
            hra_market,
            hra_list_for_sale,
            hra_delist,
            hra_buy,
            staking_wallets,
            lottery_info,
            lottery_wins,
            network_peers,
            geolocate_ips,
            self_geo,
            probe_peers,
            ping_nodes,
            mempool_snapshot,
            mempool_conflicts,
            bearer_create,
            bearer_sweep,
            bearer_status,
            escrow_create,
            escrow_status,
            escrow_claim,
            escrow_refund,
            address_balance,
            multisig_list,
            multisig_create,
            multisig_import,
            multisig_inspect,
            multisig_activity,
            multisig_forget,
            multisig_propose,
            multisig_sign,
            multisig_broadcast,
            multisig_my_pubkey,
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
            fast_send,
            tx_status,
            divi_prices,
            ai_set_key,
            ai_clear_key,
            ai_status,
            mm_save_credentials,
            mm_has_credentials,
            mm_clear_credentials,
            mm_test_connection,
            mm_start,
            mm_stop,
            mm_cancel_all,
            dex_pool,
            mm_trade_history,
            mm_place_order,
            mm_cancel_order,
            mm_open_orders,
            mm_status,
            mm_book,
            restart_node,
            node_logs,
            setup_log_report,
            node_identity,
            set_node_name,
            list_nodes,
            set_active_node,
            community::community_builtin_apps,
            community::community_app_base,
            community::community_preview_base,
            builder_service::builder_service_status,
            builder_service::builder_service_restart,
            builder_service::set_gateway_url,
            builder_service::gateway_url,
            nfd_mint,
            nfd_view,
            nfd_receive_code,
            nfd_transfer,
            nfd_claim,
            nfd_fee_config,
            nfd_set_fee_config,
            nfd_relay_status,
            nfd_create_collection,
            nfd_import_open,
            nfd_import_read_item,
            nfd_prepare_funding,
            nfd_tx_confirmations,
            token_create,
            token_send,
            token_airdrop,
            token_burn,
            token_lock_supply,
            token_commit_ticker
        ])
        .build(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9")
        .run(|_app, event| {
            // Stop the App Builder service with the wallet. Leaving a service
            // running after its window has closed is how somebody ends up with
            // three of them and no idea why the port is busy.
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                builder_service::stop();
            }
        });
}
