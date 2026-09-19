//! In-process NFD (Divi Collectibles) chain reader.
//!
//! The wallet must be able to answer "which collectibles do I own" and "what is
//! in this collection" from the chain itself, so that a collectible reappears
//! after a reinstall or on a second device instead of living only in this
//! machine's browser storage. It does that the same way the Names feature does:
//! it drives the shared overlay scanner (`dvxp-scan`, vendored byte-identical
//! from the chain repo) over its OWN node connection, with no server in the
//! loop. Using the shared scanner is deliberate: the wallet and the block
//! explorer then apply the identical rules and cannot diverge.
//!
//! The scanner state is held in memory and rebuilt by scanning from the NFD
//! activation height on each start. At launch that window is tiny; a persisted
//! journal so restarts need not rescan is a documented follow-up (Phase 2b),
//! not a correctness gap.

use std::sync::{Mutex, OnceLock};

use dvxp_scan::parse;
use dvxp_scan::{query, BlockInput, BlockSource, Follower, Overlay, TxPayload};
use serde_json::{json, Value};

use crate::config::NodeConfig;
use crate::rpc::RpcClient;

/// Mainnet is fenced until launch: with no activation height the reader stays
/// idle and reports "not open yet" rather than scanning. Phase 7 sets this to
/// the real launch block. Mirrors the Names feature's mainnet fence.
const MAINNET_ACTIVATION: Option<u64> = None;

/// Blocks applied per advance call. Bounded so the reader never holds the node
/// away from staking for long; callers poll and the view fills in.
const SCAN_BUDGET: u64 = 2_000;

/// How many of an address's collectibles / a collection's members to return.
const QUERY_LIMIT: usize = 1_000;

/// The height this index counts from, by chain. Records below it are not part of
/// the protocol, so this is a definition, not an optimisation.
///
/// * mainnet  -> the launch block once set, else `None` (idle).
/// * testnet/regtest -> `DIVI_NFD_ACTIVATION` if set, else genesis (0). Regtest
///   chains are short, so a full scan from 0 is cheap.
fn activation_height(chain: &str) -> Option<u64> {
    if chain == "main" {
        return MAINNET_ACTIVATION;
    }
    match std::env::var("DIVI_NFD_ACTIVATION").ok().and_then(|s| s.parse::<u64>().ok()) {
        Some(h) => Some(h),
        None => Some(0),
    }
}

fn chain_name(rpc: &RpcClient) -> String {
    rpc.call("getblockchaininfo", json!([]))
        .ok()
        .and_then(|v| v["chain"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "main".to_string())
}

fn is_testnet_like(chain: &str) -> bool {
    chain != "main"
}

// ---------------------------------------------------------------------------
// Block source: the wallet's own node, feeding the shared scanner.
// ---------------------------------------------------------------------------

/// Adapts the wallet's `RpcClient` to the scanner's `BlockSource`. This is the
/// wallet-side twin of the daemon's `rpc::Node`; both feed `Overlay::apply_block`
/// so the two hosts scan by one set of rules.
struct WalletSource<'a> {
    rpc: &'a RpcClient,
}

impl BlockSource for WalletSource<'_> {
    fn tip(&mut self) -> Result<u64, String> {
        self.rpc
            .call("getblockcount", json!([]))?
            .as_u64()
            .ok_or_else(|| "getblockcount: malformed".to_string())
    }

    fn block_hash(&mut self, height: u64) -> Result<String, String> {
        self.rpc
            .call("getblockhash", json!([height]))?
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "getblockhash: malformed".to_string())
    }

    fn block_at(&mut self, height: u64) -> Result<BlockInput, String> {
        let hash_hex = self.block_hash(height)?;
        let block = self.rpc.call("getblock", json!([hash_hex, true]))?;
        let time = block["time"].as_i64().unwrap_or(0);

        let txids: Vec<String> = block["tx"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();

        let mut payloads = Vec::new();
        for (tx_index, txid_s) in txids.iter().enumerate() {
            // A transaction the node will not return is not a reason to invent
            // state; skip it and leave the block short.
            let Ok(tx) = self.rpc.call("getrawtransaction", json!([txid_s, 1])) else {
                continue;
            };
            let vout = tx["vout"].as_array().cloned().unwrap_or_default();

            // Cheap pre-filter: no data output means nothing here concerns the
            // overlay, and resolving a sender costs another round trip.
            let scripts = parse::payloads_in_tx(&vout);
            if scripts.is_empty() {
                continue;
            }

            let sender = self.sender_of(&tx);
            let (payments, burned) = parse::payments_of(&vout);
            let txid = parse::hash_bytes(txid_s);

            for payload in scripts {
                payloads.push(TxPayload {
                    tx_index: tx_index as u32,
                    txid,
                    payload,
                    sender,
                    payments: payments.clone(),
                    burned,
                });
            }
        }

        Ok(BlockInput { height, hash: parse::hash_bytes(&hash_hex), time, payloads })
    }
}

