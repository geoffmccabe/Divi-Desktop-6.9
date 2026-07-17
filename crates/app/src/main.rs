// Divi Desktop 6.9 — Tauri shell. The Rust supervisor does the real work; this
// exposes its status to the React UI. No wallet secrets cross this boundary.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dd69_supervisor::{config::NodeConfig, report};
use serde::Serialize;

#[derive(Serialize)]
struct NodeStatusDto {
    running: bool,
    phase: String,
    headline: String,
    blocks: Option<i64>,
    peers: Option<i64>,
}

/// The single call the status line polls. Read-only: it never starts, stops,
/// or mutates anything — it only reports.
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
        .invoke_handler(tauri::generate_handler![node_status])
        .run(tauri::generate_context!())
        .expect("error while running Divi Desktop 6.9");
}
