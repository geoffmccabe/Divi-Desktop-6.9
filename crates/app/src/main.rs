// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use dd69_supervisor::{collectibles, collectibles_import, config::NodeConfig, poe, report, wallet};
use serde::Serialize;
use serde_json::Value;

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
        let d = collectibles::mint(&cfg, &bytes, thumbnail, collection)?;
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
async fn nfd_view(owner_addr: String, arweave_ptr: String, content_hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
        let bytes = collectibles::view(&cfg, &owner_addr, &arweave_ptr, &content_hash)?;
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
            nfd_import_read_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