impl WalletSource<'_> {
    /// The address funding `vin[0]`: the deterministic sender rule. Divi has no
    /// SegWit, so the prevout's script carries the address directly.
    fn sender_of(&self, tx: &Value) -> Option<dvxp_core::codec::Address> {
        let vin0 = tx["vin"].as_array()?.first()?;
        let prev_txid = vin0["txid"].as_str()?;
        let n = vin0["vout"].as_u64()? as usize;
        let prev = self.rpc.call("getrawtransaction", json!([prev_txid, 1])).ok()?;
        let a = prev["vout"].as_array()?.get(n)?["scriptPubKey"]["addresses"]
            .as_array()?
            .first()?
            .as_str()?;
        parse::addr_from_str(a)
    }
}

// ---------------------------------------------------------------------------
// In-memory index, one per (chain) connection.
// ---------------------------------------------------------------------------

struct ScanState {
    chain: String,
    overlay: Overlay,
    follower: Follower,
}

fn scan_cell() -> &'static Mutex<Option<ScanState>> {
    static CELL: OnceLock<Mutex<Option<ScanState>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

/// Advance the index for the active node by up to one budget of blocks. Returns
/// a sync-state summary. Safe to call often; callers poll it and the queries
/// below call it before reading.
pub fn advance(cfg: &NodeConfig) -> Result<Value, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);

    let Some(activation) = activation_height(&chain) else {
        // Mainnet before launch: idle by design.
        return Ok(json!({
            "open": false,
            "chain": chain,
            "syncing": false,
            "scannedHeight": 0,
            "tip": 0,
        }));
    };

    let mut guard = scan_cell().lock().map_err(|_| "scan state poisoned".to_string())?;

    // A node/chain switch invalidates the in-memory index; rebuild from scratch.
    let rebuild = match guard.as_ref() {
        Some(st) => st.chain != chain,
        None => true,
    };
    if rebuild {
        *guard = Some(ScanState {
            chain: chain.clone(),
            overlay: Overlay::new(),
            follower: Follower::new(activation),
        });
    }
    let st = guard.as_mut().expect("just set");

    let mut source = WalletSource { rpc: &rpc };

    // Unwind a reorg before applying anything new. A source error here is
    // transient (node busy); a fatal error means the chain moved further than
    // the undo window, so drop the index and let the next call rebuild.
    match st.follower.check_for_reorg(&mut st.overlay, &mut source) {
        Ok(_) => {}
        Err(dvxp_scan::FollowError::Source(e)) => return Err(e),
        Err(dvxp_scan::FollowError::Fatal(_)) => {
            *guard = None;
            return Err("chain reorganised beyond the undo window; resyncing".to_string());
        }
    }

    let st = guard.as_mut().expect("still set");
    let progress = st
        .follower
        .catch_up(&mut st.overlay, &mut source, SCAN_BUDGET)
        .map_err(|e| format!("{e}"))?;

    Ok(json!({
        "open": true,
        "chain": chain,
        "syncing": !progress.caught_up,
        "scannedHeight": progress.height,
        "tip": progress.tip,
    }))
}

/// Sync state only, for a UI poller.
pub fn sync_state(cfg: &NodeConfig) -> Result<Value, String> {
    advance(cfg)
}

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------

