// Divi Desktop 6.9 — Tauri shell (~10 MB, uses the OS webview). The Rust
// supervisor does the real work; this exposes its status to the React UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dd69_supervisor::{config::NodeConfig, report, wallet};
use serde::Serialize;

#[derive(Serialize)]
struct BalanceDto {
    spendable: f64,
    staking: f64,
    pending: f64,
    immature: f64,
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

/// Read-only: wallet balances. None if the node/wallet isn't reachable.
#[tauri::command]
fn wallet_balance() -> Option<BalanceDto> {
    let cfg = NodeConfig::load().ok()?;
    wallet::balance(&cfg).map(|b| BalanceDto {
        spendable: b.spendable,
        staking: b.staking,
        pending: b.pending,
        immature: b.immature,
    })
}

/// Reserve and return a fresh receiving address.
#[tauri::command]
fn new_receive_address() -> Result<String, String> {
    let cfg = NodeConfig::load().map_err(|_| "No Divi node is set up yet.".to_string())?;
    wallet::new_address(&cfg)
}

#[tauri::command]
fn recent_activity() -> Vec<TxDto> {
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
}

/// Validate a destination address (used before send). Safe/read-only.
#[tauri::command]
fn validate_address(address: String) -> bool {
    NodeConfig::load()
        .ok()
        .map(|cfg| wallet::is_valid_address(&cfg, &address))
        .unwrap_or(false)
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

/// Read-only status poll — the only call the status line makes. It never
/// starts, stops, or mutates anything; no wallet secrets cross this boundary.
#[tauri::command]
fn node_status() -> NodeStatusDto {
    match NodeConfig::load() {
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
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            node_status,
            wallet_balance,
            new_receive_address,
            recent_activity,
            validate_address,
            address_qr
        ])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