/// Everything the given Divi address owns, read from the chain.
pub fn owned(cfg: &NodeConfig, address: &str) -> Result<Value, String> {
    let progress = advance(cfg)?;
    if progress["open"].as_bool() != Some(true) {
        return Ok(json!({ "open": false, "syncing": false, "items": [] }));
    }
    let addr = parse::addr_from_str(address)
        .ok_or_else(|| "that is not a Divi address".to_string())?;
    let key = (addr.kind, addr.hash160);

    let guard = scan_cell().lock().map_err(|_| "scan state poisoned".to_string())?;
    let st = guard.as_ref().ok_or_else(|| "index not ready".to_string())?;
    let testnet = is_testnet_like(&st.chain);

    let items: Vec<Value> = query::nfds_owned_by(&st.overlay, key, QUERY_LIMIT)
        .iter()
        .map(|v| nfd_view_json(v, testnet))
        .collect();

    Ok(json!({
        "open": true,
        "syncing": progress["syncing"].as_bool().unwrap_or(false),
        "scannedHeight": progress["scannedHeight"],
        "tip": progress["tip"],
        "items": items,
    }))
}

/// One collectible by its mint id (display-order hex txid).
pub fn get(cfg: &NodeConfig, id_hex: &str) -> Result<Value, String> {
    let progress = advance(cfg)?;
    if progress["open"].as_bool() != Some(true) {
        return Ok(json!({ "open": false, "syncing": false, "nfd": Value::Null }));
    }
    let id = id_from_hex(id_hex)?;
    let guard = scan_cell().lock().map_err(|_| "scan state poisoned".to_string())?;
    let st = guard.as_ref().ok_or_else(|| "index not ready".to_string())?;
    let testnet = is_testnet_like(&st.chain);
    let nfd = query::nfd(&st.overlay, &id).map(|v| nfd_view_json(&v, testnet));
    Ok(json!({
        "open": true,
        "syncing": progress["syncing"].as_bool().unwrap_or(false),
        "nfd": nfd,
    }))
}

/// A collection and its members by collection id (display-order hex txid).
pub fn collection_members(cfg: &NodeConfig, id_hex: &str) -> Result<Value, String> {
    let progress = advance(cfg)?;
    if progress["open"].as_bool() != Some(true) {
        return Ok(json!({ "open": false, "syncing": false, "collection": Value::Null, "members": [] }));
    }
    let id = id_from_hex(id_hex)?;
    let guard = scan_cell().lock().map_err(|_| "scan state poisoned".to_string())?;
    let st = guard.as_ref().ok_or_else(|| "index not ready".to_string())?;
    let testnet = is_testnet_like(&st.chain);

    let collection = query::collection(&st.overlay, &id).map(|c| {
        json!({
            "id": hex_le(&c.id),
            "creator": base58_of(c.creator, testnet),
            "maxSupply": c.max_supply,
            "minted": c.minted,
            "metaPtr": hex_raw(&c.meta_ptr),
        })
    });
    let members: Vec<Value> = query::collection_members(&st.overlay, &id, QUERY_LIMIT)
        .iter()
        .map(|v| nfd_view_json(v, testnet))
        .collect();

    Ok(json!({
        "open": true,
        "syncing": progress["syncing"].as_bool().unwrap_or(false),
        "collection": collection,
        "members": members,
    }))
}

// ---------------------------------------------------------------------------
// Encoding helpers. Txids/ids are shown in display (reversed) order; Arweave and
// hash pointers are shown as stored (not reversed), matching the read API.
// ---------------------------------------------------------------------------

fn nfd_view_json(v: &query::NfdView, testnet: bool) -> Value {
    json!({
        "id": hex_le(&v.id),
        "owner": base58_of(v.owner, testnet),
        "arweavePtr": hex_raw(&v.arweave_ptr),
        "contentHash": hex_raw(&v.content_hash),
        "thumbPtr": v.thumb_ptr.map(|t| hex_raw(&t)),
        "collectionId": v.collection_id.map(|c| hex_le(&c)),
        "mintHeight": v.mint_height,
    })
}

fn base58_of(owner: (u8, [u8; 20]), testnet: bool) -> String {
    crate::base58::payload_to_address(owner.0, &owner.1, testnet)
}

fn id_from_hex(s: &str) -> Result<[u8; 32], String> {
    let s = s.trim();
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("id must be a 64-character hex string".to_string());
    }
    Ok(parse::hash_bytes(s))
}

/// Display order: reverse the internal bytes, then hex. Used for txids and ids.
fn hex_le(b: &[u8; 32]) -> String {
    b.iter().rev().map(|x| format!("{x:02x}")).collect()
}

/// Stored order: hex as-is. Used for Arweave and content/thumb pointers.
fn hex_raw(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
