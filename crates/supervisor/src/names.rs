//! **Divi Names** — human readable addresses, wallet side.
//!
//! `GEOFF` instead of a base58 hash, plus an ENS-style record set (EVM address,
//! ENS name, Telegram, avatar and so on) hanging off the same name. A DMT token
//! ticker is simply a short name in the same namespace, so `GEOFF` the person
//! and `GEOFF` the token can never be two different objects owned by two
//! different people.
//!
//! Requires **no fork of any kind**. Records ride in `OP_META` exactly like PoE,
//! NFD and DMT. A node that never upgrades relays, validates and stores every one
//! of these transactions correctly and stays in consensus permanently; it simply
//! cannot resolve names.
//!
//! ## What lives where
//!
//! * Rules and record encoding: the vendored `name-registry` crate, byte
//!   identical to the chain repo, so the wallet cannot drift from an indexer.
//! * Transaction plumbing: [`crate::dvxp`], shared with PoE and everything else.
//! * Address text conversion: [`crate::base58`].
//! * This module: the local index, the pending-commit store, and the flows.
//!
//! ## The honest limits, which the UI must repeat
//!
//! This is an overlay. The chain **carries and orders** the records; software
//! interprets them into a registry. The network does not validate name ownership
//! and no opcode could make it.
//!
//! **Resolution is the highest-stakes thing this wallet does.** A wrong token
//! balance is embarrassing; a wrong address resolution sends somebody's money to
//! a stranger. So the wallet resolves from its OWN index built from its OWN
//! node, never from a remote answer, and callers must show the resolved raw
//! address before spending anything.

use crate::base58;
use crate::config::{dd69_config_dir, NodeConfig};
use crate::dvxp::{self, Payment};
use crate::rpc::RpcClient;
use name_registry::charset;
use name_registry::commit as commitmod;
use name_registry::record::{self, Entry, NameRecord};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Block height at which Divi Names records start being honoured on mainnet.
///
/// `None` until the launch height is chosen. That is deliberate and it is a
/// feature, not an unfinished edge: without it the wallet would either scan
/// millions of blocks that provably contain no name records, or invent an
/// answer. On mainnet the panel reports "not activated yet" instead.
const MAINNET_ACTIVATION: Option<u64> = None;

/// Where registration and renewal fees must be paid.
///
/// `None` until the treasury address is chosen. Registration is BLOCKED while it
/// is unset, because a fee paid to a wrong address is lost silently and the user
/// would have no way to tell. Override for regtest with `DIVI_NAMES_TREASURY`.
const MAINNET_TREASURY: Option<&str> = None;

/// Who holds the reserved names (brands, well-known people, Divi's own).
///
/// Every reserved name is seeded to this address at the activation height, so
/// they are OWNED rather than merely unregistrable. That is the whole point:
/// a name the rules called invalid could never be handed to the person or
/// company it belongs to, whereas an owned one transfers with the ordinary
/// flow. Assigning them is a manual, human decision by whoever holds this
/// address.
///
/// `None` until the address is chosen. The index refuses to run without it,
/// because an unseeded index would treat every reserved name as free and let
/// the first passer-by register BINANCE. Override for regtest with
/// `DIVI_NAMES_RESERVE`.
const MAINNET_RESERVE: Option<&str> = None;

/// Longest no-cancel window a listing may promise. About 30 days.
const MAX_LISTING_LOCK_BLOCKS: u64 = 43_200;

/// Reserved names never expire. The holder should not have to renew several
/// hundred names a year, paying fees to themselves, to keep squatters off them.
const NEVER_EXPIRES: u64 = u64::MAX;

/// The marketplace's cut of a sale, in percent, paid to the treasury.
///
/// **Zero for now, deliberately.** A fee can be introduced later by a version
/// bump with a published activation height; it cannot be taken back out once
/// people have priced it in. Starting at zero also keeps the first market as
/// simple as possible to reason about.
const MARKET_FEE_PERCENT: f64 = 0.0;

/// The treasury's cut of a sale at `price_divi`.
pub fn market_fee_divi(price_divi: f64) -> f64 {
    if MARKET_FEE_PERCENT <= 0.0 {
        0.0
    } else {
        dvxp::round8(price_divi * MARKET_FEE_PERCENT / 100.0)
    }
}

/// Blocks to scan per sync call, so a catch-up never blocks the UI thread pool
/// for long. The caller loops.
///
/// Sized against the real cost: one RPC per block for the raw-block pre-filter,
/// and only blocks that actually look like they carry a record pay for the full
/// per-transaction fetch.
const SCAN_CHUNK: u64 = 500;

// ── Local state ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct Listing {
    pub price_divi: f64,
    pub min_lifetime_blocks: u64,
    pub listed_height: u64,
}

#[derive(Debug, Clone, Default)]
pub struct NameState {
    pub owner: String,
    pub registered_height: u64,
    pub expires_height: u64,
    /// Record key -> value, values held as hex so any key can round-trip.
    pub records: HashMap<u8, String>,
    pub listing: Option<Listing>,
}

#[derive(Debug, Clone, Default)]
struct Index {
    /// Chain the index was built against. A datadir switch must not silently
    /// serve another network's names.
    chain: String,
    scanned_height: u64,
    scanned_hash: String,
    names: HashMap<String, NameState>,
    /// Address -> the name it wants displayed for itself.
    primary: HashMap<String, String>,
    /// commit hash160 (hex) -> (height, sender address)
    commits: HashMap<String, (u64, String)>,
}

/// A commit this wallet made and has not yet revealed. The salt is local and
/// secret until reveal; losing it means losing the commit, so it is written to
/// disk before the transaction is broadcast, never after.
#[derive(Debug, Clone)]
pub struct PendingCommit {
    pub name: String,
    pub txid: String,
    pub commit_height: u64,
    pub blocks_remaining: u64,
    pub ready: bool,
}

/// A name somebody has put up for sale.
#[derive(Debug, Clone)]
pub struct MarketListing {
    pub name: String,
    pub seller: String,
    pub price_divi: f64,
    /// Treasury cut on top of the price, 0 while the market is free.
    pub fee_divi: f64,
    /// Blocks until the seller is allowed to withdraw the listing. While this
    /// is above zero a buyer is safe from the listing being pulled mid-purchase.
    pub locked_for_blocks: u64,
    /// True when this wallet owns it, so the panel offers Delist not Buy.
    pub is_mine: bool,
}

#[derive(Debug, Clone)]
pub struct OwnedName {
    pub name: String,
    pub owner: String,
    /// The Divi address this name points at, already decoded for display.
    ///
    /// Decoded here rather than in the interface: the raw record is 21 bytes and
    /// which network it renders on decides what address it IS, and the interface
    /// has no business guessing that.
    pub divi_address: Option<String>,
    pub registered_height: u64,
    pub expires_height: u64,
    pub records: Vec<(u8, String)>,
    pub is_primary: bool,
    pub listed_price_divi: Option<f64>,
    /// Held on behalf of a brand or a well-known person rather than chosen.
    ///
    /// Whoever holds the reserve owns several hundred of these. Without a way
    /// to tell them apart, the names they actually registered would be buried.
    pub from_reserve: bool,
    /// Never lapses. True for reserve holdings.
    pub perpetual: bool,
}

#[derive(Debug, Clone)]
pub struct SyncStatus {
    pub activated: bool,
    pub activation_height: u64,
    pub scanned_height: u64,
    pub tip: u64,
    pub caught_up: bool,
    pub names_known: u64,
    pub treasury_configured: bool,
    /// False when the node has no full transaction index, which makes names
    /// unreadable. Surfaced rather than silently showing an empty registry.
    pub txindex: bool,
    pub note: String,
}

fn store_path(kind: &str) -> PathBuf {
    dd69_config_dir().join(format!("names-{kind}.json"))
}

/// The index lives in a PER-CHAIN file.
///
/// One shared file would mean switching between regtest and mainnet threw the
/// other network's index away every time and rebuilt it from scratch, which on
/// mainnet is hours of scanning to recover something that was already correct.
/// ⚠ Keyed by BOTH the network and the node.
///
/// Per-network, because one shared file meant switching between regtest and
/// mainnet threw the other network's index away and rebuilt it, which on
/// mainnet is hours of scanning to recover something already correct.
///
/// And per-NODE, because the network name is not unique. Two independent
/// regtest chains are both called "regtest", and My Nodes lets somebody switch
/// between them; one file would have each node silently overwriting the other's
/// history with its own. The node is identified by its data directory.
fn index_path(chain: &str, datadir: &Path) -> PathBuf {
    let safe: String = chain.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let safe = if safe.is_empty() { "unknown".to_string() } else { safe };
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(datadir.as_os_str().as_encoded_bytes());
    let node: String = h.finalize().iter().take(4).map(|b| format!("{b:02x}")).collect();
    dd69_config_dir().join(format!("names-index-{safe}-{node}.json"))
}

fn read_json(path: &PathBuf) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_json(path: &PathBuf, v: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write then rename, so a crash mid-write cannot leave a truncated index or,
    // worse, a truncated salt store.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string(v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ── Chain facts ───────────────────────────────────────────────────────────

fn chain_name(rpc: &RpcClient) -> String {
    rpc.call("getblockchaininfo", json!([]))
        .ok()
        .and_then(|v| v["chain"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "main".into())
}

fn is_testnet_like(chain: &str) -> bool {
    chain != "main"
}

/// The height names become meaningful on this chain. On anything but mainnet the
/// answer is 0: a fresh regtest or testnet has no history to skip.
fn activation_height(chain: &str) -> Option<u64> {
    if is_testnet_like(chain) {
        Some(0)
    } else {
        MAINNET_ACTIVATION
    }
}

/// Where fees go, or a plain refusal.
pub fn treasury_address(chain: &str) -> Result<String, String> {
    if let Ok(v) = std::env::var("DIVI_NAMES_TREASURY") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Ok(v);
        }
    }
    if is_testnet_like(chain) {
        return Err("No test treasury address is set. Set DIVI_NAMES_TREASURY to an address before registering names on this chain.".into());
    }
    MAINNET_TREASURY.map(|s| s.to_string()).ok_or_else(|| {
        "Name registration is not open yet: the Divi treasury address for name fees has not been set in this build. Registering now would send the fee nowhere recoverable, so the wallet refuses.".into()
    })
}

/// Where reserved names are held, or a plain refusal.
pub fn reserve_address(chain: &str) -> Result<String, String> {
    if let Ok(v) = std::env::var("DIVI_NAMES_RESERVE") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Ok(v);
        }
    }
    if is_testnet_like(chain) {
        return Err("No reserve address is set for this chain. Set DIVI_NAMES_RESERVE to an address that will hold the reserved names.".into());
    }
    MAINNET_RESERVE.map(|s| s.to_string()).ok_or_else(|| {
        "Names are not open yet: the address that holds the reserved names has not been set in this build. Without it, brand and celebrity names would be free for anyone to take, so the wallet refuses to read the registry at all.".into()
    })
}

fn tip_height(rpc: &RpcClient) -> Result<u64, String> {
    rpc.call("getblockcount", json!([]))?
        .as_u64()
        .ok_or_else(|| "the node did not report a block height".to_string())
}

// ── Validation and pricing ────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Quote {
    pub canonical: String,
    pub registration_divi: u64,
    pub renewal_divi: u64,
    pub can_be_ticker: bool,
    pub available: Option<bool>,
    pub owner: Option<String>,
}

/// Validate and price a typed name, and say whether it is already taken.
///
/// `available` is `None` when the index cannot answer honestly (not activated,
/// or still catching up). A "probably free" is worse than no answer, because a
/// user acts on it.
pub fn quote(cfg: &NodeConfig, input: &str) -> Result<Quote, String> {
    let q = name_registry::quote(input).map_err(name_registry::explain)?;
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let idx = load_index(cfg, &chain);
    // ⚠ "We have scanned some blocks" is NOT "we know this name is free". A
    // half-read index would report a name registered last week as available,
    // and the user would pay a registration fee for something already taken.
    // Only a fully caught-up index may answer at all.
    let caught_up = activation_height(&chain).is_some()
        && tip_height(&rpc).map(|tip| idx.scanned_height >= tip && tip > 0).unwrap_or(false);
    // A lookalike of a reserved name is refused by the registry, so it must not
    // be offered as available. Reported here as well as enforced there, or the
    // user pays a reservation fee to learn it.
    if name_registry::charset::is_reserved(q.canonical.as_bytes()) {
        return Ok(Quote {
            registration_divi: q.registration_divi,
            renewal_divi: q.renewal_divi,
            can_be_ticker: q.can_be_ticker,
            available: Some(false),
            owner: idx.names.get(&q.canonical).map(|n| n.owner.clone()),
            canonical: q.canonical,
        });
    }
    let existing = idx.names.get(&q.canonical);
    // ⚠ A RELEASED name is available. It is still in the index, so a plain
    // "does a record exist" test calls it taken and no one can ever claim a
    // lapsed name through the wallet, which quietly defeats the entire
    // declining-price release.
    let tip = tip_height(&rpc).unwrap_or(0);
    let claimable = match existing {
        None => true,
        Some(st) => is_released(st, tip),
    };
    // And it costs the release price, not the ordinary one, while the premium
    // is still decaying. Quoting the base price would have the user underpay
    // and lose the fee.
    let price = match existing {
        Some(st) if is_released(st, tip) => released_at(st)
            .and_then(|r| {
                name_registry::fees::release_price_divi(
                    q.canonical.len(),
                    tip.saturating_sub(r),
                )
            })
            .unwrap_or(q.registration_divi),
        _ => q.registration_divi,
    };
    Ok(Quote {
        registration_divi: price,
        renewal_divi: q.renewal_divi,
        can_be_ticker: q.can_be_ticker,
        available: if caught_up { Some(claimable) } else { None },
        owner: existing.filter(|st| !is_released(st, tip)).map(|n| n.owner.clone()),
        canonical: q.canonical,
    })
}

// ── The index ─────────────────────────────────────────────────────────────

fn index_to_json(idx: &Index) -> Value {
    let names: serde_json::Map<String, Value> = idx
        .names
        .iter()
        .map(|(k, v)| {
            let recs: serde_json::Map<String, Value> = v
                .records
                .iter()
                .map(|(key, val)| (format!("{key}"), json!(val)))
                .collect();
            (
                k.clone(),
                json!({
                    "owner": v.owner,
                    "registered": v.registered_height,
                    "expires": v.expires_height,
                    "records": recs,
                    "listing": v.listing.as_ref().map(|l| json!({
                        "price": l.price_divi,
                        "minLifetime": l.min_lifetime_blocks,
                        "listedHeight": l.listed_height,
                    })),
                }),
            )
        })
        .collect();
    let commits: serde_json::Map<String, Value> = idx
        .commits
        .iter()
        .map(|(k, (h, a))| (k.clone(), json!({ "height": h, "sender": a })))
        .collect();
    json!({
        "chain": idx.chain,
        "scannedHeight": idx.scanned_height,
        "scannedHash": idx.scanned_hash,
        "names": names,
        "primary": idx.primary,
        "commits": commits,
    })
}

fn index_from_json(v: &Value) -> Index {
    let mut idx = Index {
        chain: v["chain"].as_str().unwrap_or_default().to_string(),
        scanned_height: v["scannedHeight"].as_u64().unwrap_or(0),
        scanned_hash: v["scannedHash"].as_str().unwrap_or_default().to_string(),
        ..Default::default()
    };
    if let Some(names) = v["names"].as_object() {
        for (name, n) in names {
            let mut st = NameState {
                owner: n["owner"].as_str().unwrap_or_default().to_string(),
                registered_height: n["registered"].as_u64().unwrap_or(0),
                expires_height: n["expires"].as_u64().unwrap_or(0),
                ..Default::default()
            };
            if let Some(recs) = n["records"].as_object() {
                for (k, val) in recs {
                    if let (Ok(key), Some(s)) = (k.parse::<u8>(), val.as_str()) {
                        st.records.insert(key, s.to_string());
                    }
                }
            }
            if n["listing"].is_object() {
                st.listing = Some(Listing {
                    price_divi: n["listing"]["price"].as_f64().unwrap_or(0.0),
                    min_lifetime_blocks: n["listing"]["minLifetime"].as_u64().unwrap_or(0),
                    listed_height: n["listing"]["listedHeight"].as_u64().unwrap_or(0),
                });
            }
            idx.names.insert(name.clone(), st);
        }
    }
    if let Some(p) = v["primary"].as_object() {
        for (addr, name) in p {
            if let Some(s) = name.as_str() {
                idx.primary.insert(addr.clone(), s.to_string());
            }
        }
    }
    if let Some(c) = v["commits"].as_object() {
        for (hash, meta) in c {
            idx.commits.insert(
                hash.clone(),
                (
                    meta["height"].as_u64().unwrap_or(0),
                    meta["sender"].as_str().unwrap_or_default().to_string(),
                ),
            );
        }
    }
    idx
}

/// Put every reserved name into the ledger, owned by the reserve and never
/// expiring.
///
/// Deterministic and identical in every implementation: same list, same owner,
/// same height. That matters because it is the ONLY thing standing between a
/// brand name and whoever registers first, and two indexers disagreeing about
/// it would be two different registries.
fn seed_reserve(idx: &mut Index, reserve: &str, height: u64) {
    for name in name_registry::reserved::all() {
        idx.names.entry(name.to_string()).or_insert_with(|| NameState {
            owner: reserve.to_string(),
            registered_height: height,
            expires_height: NEVER_EXPIRES,
            ..Default::default()
        });
    }
}

fn load_index(cfg: &NodeConfig, chain: &str) -> Index {
    let idx = index_from_json(&read_json(&index_path(chain, &cfg.datadir)));
    // An index built against another network is not stale, it is wrong. Discard.
    if idx.chain != chain {
        return Index { chain: chain.to_string(), ..Default::default() };
    }
    idx
}

fn save_index(cfg: &NodeConfig, idx: &Index) -> Result<(), String> {
    write_json(&index_path(&idx.chain, &cfg.datadir), &index_to_json(idx))
}

/// Does this node have `txindex=1`?
///
/// Without it, `getrawtransaction` cannot read a transaction that is not in the
/// wallet, so records would be silently invisible and the panel would show an
/// empty registry with no explanation. Detected by asking for a transaction we
/// know exists and is not ours: the first one in a recent block.
fn has_txindex(rpc: &RpcClient, chain: &str, tip: u64) -> bool {
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    // The answer cannot change without a node restart, and this runs on every
    // sync tick, so probing each time would spend three RPC calls every few
    // seconds to re-learn a constant.
    if let Ok(c) = cache.lock() {
        if let Some(known) = c.get(chain) {
            return *known;
        }
    }

    // ⚠ Probe an EARLY block, not a recent one. `getrawtransaction` can read a
    // transaction that belongs to this wallet even with no index, and on a
    // regtest or staking node the recent blocks are usually ours, so a recent
    // probe would report an index that is not there and the panel would show an
    // empty registry with no explanation. Block 1 is nobody's on a real chain.
    let probe = |h: u64| -> Option<bool> {
        let hash = rpc.call("getblockhash", json!([h])).ok()?.as_str()?.to_string();
        let block = rpc.call("getblock", json!([hash, true])).ok()?;
        let txid = block["tx"].as_array()?.first()?.as_str()?.to_string();
        Some(rpc.call("getrawtransaction", json!([txid, 1])).is_ok())
    };
    let answer = probe(1.min(tip)).or_else(|| probe(tip)).unwrap_or(false);

    if let Ok(mut c) = cache.lock() {
        c.insert(chain.to_string(), answer);
    }
    answer
}

/// Every DVXP payload in a block, with the address that authored each.
///
/// Divi's `getblock` returns transaction IDs only, never outputs, and its
/// `verbose` argument is a BOOLEAN: passing a verbosity level of 2, as newer
/// Bitcoin allows, makes the node throw. So the outputs have to be fetched one
/// transaction at a time, and [`dvxp::block_may_contain_record`] keeps that off
/// the hot path for the blocks that carry nothing.
fn records_in_block(
    rpc: &RpcClient,
    hash: &str,
) -> Result<Vec<(NameRecord, String, Vec<(String, f64)>)>, String> {
    let raw = rpc.call("getblock", json!([hash, false]))?;
    let Some(raw_hex) = raw.as_str() else {
        return Err("the node did not return the block".into());
    };
    if !dvxp::block_may_contain_record(raw_hex) {
        return Ok(Vec::new());
    }

    let block = rpc.call("getblock", json!([hash, true]))?;
    let mut out = Vec::new();
    let Some(txids) = block["tx"].as_array() else { return Ok(out) };
    for txid in txids.iter().filter_map(|t| t.as_str()) {
        let Ok(tx) = rpc.call("getrawtransaction", json!([txid, 1])) else { continue };
        let payloads = dvxp::payloads_in_tx(&tx);
        if payloads.is_empty() {
            continue;
        }
        // Resolved once per transaction, not once per record: it costs an RPC
        // call, and every record in a transaction has the same author.
        let Some(sender) = record_sender(rpc, &tx) else { continue };
        let payments = paid_to(&tx);
        // ⚠ Only the FIRST record in a transaction counts.
        //
        // Every record in a transaction sees that transaction's payments, so
        // honouring several would let ONE registration fee pay for TWO names.
        // Relay policy allows a single data output per transaction, but relay
        // policy is not consensus: whoever produces a block can include a
        // transaction that breaks it. The rule has to live here.
        for payload in payloads.into_iter().take(1) {
            let Ok(Some(rec)) = record::decode_payload(&payload) else { continue };
            out.push((rec, sender.clone(), payments.clone()));
        }
    }
    Ok(out)
}

/// Every real (spendable) output of a transaction as `(address, amount)`.
///
/// This is what lets the index check that a registration actually paid its fee.
/// Without it, names would be free to anyone who skipped the payment, and the
/// whole anti-squatting model would be decorative.
fn paid_to(tx: &Value) -> Vec<(String, f64)> {
    tx["vout"]
        .as_array()
        .map(|vouts| {
            vouts
                .iter()
                .filter_map(|o| {
                    let amount = o["value"].as_f64()?;
                    let addr = o["scriptPubKey"]["addresses"]
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|a| a.as_str())?;
                    Some((addr.to_string(), amount))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Total paid to one address by a transaction, in whole satoshis.
///
/// Integer, not floating point. Comparing money as doubles with an epsilon is
/// how a correct payment gets refused, or one a satoshi short slips through.
fn total_to(payments: &[(String, f64)], address: &str) -> u64 {
    payments
        .iter()
        .filter(|(a, _)| a == address)
        .map(|(_, v)| dvxp::to_sats(*v))
        .sum()
}

/// The address that funded `vin[0]`, which is the record's author.
///
/// Deterministic and unambiguous: Divi has no SegWit, so the txid-malleability
/// bugs that forced two separate Counterparty fixes cannot occur here. Needs
/// `txindex=1` on the node; without it this returns `None` and the record is
/// skipped rather than attributed to the wrong person.
fn record_sender(rpc: &RpcClient, tx: &Value) -> Option<String> {
    let vin0 = tx["vin"].as_array()?.first()?;
    let prev_txid = vin0["txid"].as_str()?;
    let vout_n = vin0["vout"].as_u64()?;
    let prev = rpc.call("getrawtransaction", json!([prev_txid, 1])).ok()?;
    let out = prev["vout"].as_array()?.iter().find(|o| o["n"].as_u64() == Some(vout_n))?;
    out["scriptPubKey"]["addresses"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|a| a.as_str())
        .map(|s| s.to_string())
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok())
        .collect()
}

/// Has this name lapsed? An expired name resolves to nothing and cannot be
/// edited, sold or transferred. Only its previous owner may renew it, and only
/// during the grace period.
fn is_expired(st: &NameState, height: u64) -> bool {
    st.expires_height != NEVER_EXPIRES && height > st.expires_height
}

/// Past the grace period the name is released and anybody may take it, at a
/// declining price. Returns the height the release began.
fn released_at(st: &NameState) -> Option<u64> {
    if st.expires_height == NEVER_EXPIRES {
        return None;
    }
    Some(st.expires_height.saturating_add(name_registry::fees::GRACE_BLOCKS))
}

fn is_released(st: &NameState, height: u64) -> bool {
    released_at(st).map(|r| height > r).unwrap_or(false)
}

/// Apply one decoded record to the index. Anything that fails a rule is SKIPPED
/// with no state change; nothing here ever destroys a name. That is the
/// deliberate rejection of Runes' "cenotaph" design, where a malformed record
/// burns holdings and an unrecognised field punishes anyone on older software.
fn apply_record(
    idx: &mut Index,
    rec: &NameRecord,
    sender: &str,
    height: u64,
    testnet: bool,
    treasury: &str,
    payments: &[(String, f64)],
) {
    match rec {
        NameRecord::Commit { hash160 } => {
            idx.commits.entry(hex_of(hash160)).or_insert((height, sender.to_string()));
            // ⚠ A commit costs only a transaction fee, so flooding them is
            // cheap and each one would otherwise sit in every wallet's index
            // forever. Dropping the expired ones as we go bounds the state to
            // roughly one expiry window of traffic instead of all history.
            idx.commits.retain(|_, (h, _)| !commitmod::is_expired(*h, height));
        }
        NameRecord::Register { salt, name } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            if charset::validate_name(name).is_err() {
                return;
            }
            // ⚠ Refuse anything that NORMALISES onto a reserved name.
            //
            // The exact reserved strings are already unobtainable because the
            // reserve owns them. Lookalikes are not: `B1NANCE` is a different
            // string, so nothing held it. That hole opened the moment reserved
            // names moved from "refused" to "owned", and it is invisible to the
            // unit tests, which check `is_reserved` directly rather than through
            // the registration path.
            //
            // Nobody may have these, not even the reserve: `B1NANCE` is not a
            // name anyone wants, it is a spoof of one.
            if name_registry::charset::is_reserved(name) {
                return;
            }
            // A live name cannot be taken. A RELEASED one can, which is the
            // Namecoin lesson applied: names lapse so the namespace does not
            // silently fill up with abandoned registrations forever.
            let takeover = match idx.names.get(&name_s) {
                None => false,
                Some(st) if is_released(st, height) => true,
                Some(_) => return,
            };
            let Ok(salt_arr) = <[u8; commitmod::SALT_LEN]>::try_from(salt.as_slice()) else {
                return;
            };
            let want = hex_of(&commitmod::commit_hash(&salt_arr, name));
            let Some((commit_height, commit_sender)) = idx.commits.get(&want).cloned() else {
                return; // no matching commit
            };
            // Same author, and buried deep enough that a front-runner who only
            // learned the name at reveal time cannot have a mature commit.
            if commit_sender != sender {
                return;
            }
            if !commitmod::window_is_open(commit_height, height) {
                return; // too shallow, or the commit has expired
            }
            // The fee is a rule, not a courtesy. A registration that underpays,
            // or pays somewhere other than the treasury, is not a registration.
            // Without this check names are free and the length-tiered pricing
            // that keeps squatters out is decoration.
            // A just-released name costs a premium that decays to the ordinary
            // price. That converts a land-grab at one block, which whoever
            // automates fastest always wins, into an auction anyone can join.
            let price = if takeover {
                let since = idx
                    .names
                    .get(&name_s)
                    .and_then(released_at)
                    .map(|r| height.saturating_sub(r))
                    .unwrap_or(0);
                name_registry::fees::release_price_divi(name.len(), since)
            } else {
                name_registry::fees::registration_divi(name.len())
            };
            let Some(price) = price else { return };
            if total_to(payments, treasury) < price.saturating_mul(100_000_000) {
                return;
            }
            idx.commits.remove(&want); // a commit is spent once
            // A takeover starts clean: the previous holder's records and
            // listing must not carry over to somebody else's name.
            idx.primary.retain(|_, claimed| claimed != &name_s);
            idx.names.insert(
                name_s,
                NameState {
                    owner: sender.to_string(),
                    registered_height: height,
                    expires_height: height.saturating_add(name_registry::fees::TERM_BLOCKS),
                    ..Default::default()
                },
            );
        }
        NameRecord::Transfer { name, new_owner } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender || is_expired(st, height) {
                return;
            }
            // Any reverse claim naming this name is now stale: the forward
            // record still points at the old owner's address, and leaving the
            // entry would keep displaying the name for somebody who no longer
            // owns it.
            idx.primary.retain(|_, claimed| claimed != &name_s);
            st.owner = base58::payload_to_address(new_owner.kind, &new_owner.hash160, testnet);
            st.listing = None;
        }
        NameRecord::SetRecord { name, entries } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender || is_expired(st, height) {
                return;
            }
            for e in entries {
                st.records.insert(e.key, hex_of(&e.value));
            }
        }
        NameRecord::ClearRecord { name, keys } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender || is_expired(st, height) {
                return;
            }
            for k in keys {
                st.records.remove(k);
            }
        }
        NameRecord::SetPrimary { name } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            // ⚠ Reverse resolution needs BOTH sides to agree. The name's forward
            // Divi-address record must already point back at this sender, or
            // anyone could make their own address display as somebody else's
            // identity just by claiming it.
            let Some(st) = idx.names.get(&name_s) else { return };
            if is_expired(st, height) {
                return;
            }
            let forward_ok = st
                .records
                .get(&record::KEY_DIVI_ADDRESS)
                .and_then(|h| unhex(h))
                .filter(|b| b.len() == 21)
                .map(|b| {
                    let mut h160 = [0u8; 20];
                    h160.copy_from_slice(&b[1..21]);
                    base58::payload_to_address(b[0], &h160, testnet) == sender
                })
                .unwrap_or(false);
            if !forward_ok {
                return;
            }
            idx.primary.insert(sender.to_string(), name_s);
        }
        NameRecord::Renew { name } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(price) = name_registry::fees::renewal_divi(name.len()) else { return };
            if total_to(payments, treasury) < price.saturating_mul(100_000_000) {
                return; // an unpaid renewal is not a renewal
            }
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender {
                return;
            }
            // NOTE: deliberately no is_expired check here. Renewing AFTER
            // lapsing is precisely what the grace period exists for; guarding
            // this would mean a missed reminder loses the name outright.
            //
            // But once the name is RELEASED the grace is over and it is fair
            // game, so a late renewal must not quietly reclaim it. A reserved
            // name has no term to extend either.
            if is_released(st, height) || st.expires_height == NEVER_EXPIRES {
                return;
            }
            // Renewal extends from whichever is later: the current expiry, or
            // now. Renewing early must not lose the unused remainder, and
            // renewing during grace must not backdate.
            let base = st.expires_height.max(height);
            st.expires_height = base.saturating_add(name_registry::fees::TERM_BLOCKS);
        }
        NameRecord::List { name, price, min_lifetime_blocks } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender || is_expired(st, height) {
                return;
            }
            // ⚠ A no-cancel window is a promise the SELLER makes, and an
            // absurd one is not a promise but a trap. u64::MAX would also
            // overflow every `listed_height + window` in the code. Refusing it
            // here keeps nonsense out of state entirely rather than relying on
            // every later arithmetic site to survive it.
            //
            // Capped at 30 days: long enough for any real sale, and short
            // enough that the window always ends well inside the name's own
            // term. A window that outlives the name it locks would be
            // meaningless.
            if *min_lifetime_blocks > MAX_LISTING_LOCK_BLOCKS {
                return;
            }
            st.listing = Some(Listing {
                price_divi: *price as f64 / 1e8,
                min_lifetime_blocks: *min_lifetime_blocks,
                listed_height: height,
            });
        }
        NameRecord::Delist { name } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get_mut(&name_s) else { return };
            if st.owner != sender || is_expired(st, height) {
                return;
            }
            // A listing cannot be withdrawn inside its committed window. That
            // window is the whole reason a buyer can pay safely: it is what
            // stops the Counterparty dispenser attack, where a seller cancels
            // and keeps both the payment and the asset.
            if let Some(l) = &st.listing {
                if height < l.listed_height.saturating_add(l.min_lifetime_blocks) {
                    return;
                }
            }
            st.listing = None;
        }
        NameRecord::Buy { name } => {
            let Ok(name_s) = String::from_utf8(name.clone()) else { return };
            let Some(st) = idx.names.get(&name_s) else { return };
            if is_expired(st, height) {
                return; // an expired name is not somebody's to sell
            }
            let Some(listing) = st.listing.clone() else { return }; // not for sale
            let seller = st.owner.clone();

            // Buying from yourself is not a sale. Allowing it would let an owner
            // manufacture a fake sale price to mislead anyone pricing the market.
            if sender == seller {
                return;
            }

            // The seller must actually be paid, in this same transaction. This
            // is what makes the purchase atomic: the seller is not a
            // participant, so there is nothing for them to withhold.
            if total_to(payments, &seller) < dvxp::to_sats(listing.price_divi) {
                return;
            }

            // The marketplace cut, if one is configured. At 0% this is free.
            let cut = dvxp::to_sats(market_fee_divi(listing.price_divi));
            if cut > 0 && total_to(payments, treasury) < cut {
                return;
            }

            // Ownership moves. Any reverse claim naming it is stale, and the
            // listing is spent: a second buyer in the same block finds nothing
            // for sale and is ignored, which is what makes first-in-block win.
            idx.primary.retain(|_, claimed| claimed != &name_s);
            if let Some(st) = idx.names.get_mut(&name_s) {
                st.owner = sender.to_string();
                st.listing = None;
            }
        }
    }
}

/// Scan up to [`SCAN_CHUNK`] more blocks into the local index.
pub fn sync(cfg: &NodeConfig) -> Result<SyncStatus, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let testnet = is_testnet_like(&chain);
    let tip = tip_height(&rpc)?;
    let treasury_configured = treasury_address(&chain).is_ok();

    let Some(activation) = activation_height(&chain) else {
        return Ok(SyncStatus {
            activated: false,
            activation_height: 0,
            scanned_height: 0,
            tip,
            caught_up: false,
            names_known: 0,
            treasury_configured,
            txindex: true,
            note: "Divi Names has no launch block on the main network yet, so there is nothing to read. You can still see how the panel works, and everything is testable on regtest today.".into(),
        });
    };

    // ⚠ Fee validation is part of the registry's rules, not a nicety: a
    // registration that underpays or pays the wrong place is not a valid
    // registration. An index that cannot check that is not this registry, it is
    // a different and more permissive one. So refuse to build it at all rather
    // than quietly serve a registry where names were free.
    let treasury = match treasury_address(&chain) {
        Ok(t) => t,
        Err(e) => {
            return Ok(SyncStatus {
                activated: true,
                activation_height: activation,
                scanned_height: 0,
                tip,
                caught_up: false,
                names_known: 0,
                treasury_configured: false,
                txindex: true,
                note: e,
            })
        }
    };

    let reserve = match reserve_address(&chain) {
        Ok(r) => r,
        Err(e) => {
            return Ok(SyncStatus {
                activated: true,
                activation_height: activation,
                scanned_height: 0,
                tip,
                caught_up: false,
                names_known: 0,
                treasury_configured,
                txindex: true,
                note: e,
            })
        }
    };

    if !has_txindex(&rpc, &chain, tip) {
        return Ok(SyncStatus {
            activated: true,
            activation_height: activation,
            scanned_height: 0,
            tip,
            caught_up: false,
            names_known: 0,
            treasury_configured,
            txindex: false,
            note: "This node is not keeping a full transaction index, so names cannot be read from the chain. Add txindex=1 to divi.conf and restart the node. It will re-read the blockchain once, which takes a few hours, and you can keep using the rest of the wallet meanwhile.".into(),
        });
    }

    let mut idx = load_index(cfg, &chain);
    if idx.scanned_height < activation {
        idx.scanned_height = activation.saturating_sub(1);
    }
    // Idempotent: seeding only fills names that are not already there, so a
    // reserved name later handed to somebody keeps its new owner.
    seed_reserve(&mut idx, &reserve, activation);

    // Reorg check: if the block we last scanned is no longer on the chain, the
    // index describes a history that did not happen. We keep no undo data, so
    // the honest repair is to rebuild. Cheap while the registry is young, and
    // correct at any age. Incremental undo is the follow-up, not a shortcut.
    //
    // ⚠ A FAILED call is not a reorg. Treating "the node did not answer" as
    // "the chain changed" would throw the whole index away every time the node
    // hiccuped. Only an answer that disagrees counts.
    if !idx.scanned_hash.is_empty() {
        match rpc.call("getblockhash", json!([idx.scanned_height])) {
            Ok(v) => {
                if v.as_str() != Some(idx.scanned_hash.as_str()) {
                    idx = Index {
                        chain: chain.clone(),
                        scanned_height: activation.saturating_sub(1),
                        ..Default::default()
                    };
                    seed_reserve(&mut idx, &reserve, activation);
                }
            }
            Err(e) => return Err(e),
        }
    }

    let stop = tip.min(idx.scanned_height + SCAN_CHUNK);
    let mut h = idx.scanned_height + 1;
    while h <= stop {
        let hash = rpc
            .call("getblockhash", json!([h]))?
            .as_str()
            .ok_or("the node did not return a block hash")?
            .to_string();
        for (rec, sender, paid) in records_in_block(&rpc, &hash)? {
            apply_record(&mut idx, &rec, &sender, h, testnet, &treasury, &paid);
        }
        idx.scanned_height = h;
        idx.scanned_hash = hash;
        h += 1;
    }
    idx.chain = chain.clone();
    save_index(cfg, &idx)?;

    let caught_up = idx.scanned_height >= tip;
    Ok(SyncStatus {
        activated: true,
        activation_height: activation,
        scanned_height: idx.scanned_height,
        tip,
        caught_up,
        names_known: idx.names.len() as u64,
        treasury_configured,
        txindex: true,
        note: if caught_up {
            String::new()
        } else {
            format!("Reading the chain for names: {} of {tip} blocks.", idx.scanned_height)
        },
    })
}

// ── Resolution ────────────────────────────────────────────────────────────

/// The Divi address a name points at, from THIS wallet's own index.
///
/// Deliberately never asks a remote service. A wrong answer here sends money to
/// a stranger, so the wallet trusts only its own node.
pub fn resolve(cfg: &NodeConfig, name: &str) -> Result<Option<String>, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let canonical = charset::canonicalise(name);
    let idx = load_index(cfg, &chain);

    // ⚠ A stale index is the dangerous case, not the ignorant one. If the owner
    // repointed the name yesterday and we have not read yesterday's blocks, we
    // would hand back the PREVIOUS address with total confidence and the money
    // would go to the wrong person. Refuse instead. "I do not know yet" is
    // always recoverable; a confident wrong address is not.
    let tip = tip_height(&rpc)?;
    if tip == 0 || idx.scanned_height < tip {
        return Err(format!(
            "Still reading the chain ({} of {} blocks), so this name cannot be looked up safely yet. An out-of-date answer could send money to the wrong person.",
            idx.scanned_height, tip
        ));
    }
    let Some(st) = idx.names.get(&canonical) else { return Ok(None) };
    // ⚠ An expired name must resolve to NOTHING. Left resolving, it would keep
    // pointing at whoever used to own it, and a payment meant for the current
    // holder would land with the previous one.
    if is_expired(st, tip) {
        return Ok(None);
    }
    let Some(hex) = st.records.get(&record::KEY_DIVI_ADDRESS) else { return Ok(None) };
    let Some(bytes) = unhex(hex) else { return Ok(None) };
    if bytes.len() != 21 {
        return Ok(None);
    }
    let mut h160 = [0u8; 20];
    h160.copy_from_slice(&bytes[1..21]);
    Ok(Some(base58::payload_to_address(bytes[0], &h160, is_testnet_like(&chain))))
}

/// The name an address wants shown for itself, if the two sides agree.
pub fn reverse(cfg: &NodeConfig, address: &str) -> Result<Option<String>, String> {
    let addr = address.trim();
    let Some(name) = ({
        let rpc = RpcClient::new(cfg);
        let idx = load_index(cfg, &chain_name(&rpc));
        idx.primary.get(addr).cloned()
    }) else {
        return Ok(None);
    };
    // Re-check the forward record rather than trusting the stored claim. Both
    // directions must still agree at the moment of asking, or an address whose
    // name moved on would keep displaying somebody else's identity.
    //
    // Unlike `resolve`, a stale index here is downgraded to "no name" rather
    // than an error. This answer only decorates an address that is already on
    // screen, so showing nothing costs the user nothing, whereas failing loudly
    // every few seconds during a catch-up would just be noise.
    match resolve(cfg, &name) {
        Ok(Some(points_at)) if points_at == addr => Ok(Some(name)),
        _ => Ok(None),
    }
}

/// Names this wallet owns.
pub fn my_names(cfg: &NodeConfig) -> Result<Vec<OwnedName>, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let idx = load_index(cfg, &chain);
    let mine: Vec<String> = rpc
        .call("listunspent", json!([0]))
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| a.iter().filter_map(|c| c["address"].as_str().map(String::from)).collect())
        .unwrap_or_default();

    // ⚠ Ask about each distinct ADDRESS once, not about each name.
    //
    // The reserve holds several hundred names under a SINGLE address. Asking
    // per name meant hundreds of `validateaddress` calls on every refresh of a
    // panel that polls every few seconds, which would make the wallet crawl for
    // the one person who matters most here: whoever holds the reserve.
    let mut verdicts: HashMap<&str, bool> = HashMap::new();
    for st in idx.names.values() {
        if verdicts.contains_key(st.owner.as_str()) {
            continue;
        }
        let ours = mine.iter().any(|m| m == &st.owner)
            || rpc
                .call("validateaddress", json!([&st.owner]))
                .ok()
                .and_then(|r| r["ismine"].as_bool())
                .unwrap_or(false);
        verdicts.insert(st.owner.as_str(), ours);
    }

    let mut out: Vec<OwnedName> = idx
        .names
        .iter()
        .filter(|(_, st)| verdicts.get(st.owner.as_str()).copied().unwrap_or(false))
        .map(|(name, st)| OwnedName {
            name: name.clone(),
            owner: st.owner.clone(),
            divi_address: st
                .records
                .get(&record::KEY_DIVI_ADDRESS)
                .and_then(|h| unhex(h))
                .filter(|b| b.len() == 21)
                .map(|b| {
                    let mut h160 = [0u8; 20];
                    h160.copy_from_slice(&b[1..21]);
                    base58::payload_to_address(b[0], &h160, is_testnet_like(&chain))
                }),
            registered_height: st.registered_height,
            expires_height: st.expires_height,
            records: {
                let mut r: Vec<(u8, String)> = st.records.iter().map(|(k, v)| (*k, v.clone())).collect();
                r.sort_by_key(|(k, _)| *k);
                r
            },
            is_primary: idx.primary.get(&st.owner) == Some(name),
            listed_price_divi: st.listing.as_ref().map(|l| l.price_divi),
            perpetual: st.expires_height == NEVER_EXPIRES,
            from_reserve: st.expires_height == NEVER_EXPIRES
                && name_registry::charset::is_reserved(name.as_bytes()),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Every name currently for sale.
pub fn market(cfg: &NodeConfig) -> Result<Vec<MarketListing>, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let idx = load_index(cfg, &chain);
    let tip = tip_height(&rpc)?;

    let mut out: Vec<MarketListing> = idx
        .names
        .iter()
        .filter_map(|(name, st)| {
            let l = st.listing.as_ref()?;
            let unlock = l.listed_height.saturating_add(l.min_lifetime_blocks);
            Some(MarketListing {
                name: name.clone(),
                seller: st.owner.clone(),
                price_divi: l.price_divi,
                fee_divi: market_fee_divi(l.price_divi),
                locked_for_blocks: unlock.saturating_sub(tip),
                is_mine: is_ours(&rpc, &st.owner),
            })
        })
        .collect();
    out.sort_by(|a, b| a.price_divi.partial_cmp(&b.price_divi).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

fn is_ours(rpc: &RpcClient, addr: &str) -> bool {
    rpc.call("validateaddress", json!([addr]))
        .ok()
        .and_then(|r| r["ismine"].as_bool())
        .unwrap_or(false)
}

/// Put a name up for sale.
///
/// `min_lifetime_blocks` is the promise that makes buying safe: for that many
/// blocks the listing cannot be withdrawn. Without it a seller could cancel the
/// moment a payment appeared and keep both the name and the money, which is
/// exactly the hole in Counterparty's dispensers.
pub fn list_for_sale(
    cfg: &NodeConfig,
    name: &str,
    price_divi: f64,
    min_lifetime_blocks: u64,
) -> Result<String, String> {
    if !price_divi.is_finite() || price_divi <= 0.0 {
        return Err("Set a price above zero.".into());
    }
    if price_divi > 1_000_000_000.0 {
        return Err("That price is not plausible. Check the number.".into());
    }
    if min_lifetime_blocks < 60 {
        return Err("The no-cancel window must be at least 60 blocks, about an hour. It is what lets somebody buy safely, so it cannot be trivially short.".into());
    }
    // Refuse here too, or the wallet reports a listing sent and the registry
    // silently ignores it.
    if min_lifetime_blocks > MAX_LISTING_LOCK_BLOCKS {
        return Err("The no-cancel window cannot be longer than about 30 days. A promise that outlives the name it locks is not a promise.".into());
    }
    let canonical = charset::canonicalise(name);
    let owner = owner_of(cfg, &canonical)?;
    let price = (price_divi * 1e8).round() as u64;
    Ok(send_record(
        cfg,
        &NameRecord::List { name: canonical.into_bytes(), price, min_lifetime_blocks },
        &[],
        Some(&owner),
    )?
    .txid)
}

/// Take a name off the market. Refused by the registry inside the no-cancel
/// window, so this checks first and says so rather than wasting a fee.
pub fn delist(cfg: &NodeConfig, name: &str) -> Result<String, String> {
    let canonical = charset::canonicalise(name);
    let owner = owner_of(cfg, &canonical)?;
    let rpc = RpcClient::new(cfg);
    let idx = load_index(cfg, &chain_name(&rpc));
    let tip = tip_height(&rpc)?;
    let Some(st) = idx.names.get(&canonical) else {
        return Err(format!("{canonical} is not in the index yet."));
    };
    let Some(l) = &st.listing else {
        return Err(format!("{canonical} is not for sale."));
    };
    let unlock = l.listed_height.saturating_add(l.min_lifetime_blocks);
    if tip < unlock {
        return Err(format!(
            "You promised not to withdraw this listing for another {} blocks, roughly {} minutes. That promise is what lets somebody buy it safely.",
            unlock - tip,
            unlock - tip
        ));
    }
    Ok(send_record(
        cfg,
        &NameRecord::Delist { name: canonical.into_bytes() },
        &[],
        Some(&owner),
    )?
    .txid)
}

/// Is somebody else already trying to buy this name right now?
///
/// ⚠ The one risk this market cannot engineer away: two buyers paying in the
/// same block. One gets the name; the other has paid the seller and gets
/// nothing, and an overlay cannot claw back a native coin payment. This narrows
/// the window from a block to the moment of broadcast. It is a real reduction,
/// not a fix, and the UI must not pretend otherwise.
fn competing_purchase(rpc: &RpcClient, canonical: &str) -> bool {
    /// Anyone can fill the mempool cheaply, and this runs while a user waits on
    /// a button. Bounded so a flooded mempool degrades the check rather than
    /// hanging the wallet. Falling back to "no competitor seen" is the same
    /// answer we would give if the check were absent, so the bound never makes
    /// things worse than not checking.
    const MAX_SCAN: usize = 400;

    let Ok(pool) = rpc.call("getrawmempool", json!([])) else { return false };
    let Some(txids) = pool.as_array() else { return false };
    for txid in txids.iter().take(MAX_SCAN).filter_map(|t| t.as_str()) {
        let Ok(tx) = rpc.call("getrawtransaction", json!([txid, 1])) else { continue };
        for payload in dvxp::payloads_in_tx(&tx) {
            if let Ok(Some(NameRecord::Buy { name })) = record::decode_payload(&payload) {
                if String::from_utf8(name).ok().as_deref() == Some(canonical) {
                    return true;
                }
            }
        }
    }
    false
}

/// Buy a listed name: one transaction that pays the seller and claims it.
pub fn buy(cfg: &NodeConfig, name: &str) -> Result<String, String> {
    let canonical = charset::canonicalise(name);
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let idx = load_index(cfg, &chain);
    let tip = tip_height(&rpc)?;
    if idx.scanned_height < tip {
        return Err("Still reading the chain, so the price and the seller cannot be trusted yet. Wait for it to catch up.".into());
    }
    let Some(st) = idx.names.get(&canonical) else {
        return Err(format!("{canonical} is not registered."));
    };
    let Some(listing) = st.listing.clone() else {
        return Err(format!("{canonical} is not for sale."));
    };
    if is_ours(&rpc, &st.owner) {
        return Err("You already own this name.".into());
    }
    if competing_purchase(&rpc, &canonical) {
        return Err("Somebody else is buying this name at this moment. If you both pay, only one of you gets it and the other loses the payment, so this was stopped. Try again shortly.".into());
    }

    // ⚠ Re-read the tip immediately before building the payment. Between the
    // checks above and the broadcast, a block can arrive that sells or transfers
    // this name, and we would then pay the PREVIOUS owner for something they no
    // longer have. Narrow, but it is somebody's money.
    if tip_height(&rpc)? != tip {
        return Err("A new block arrived while this was being prepared, so the price and owner were re-checked and the purchase was stopped. Try again.".into());
    }

    let mut payments = vec![Payment { address: st.owner.clone(), divi: listing.price_divi }];
    let cut = market_fee_divi(listing.price_divi);
    if cut > 0.0 {
        payments.push(Payment { address: treasury_address(&chain)?, divi: cut });
    }
    Ok(send_record(cfg, &NameRecord::Buy { name: canonical.into_bytes() }, &payments, None)?.txid)
}

// ── Writing records ───────────────────────────────────────────────────────

/// Broadcast a record, authored by `from`.
///
/// ⚠ `from` is not optional in spirit. Every rule in this registry identifies a
/// record's author as the address funding `vin[0]`: a reveal must come from the
/// same address as its commit, and an edit must come from the name's owner.
/// Letting the wallet pick coins freely produces a transaction that confirms,
/// spends a fee, and is then correctly ignored by every indexer. That is a
/// silent no-op, and it is the failure a live chain caught that no unit test
/// could.
fn send_record(
    cfg: &NodeConfig,
    rec: &NameRecord,
    payments: &[Payment],
    from: Option<&str>,
) -> Result<dvxp::Sent, String> {
    let payload = record::encode_payload(rec).map_err(|e| format!("could not build the record: {e:?}"))?;
    let rpc = RpcClient::new(cfg);
    if let Some(addr) = from {
        ensure_can_author(&rpc, addr)?;
    }
    dvxp::broadcast_record(&rpc, &payload, payments, dvxp::MIN_FEE_DIVI, from)
}

/// Small top-up so an address can still author a record.
const AUTHOR_TOPUP_DIVI: f64 = 1.0;

/// Make sure `addr` has something to spend, topping it up if not.
///
/// ⚠ This exists because **Divi stakes**. A record must be authored by a
/// specific address, but between a commit and its reveal twelve blocks later
/// the wallet's own staking can consume the coin sitting at that address, and
/// the coinstake does not necessarily return it there. The address is then
/// empty and the reveal is impossible: the user loses the reservation and its
/// fee through no fault of their own.
///
/// This was not theoretical. On a live two-node regtest the author address
/// received its change correctly and was drained by staking before the reveal,
/// which is exactly what would happen to the many Divi users who stake.
///
/// `lockunspent` is NOT the answer: Divi's lock set is held in memory only and
/// is cleared by any restart, so it cannot protect a coin across a wait
/// measured in blocks. Topping up on demand is robust because it does not need
/// anything to survive.
fn ensure_can_author(rpc: &RpcClient, addr: &str) -> Result<(), String> {
    let has_coin = rpc
        .call("listunspent", json!([0]))
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|coins| {
            coins.iter().any(|c| {
                c["address"].as_str() == Some(addr)
                    && c["amount"].as_f64().unwrap_or(0.0) > 0.0
                    && c["spendable"].as_bool().unwrap_or(true)
            })
        })
        .unwrap_or(false);
    if has_coin {
        return Ok(());
    }

    // Only ever top up an address this wallet controls. Sending to a stranger
    // because their name needed authorising would be absurd.
    let ours = rpc
        .call("validateaddress", json!([addr]))
        .ok()
        .and_then(|r| r["ismine"].as_bool())
        .unwrap_or(false);
    if !ours {
        return Err(format!(
            "{addr} has to authorise this, and this wallet does not hold that address."
        ));
    }

    rpc.call("sendtoaddress", json!([addr, AUTHOR_TOPUP_DIVI]))
        .map_err(|e| format!("Could not put a small amount of DIVI back into {addr}, which has to authorise this: {e}"))?;
    Ok(())
}

/// Refuse early, and in plain words, when this wallet cannot sign as `addr`.
///
/// Without this the failure surfaces from the coin selector as "that address has
/// no DIVI to spend", which is technically true and completely misleading when
/// the real answer is "that is not your address".
fn require_ours(cfg: &NodeConfig, addr: &str, what: &str) -> Result<(), String> {
    let rpc = RpcClient::new(cfg);
    let ours = rpc
        .call("validateaddress", json!([addr]))
        .ok()
        .and_then(|r| r["ismine"].as_bool())
        .unwrap_or(false);
    if ours {
        Ok(())
    } else {
        Err(format!("{what} has to be signed by {addr}, and this wallet does not hold that address."))
    }
}

/// The address that owns `name`, from the local index.
///
/// Every edit has to be authored by this address or the indexer ignores it, so
/// resolving it first is not an optimisation, it is the difference between the
/// edit happening and silently not happening.
fn owner_of(cfg: &NodeConfig, canonical: &str) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let idx = load_index(cfg, &chain_name(&rpc));
    let owner = idx
        .names
        .get(canonical)
        .map(|n| n.owner.clone())
        .ok_or_else(|| format!("{canonical} is not registered, or the wallet has not read it from the chain yet."))?;
    require_ours(cfg, &owner, &format!("Changing {canonical}"))?;
    Ok(owner)
}

/// Step 1 of registration: publish `Hash160(salt ‖ name)` and remember the salt.
///
/// The 12-block wait that follows is the point, not an inconvenience: it turns a
/// mempool race, which an attacker wins by paying a higher fee, into a 12-block
/// reorg, which they cannot win. On Divi's 60-second blocks that is about 12
/// minutes, against 2 hours on Bitcoin.
pub fn commit(cfg: &NodeConfig, input: &str) -> Result<String, String> {
    let q = name_registry::quote(input).map_err(name_registry::explain)?;
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    // Refuse early if the fee has nowhere to go, so the user does not spend a
    // commit and then discover they cannot reveal.
    treasury_address(&chain)?;

    let salt = random_salt()?;
    let hash = commitmod::commit_hash(&salt, q.canonical.as_bytes());
    let height = tip_height(&rpc)?;

    // Persist BEFORE broadcasting. If we crash between the two, we have a
    // useless salt on disk, which costs nothing. The other order loses the
    // commit's fee and the name.
    let mut store = read_json(&store_path("pending"));

    // Refuse before spending a reservation fee on something the registry will
    // never honour. Covers lookalikes as well as the exact names.
    if name_registry::charset::is_reserved(q.canonical.as_bytes()) {
        return Err(format!(
            "{} is reserved, or is a lookalike of a reserved name. Well-known brands and people are held so nobody can impersonate them.",
            q.canonical
        ));
    }

    // Already registered is a different situation from already reserved, and
    // saying "you have a reservation" for a name somebody owns is just wrong.
    {
        let idx = load_index(cfg, &chain);
        if let Some(st) = idx.names.get(&q.canonical) {
            return Err(format!(
                "{} is already registered, to {}. Pick a different name.",
                q.canonical, st.owner
            ));
        }
    }

    // ⚠ Never overwrite an existing reservation. The salt is the only thing
    // that can unlock a commit already paid for and sitting on the chain;
    // replacing it would silently strand that commit and its fee. The panel
    // guards this too, but the guard belongs where the data is.
    let existing = &store[&q.canonical];
    if !existing.is_null() && existing["chain"].as_str() == Some(chain.as_str()) {
        return Err(format!(
            "You already have a reservation for {}. Register it when the wait is up, or discard it first if you want to start again.",
            q.canonical
        ));
    }
    let entry = json!({
        "salt": hex_of(&salt),
        "chain": chain,
        "height": height,
        "txid": Value::Null,
    });
    store[&q.canonical] = entry;
    write_json(&store_path("pending"), &store)?;

    // Choose the author deliberately, before broadcasting: the reveal twelve
    // blocks later must come from this same address, so it needs to be one that
    // will still have coins then.
    let author = dvxp::best_author_address(&rpc)?;
    let sent = send_record(cfg, &NameRecord::Commit { hash160: hash }, &[], Some(&author))?;
    // The reveal MUST come from this same address or the registry ignores it.
    store[&q.canonical]["txid"] = json!(sent.txid);
    store[&q.canonical]["author"] = json!(sent.author);
    write_json(&store_path("pending"), &store)?;
    Ok(sent.txid)
}

/// 20 bytes from the operating system's cryptographic random source.
///
/// ⚠ This must be a real CSPRNG, not a hash of the clock. The salt is the ONLY
/// thing hiding the name during the twelve-block wait: anyone can see the commit
/// on the chain, and if they can guess the salt they can test candidate names
/// against the published hash and register the name first. A timestamp-derived
/// salt has perhaps forty bits of real entropy against an attacker who knows
/// roughly when the commit was made, which is written on the block.
fn random_salt() -> Result<[u8; commitmod::SALT_LEN], String> {
    let mut salt = [0u8; commitmod::SALT_LEN];
    getrandom::getrandom(&mut salt)
        .map_err(|_| "Could not get secure randomness from the system, so the name was not reserved. Reserving with weak randomness would let somebody guess your name and take it.".to_string())?;
    Ok(salt)
}

/// Commits made by this wallet that have not been revealed yet.
pub fn pending(cfg: &NodeConfig) -> Result<Vec<PendingCommit>, String> {
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let tip = tip_height(&rpc)?;
    let idx = load_index(cfg, &chain);
    let mut store = read_json(&store_path("pending"));
    let mut out = Vec::new();
    let mut done: Vec<String> = Vec::new();

    if let Some(map) = store.as_object() {
        for (name, v) in map {
            if v["chain"].as_str().unwrap_or_default() != chain {
                continue;
            }
            // A reservation that has already become a registered name is
            // finished. Leaving it on the list would sit there saying "ready to
            // register" forever, and a user who believed it would pay a second
            // registration fee for a name they already own.
            if idx.names.contains_key(name) {
                done.push(name.clone());
                continue;
            }
            let h = v["height"].as_u64().unwrap_or(0);
            let remaining = commitmod::blocks_remaining(h, tip);
            out.push(PendingCommit {
                name: name.clone(),
                txid: v["txid"].as_str().unwrap_or_default().to_string(),
                commit_height: h,
                blocks_remaining: remaining,
                ready: remaining == 0,
            });
        }
    }

    if !done.is_empty() {
        if let Some(map) = store.as_object_mut() {
            for name in &done {
                map.remove(name);
            }
        }
        write_json(&store_path("pending"), &store)?;
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Step 2 of registration: reveal the name and salt, paying the fee.
pub fn register(cfg: &NodeConfig, input: &str) -> Result<String, String> {
    let q = name_registry::quote(input).map_err(name_registry::explain)?;
    let rpc = RpcClient::new(cfg);
    let chain = chain_name(&rpc);
    let treasury = treasury_address(&chain)?;
    let tip = tip_height(&rpc)?;

    let store = read_json(&store_path("pending"));
    let entry = &store[&q.canonical];
    if entry.is_null() {
        return Err(format!(
            "There is no reservation for {} on this computer. Reserve it first, wait about 12 minutes, then register.",
            q.canonical
        ));
    }
    let commit_height = entry["height"].as_u64().unwrap_or(0);
    let remaining = commitmod::blocks_remaining(commit_height, tip);
    if remaining > 0 {
        return Err(format!(
            "{} more block{} to go before {} can be registered. This wait is what stops anyone outbidding you for the name.",
            remaining,
            if remaining == 1 { "" } else { "s" },
            q.canonical
        ));
    }
    // ⚠ The countdown runs off the height we recorded locally when we broadcast,
    // so it keeps ticking even if the reservation transaction was dropped and
    // never confirmed. Revealing then would publish the name with no commit
    // backing it: every indexer skips it, the fee is spent, and the name is now
    // public for somebody else to take. Check the chain, not our own note.
    if let Some(txid) = entry["txid"].as_str().filter(|t| !t.is_empty()) {
        let confs = rpc
            .call("getrawtransaction", json!([txid, 1]))
            .ok()
            .and_then(|tx| tx["confirmations"].as_i64())
            .unwrap_or(0);
        if confs < commitmod::MIN_COMMIT_DEPTH as i64 {
            return Err(format!(
                "Your reservation for {} has only {} confirmation{} on the chain, and {} are needed. If it never confirms, discard it and reserve again.",
                q.canonical,
                confs,
                if confs == 1 { "" } else { "s" },
                commitmod::MIN_COMMIT_DEPTH
            ));
        }
    }

    let salt_hex = entry["salt"].as_str().ok_or("the saved reservation is unreadable")?;
    let salt = unhex(salt_hex).ok_or("the saved reservation is unreadable")?;

    // ⚠ Fund vin[0] from the address that made the commit. Without this the
    // reveal is authored by whatever change address the coin picker happened to
    // choose, the registry refuses it as a mismatched commit, and the user has
    // paid the registration fee for nothing.
    let author = entry["author"].as_str().map(|s| s.to_string());
    if author.is_none() {
        return Err(format!(
            "This reservation for {} was made by an older version of the wallet that did not record which address authorised it, so it cannot be completed safely. Discard it and reserve again.",
            q.canonical
        ));
    }
    let txid = send_record(
        cfg,
        &NameRecord::Register { salt, name: q.canonical.as_bytes().to_vec() },
        &[Payment { address: treasury, divi: q.registration_divi as f64 }],
        author.as_deref(),
    )?
    .txid;

    // Keep the reservation until the reveal confirms; a dropped transaction
    // must be retryable, and the salt is the only thing that cannot be
    // reconstructed.
    Ok(txid)
}

/// Forget a reservation this wallet is not going to use.
pub fn forget_pending(name: &str) -> Result<(), String> {
    let canonical = charset::canonicalise(name);
    let mut store = read_json(&store_path("pending"));
    if let Some(map) = store.as_object_mut() {
        map.remove(&canonical);
    }
    write_json(&store_path("pending"), &store)
}

/// Attach or replace a record on a name.
pub fn set_record(cfg: &NodeConfig, name: &str, key: u8, value_hex: &str) -> Result<String, String> {
    // Validate rather than merely canonicalise: a name that could never be
    // registered would produce a record every indexer skips, and the user would
    // have paid a transaction fee to achieve nothing.
    let canonical = name_registry::quote(name).map_err(name_registry::explain)?.canonical;
    let value = unhex(value_hex.trim()).ok_or("that value is not valid hex")?;
    if value.is_empty() {
        return Err("Nothing to save.".into());
    }
    // The Divi-address record is the one that moves money. A wrong length here
    // would resolve to a different address than intended, or to nothing.
    if key == record::KEY_DIVI_ADDRESS && value.len() != 21 {
        return Err("A Divi address record must be exactly 21 bytes. Use the address field rather than entering raw data.".into());
    }
    if value.len() > record::MAX_VALUE_LEN {
        return Err(format!("That value is too long: {} bytes, maximum {}.", value.len(), record::MAX_VALUE_LEN));
    }
    if record::key_requires_privacy(key) && looks_like_plaintext_phone(&value) {
        return Err("A phone number must not be written to the chain in the clear. The chain is permanent and public, so this would be a doxxing and SIM-swap risk you could never undo. Store a hashed or encrypted form instead.".into());
    }
    let owner = owner_of(cfg, &canonical)?;
    Ok(send_record(
        cfg,
        &NameRecord::SetRecord { name: canonical.into_bytes(), entries: vec![Entry { key, value }] },
        &[],
        Some(&owner),
    )?
    .txid)
}

/// A crude but deliberate guard: mostly digits, plus the usual phone
/// punctuation, is a phone number somebody is about to publish forever.
fn looks_like_plaintext_phone(value: &[u8]) -> bool {
    let digits = value.iter().filter(|b| b.is_ascii_digit()).count();
    let allowed = value
        .iter()
        .filter(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b' ' | b'(' | b')' | b'.'))
        .count();
    digits >= 6 && allowed == value.len()
}

pub fn clear_record(cfg: &NodeConfig, name: &str, keys: Vec<u8>) -> Result<String, String> {
    if keys.is_empty() {
        return Err("Nothing selected to remove.".into());
    }
    let canonical = charset::canonicalise(name);
    let owner = owner_of(cfg, &canonical)?;
    Ok(send_record(
        cfg,
        &NameRecord::ClearRecord { name: canonical.into_bytes(), keys },
        &[],
        Some(&owner),
    )?
    .txid)
}

/// Point a name at a Divi address. Convenience over [`set_record`], since this
/// is the record almost everyone actually wants.
pub fn set_divi_address(cfg: &NodeConfig, name: &str, address: &str) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let testnet = is_testnet_like(&chain_name(&rpc));
    let (kind, hash) = base58::address_to_payload(address.trim(), testnet).ok_or(
        "That is not a valid Divi address for this network, so nothing was changed. An address from a different Divi network would point somewhere nobody controls.",
    )?;
    let mut value = Vec::with_capacity(21);
    value.push(kind);
    value.extend_from_slice(&hash);
    let canonical = charset::canonicalise(name);
    let owner = owner_of(cfg, &canonical)?;
    Ok(send_record(
        cfg,
        &NameRecord::SetRecord {
            name: canonical.into_bytes(),
            entries: vec![Entry { key: record::KEY_DIVI_ADDRESS, value }],
        },
        &[],
        Some(&owner),
    )?
    .txid)
}

pub fn transfer(cfg: &NodeConfig, name: &str, new_owner: &str) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    let testnet = is_testnet_like(&chain_name(&rpc));
    let (kind, hash160) = base58::address_to_payload(new_owner.trim(), testnet).ok_or(
        "That is not a valid Divi address for this network, so the name was not sent. An address from a different Divi network would hand the name to somebody who does not exist.",
    )?;
    let canonical = charset::canonicalise(name);
    let owner = owner_of(cfg, &canonical)?;
    Ok(send_record(
        cfg,
        &NameRecord::Transfer {
            name: canonical.into_bytes(),
            new_owner: dvxp_core::codec::Address { kind, hash160 },
        },
        &[],
        Some(&owner),
    )?
    .txid)
}

/// Claim a name as the display name for the address it points at.
///
/// ⚠ Authored by the TARGET address, not the owner. Reverse resolution only
/// counts when both directions agree, so this record has to be signed by the
/// address the name points at, which may not be the address that owns the name.
pub fn set_primary(cfg: &NodeConfig, name: &str) -> Result<String, String> {
    let canonical = charset::canonicalise(name);
    let target = resolve(cfg, &canonical)?.ok_or_else(|| {
        format!("{canonical} does not point at a Divi address yet, so there is nothing to display it for. Set its address first.")
    })?;
    require_ours(cfg, &target, &format!("Displaying {canonical} for {target}"))?;
    Ok(send_record(
        cfg,
        &NameRecord::SetPrimary { name: canonical.into_bytes() },
        &[],
        Some(&target),
    )?
    .txid)
}

pub fn renew(cfg: &NodeConfig, name: &str) -> Result<String, String> {
    let q = name_registry::quote(name).map_err(name_registry::explain)?;
    let rpc = RpcClient::new(cfg);
    let treasury = treasury_address(&chain_name(&rpc))?;
    let owner = owner_of(cfg, &q.canonical)?;
    Ok(send_record(
        cfg,
        &NameRecord::Renew { name: q.canonical.clone().into_bytes() },
        &[Payment { address: treasury, divi: q.renewal_divi as f64 }],
        Some(&owner),
    )?
    .txid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dvxp_core::codec::Address;

    fn idx() -> Index {
        Index { chain: "regtest".into(), ..Default::default() }
    }

    const ALICE: &str = "alice-address";
    const BOB: &str = "bob-address";
    const TREASURY: &str = "treasury-address";

    /// Most rules do not involve money, so the default is "paid in full".
    fn paid(name: &str) -> Vec<(String, f64)> {
        let price = name_registry::fees::registration_divi(name.len()).unwrap_or(0);
        vec![(TREASURY.to_string(), price as f64)]
    }

    /// Shorthand: apply a record with no payment attached.
    fn apply(i: &mut Index, rec: &NameRecord, sender: &str, height: u64) {
        apply_record(i, rec, sender, height, true, TREASURY, &[]);
    }

    fn register_name(i: &mut Index, name: &str, owner: &str, height: u64) {
        let salt = [0x42u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, name.as_bytes());
        apply(i, &NameRecord::Commit { hash160: hash }, owner, height);
        apply_record(
            i,
            &NameRecord::Register { salt: salt.to_vec(), name: name.as_bytes().to_vec() },
            owner,
            height + commitmod::MIN_COMMIT_DEPTH,
            true,
            TREASURY,
            &paid(name),
        );
    }

    #[test]
    fn a_full_registration_lands() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let st = i.names.get("GEOFF").expect("registered");
        assert_eq!(st.owner, ALICE);
        assert_eq!(st.expires_height, 112 + name_registry::fees::TERM_BLOCKS);
    }

    /// The anti-front-running rule: a reveal before the commit matures does
    /// nothing at all.
    #[test]
    fn an_immature_reveal_is_ignored() {
        let mut i = idx();
        let salt = [1u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        apply_record(
            &mut i,
            &NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() },
            ALICE,
            110, // only 10 deep
            true,
            TREASURY,
            &paid("GEOFF"),
        );
        assert!(i.names.is_empty());
    }

    /// Someone who sees the name at reveal time cannot register it with
    /// somebody else's commit.
    #[test]
    fn a_stolen_commit_cannot_be_used_by_another_address() {
        let mut i = idx();
        let salt = [2u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        apply(&mut i, &NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() }, BOB, 200);
        assert!(i.names.is_empty());
    }

    #[test]
    fn first_registration_wins_and_a_commit_is_spent_once() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        register_name(&mut i, "GEOFF", BOB, 500);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE);
    }

    #[test]
    fn only_the_owner_can_change_anything() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let addr = Address { kind: 0, hash160: [5; 20] };
        for rec in [
            NameRecord::Transfer { name: b"GEOFF".to_vec(), new_owner: addr },
            NameRecord::SetRecord {
                name: b"GEOFF".to_vec(),
                entries: vec![Entry { key: record::KEY_URL, value: b"http://evil".to_vec() }],
            },
            NameRecord::ClearRecord { name: b"GEOFF".to_vec(), keys: vec![record::KEY_URL] },
            NameRecord::Renew { name: b"GEOFF".to_vec() },
        ] {
            apply_record(&mut i, &rec, BOB, 300, true, TREASURY, &paid("GEOFF"));
        }
        let st = i.names.get("GEOFF").unwrap();
        assert_eq!(st.owner, ALICE);
        assert!(st.records.is_empty());
    }

    /// Reverse resolution must require BOTH directions, or anyone can display
    /// themselves as somebody else.
    #[test]
    fn primary_needs_the_forward_record_to_agree() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &NameRecord::SetPrimary { name: b"GEOFF".to_vec() }, ALICE, 300);
        assert!(i.primary.is_empty(), "no forward record yet, so no reverse claim");

        // Point the name at a real address, then claim it from that address.
        let (kind, hash) = base58::address_to_payload(&base58::payload_to_address(0, &[9; 20], true), true).unwrap();
        let mut value = vec![kind];
        value.extend_from_slice(&hash);
        apply(&mut i, &NameRecord::SetRecord {
                name: b"GEOFF".to_vec(),
                entries: vec![Entry { key: record::KEY_DIVI_ADDRESS, value }],
            }, ALICE, 310);
        let target = base58::payload_to_address(0, &[9; 20], true);
        // A stranger still cannot claim it.
        apply(&mut i, &NameRecord::SetPrimary { name: b"GEOFF".to_vec() }, BOB, 320);
        assert!(i.primary.is_empty());
        // The address the name points at can.
        apply(&mut i, &NameRecord::SetPrimary { name: b"GEOFF".to_vec() }, &target, 330);
        assert_eq!(i.primary.get(&target).map(String::as_str), Some("GEOFF"));
    }

    /// The listing window is what makes buying safe. Withdrawing inside it must
    /// be impossible, or a seller can take a payment and keep the name.
    #[test]
    fn a_listing_cannot_be_withdrawn_inside_its_committed_window() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &NameRecord::List { name: b"GEOFF".to_vec(), price: 500_00000000, min_lifetime_blocks: 100 }, ALICE, 200);
        apply(&mut i, &NameRecord::Delist { name: b"GEOFF".to_vec() }, ALICE, 250);
        assert!(i.names.get("GEOFF").unwrap().listing.is_some(), "delist inside the window must be ignored");
        apply(&mut i, &NameRecord::Delist { name: b"GEOFF".to_vec() }, ALICE, 301);
        assert!(i.names.get("GEOFF").unwrap().listing.is_none());
    }

    /// Buying is the only place a name changes hands for money, so every way it
    /// could go wrong is worth a test.
    #[test]
    fn a_purchase_needs_the_seller_actually_paid() {
        let list = NameRecord::List { name: b"GEOFF".to_vec(), price: 500_00000000, min_lifetime_blocks: 100 };
        let buy = NameRecord::Buy { name: b"GEOFF".to_vec() };

        // Not for sale at all.
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply_record(&mut i, &buy, BOB, 300, true, TREASURY, &[(ALICE.to_string(), 500.0)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE, "unlisted names are not for sale");

        // Listed, but the buyer underpays.
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &list, ALICE, 200);
        apply_record(&mut i, &buy, BOB, 300, true, TREASURY, &[(ALICE.to_string(), 499.0)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE, "underpaying buys nothing");

        // Listed, but the money went somewhere else.
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &list, ALICE, 200);
        apply_record(&mut i, &buy, BOB, 300, true, TREASURY, &[(BOB.to_string(), 500.0)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE, "paying yourself buys nothing");

        // Paid in full: the name moves and the listing is spent.
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &list, ALICE, 200);
        apply_record(&mut i, &buy, BOB, 300, true, TREASURY, &[(ALICE.to_string(), 500.0)]);
        let st = i.names.get("GEOFF").unwrap();
        assert_eq!(st.owner, BOB);
        assert!(st.listing.is_none(), "the listing must not survive the sale");
    }

    /// First buyer in block order wins. The second finds nothing for sale, which
    /// is exactly why their payment is a real loss and the wallet checks the
    /// mempool before broadcasting.
    #[test]
    fn only_the_first_buyer_in_a_block_gets_the_name() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &NameRecord::List { name: b"GEOFF".to_vec(), price: 100_00000000, min_lifetime_blocks: 100 }, ALICE, 200);
        let buy = NameRecord::Buy { name: b"GEOFF".to_vec() };
        apply_record(&mut i, &buy, BOB, 300, true, TREASURY, &[(ALICE.to_string(), 100.0)]);
        apply_record(&mut i, &buy, "carol", 300, true, TREASURY, &[(ALICE.to_string(), 100.0)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, BOB);
    }

    /// A seller must not be able to buy from themselves and invent a sale price
    /// for anyone pricing the market off past sales.
    #[test]
    fn an_owner_cannot_buy_their_own_name() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &NameRecord::List { name: b"GEOFF".to_vec(), price: 1_00000000, min_lifetime_blocks: 100 }, ALICE, 200);
        apply_record(&mut i, &NameRecord::Buy { name: b"GEOFF".to_vec() }, ALICE, 300, true, TREASURY, &[(ALICE.to_string(), 1.0)]);
        assert!(i.names.get("GEOFF").unwrap().listing.is_some(), "the wash sale must be ignored");
    }

    /// Buying must drop a display claim, exactly as a transfer does.
    #[test]
    fn a_sale_drops_a_stale_reverse_claim() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let target = base58::payload_to_address(0, &[9; 20], true);
        let (kind, h160) = base58::address_to_payload(&target, true).unwrap();
        let mut value = vec![kind];
        value.extend_from_slice(&h160);
        apply(&mut i, &NameRecord::SetRecord { name: b"GEOFF".to_vec(), entries: vec![Entry { key: record::KEY_DIVI_ADDRESS, value }] }, ALICE, 310);
        apply(&mut i, &NameRecord::SetPrimary { name: b"GEOFF".to_vec() }, &target, 320);
        assert!(!i.primary.is_empty());

        apply(&mut i, &NameRecord::List { name: b"GEOFF".to_vec(), price: 1_00000000, min_lifetime_blocks: 10 }, ALICE, 330);
        apply_record(&mut i, &NameRecord::Buy { name: b"GEOFF".to_vec() }, BOB, 340, true, TREASURY, &[(ALICE.to_string(), 1.0)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, BOB);
        assert!(i.primary.is_empty(), "the previous owner's display claim must go");
    }

    /// Reserved names are HELD, not forbidden: owned by the reserve, never
    /// expiring, and transferable to whoever they belong to.
    #[test]
    fn the_reserve_holds_brand_and_people_names() {
        let mut i = idx();
        seed_reserve(&mut i, "reserve-address", 0);
        for n in ["BINANCE", "SATOSHINAKAMOTO", "VITALIK", "DIVI"] {
            let st = i.names.get(n).unwrap_or_else(|| panic!("{n} should be seeded"));
            assert_eq!(st.owner, "reserve-address");
            assert_eq!(st.expires_height, NEVER_EXPIRES, "{n} must never expire");
            assert!(!is_expired(st, u64::MAX - 1), "{n}");
            assert!(!is_released(st, u64::MAX - 1), "{n}");
        }

        // Registering one is refused for the ordinary reason: already owned.
        let salt = [5u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"BINANCE");
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        apply_record(
            &mut i,
            &NameRecord::Register { salt: salt.to_vec(), name: b"BINANCE".to_vec() },
            ALICE,
            200,
            true,
            TREASURY,
            &paid("BINANCE"),
        );
        assert_eq!(i.names.get("BINANCE").unwrap().owner, "reserve-address");
    }

    /// A listing window is attacker-controlled and arrives straight off the
    /// chain. u64::MAX would overflow every `listed_height + window` in the
    /// code, and an absurd window is a trap rather than a promise anyway.
    #[test]
    fn an_absurd_no_cancel_window_is_refused_and_never_overflows() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(
            &mut i,
            &NameRecord::List {
                name: b"GEOFF".to_vec(),
                price: 1_00000000,
                min_lifetime_blocks: u64::MAX,
            },
            ALICE,
            200,
        );
        assert!(i.names.get("GEOFF").unwrap().listing.is_none(), "absurd window must be refused");

        // The largest window that IS accepted works, and ends inside the term.
        apply(
            &mut i,
            &NameRecord::List {
                name: b"GEOFF".to_vec(),
                price: 1_00000000,
                min_lifetime_blocks: MAX_LISTING_LOCK_BLOCKS,
            },
            ALICE,
            200,
        );
        assert!(i.names.get("GEOFF").unwrap().listing.is_some());
        let unlock = 200 + MAX_LISTING_LOCK_BLOCKS;
        assert!(unlock < i.names.get("GEOFF").unwrap().expires_height, "window must end inside the term");
        apply(&mut i, &NameRecord::Delist { name: b"GEOFF".to_vec() }, ALICE, unlock + 1);
        assert!(i.names.get("GEOFF").unwrap().listing.is_none());
    }

    /// ⚠ The regression this exists to prevent.
    ///
    /// When reserved names moved from "refused" to "owned by the reserve", the
    /// seeding inserted only the EXACT strings. `B1NANCE` is a different
    /// string, so nothing held it and it was registrable. Every unit test still
    /// passed, because they checked `is_reserved` directly rather than through
    /// the registration path. Only an end-to-end check caught it.
    #[test]
    fn a_lookalike_of_a_reserved_name_cannot_be_registered() {
        for spoof in ["B1NANCE", "M!CROSOFT", "C0INBASE", "SAT0SHINAKAM0T0", "V1TAL1K", "D1VI"] {
            let mut i = idx();
            seed_reserve(&mut i, "reserve-address", 0);
            let salt = [9u8; commitmod::SALT_LEN];
            let hash = commitmod::commit_hash(&salt, spoof.as_bytes());
            apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
            apply_record(
                &mut i,
                &NameRecord::Register { salt: salt.to_vec(), name: spoof.as_bytes().to_vec() },
                ALICE,
                200,
                true,
                TREASURY,
                &paid(spoof),
            );
            assert!(!i.names.contains_key(spoof), "{spoof} must not be registrable");
        }

        // And the counterweight: an ordinary name still registers normally.
        let mut i = idx();
        seed_reserve(&mut i, "reserve-address", 0);
        register_name(&mut i, "GEOFF", ALICE, 100);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE);
    }

    /// Seeding must never overwrite a name the reserve has already handed on.
    #[test]
    fn seeding_is_idempotent_and_never_takes_a_name_back() {
        let mut i = idx();
        seed_reserve(&mut i, "reserve-address", 0);
        i.names.get_mut("BINANCE").unwrap().owner = "the-real-binance".into();
        seed_reserve(&mut i, "reserve-address", 0);
        assert_eq!(i.names.get("BINANCE").unwrap().owner, "the-real-binance");
    }

    /// Namecoin's lesson: names lapse, so the namespace does not fill up with
    /// abandoned registrations forever.
    #[test]
    fn a_name_expires_then_releases() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let expires = i.names.get("GEOFF").unwrap().expires_height;
        let st = i.names.get("GEOFF").unwrap();

        assert!(!is_expired(st, expires), "still live on the last block of the term");
        assert!(is_expired(st, expires + 1));
        assert!(!is_released(st, expires + name_registry::fees::GRACE_BLOCKS));
        assert!(is_released(st, expires + name_registry::fees::GRACE_BLOCKS + 1));
    }

    /// An expired name must resolve to nothing and refuse every edit, or a
    /// payment meant for its new holder lands with the old one.
    #[test]
    fn an_expired_name_is_inert() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let expired_at = i.names.get("GEOFF").unwrap().expires_height + 1;

        for rec in [
            NameRecord::SetRecord {
                name: b"GEOFF".to_vec(),
                entries: vec![Entry { key: record::KEY_URL, value: b"x".to_vec() }],
            },
            NameRecord::Transfer {
                name: b"GEOFF".to_vec(),
                new_owner: Address { kind: 0, hash160: [1; 20] },
            },
            NameRecord::List { name: b"GEOFF".to_vec(), price: 1, min_lifetime_blocks: 60 },
        ] {
            apply(&mut i, &rec, ALICE, expired_at);
        }
        let st = i.names.get("GEOFF").unwrap();
        assert_eq!(st.owner, ALICE, "an expired name cannot be transferred");
        assert!(st.records.is_empty(), "an expired name cannot be edited");
        assert!(st.listing.is_none(), "an expired name cannot be sold");
    }

    /// The grace period is the whole point of expiry being survivable: the
    /// owner, and only the owner, can still renew after lapsing.
    #[test]
    fn the_owner_can_renew_during_grace_but_not_after_release() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let expires = i.names.get("GEOFF").unwrap().expires_height;

        let renew = NameRecord::Renew { name: b"GEOFF".to_vec() };
        let in_grace = expires + name_registry::fees::GRACE_BLOCKS - 1;
        apply_record(&mut i, &renew, ALICE, in_grace, true, TREASURY, &paid("GEOFF"));
        let after = i.names.get("GEOFF").unwrap().expires_height;
        assert!(after > expires, "renewal during grace must work");

        // Once released it is gone, even for the previous owner.
        let released = after + name_registry::fees::GRACE_BLOCKS + 1;
        apply_record(&mut i, &renew, ALICE, released, true, TREASURY, &paid("GEOFF"));
        assert_eq!(i.names.get("GEOFF").unwrap().expires_height, after, "no renewal after release");
    }

    /// A released name can be taken by somebody new, at the declining price,
    /// and arrives clean rather than carrying the old owner's records.
    #[test]
    fn a_released_name_can_be_taken_over_and_starts_clean() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        i.names.get_mut("GEOFF").unwrap().records.insert(record::KEY_URL, hex_of(b"old"));
        let released = i.names.get("GEOFF").unwrap().expires_height
            + name_registry::fees::GRACE_BLOCKS
            + 1;

        let salt = [6u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        apply(&mut i, &NameRecord::Commit { hash160: hash }, BOB, released);
        let reveal = NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() };
        let at = released + commitmod::MIN_COMMIT_DEPTH;

        // The ordinary price is not enough while the premium is still decaying.
        apply_record(&mut i, &reveal, BOB, at, true, TREASURY, &paid("GEOFF"));
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE, "underpaying the premium fails");

        let full = name_registry::fees::release_price_divi(5, at - released).unwrap();
        apply_record(
            &mut i,
            &reveal,
            BOB,
            at,
            true,
            TREASURY,
            &[(TREASURY.to_string(), full as f64)],
        );
        let st = i.names.get("GEOFF").unwrap();
        assert_eq!(st.owner, BOB);
        assert!(st.records.is_empty(), "a takeover must not inherit the old records");
    }

    #[test]
    fn renewing_early_keeps_the_unused_remainder() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let first = i.names.get("GEOFF").unwrap().expires_height;

        // An unpaid renewal is not a renewal.
        apply(&mut i, &NameRecord::Renew { name: b"GEOFF".to_vec() }, ALICE, 200);
        assert_eq!(i.names.get("GEOFF").unwrap().expires_height, first);

        apply_record(
            &mut i,
            &NameRecord::Renew { name: b"GEOFF".to_vec() },
            ALICE,
            200,
            true,
            TREASURY,
            &paid("GEOFF"),
        );
        assert_eq!(
            i.names.get("GEOFF").unwrap().expires_height,
            first + name_registry::fees::TERM_BLOCKS
        );
    }

    /// The fee is a rule. Without this check names are free and the whole
    /// anti-squatting model is decoration.
    #[test]
    fn an_unpaid_or_misdirected_registration_is_refused() {
        let salt = [7u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        let reveal = NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() };
        let price = name_registry::fees::registration_divi(5).unwrap() as f64;

        for (label, payments) in [
            ("nothing at all", vec![]),
            ("underpaid", vec![(TREASURY.to_string(), price - 1.0)]),
            ("paid to themselves", vec![(ALICE.to_string(), price)]),
        ] {
            let mut i = idx();
            apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
            apply_record(&mut i, &reveal, ALICE, 200, true, TREASURY, &payments);
            assert!(i.names.is_empty(), "should refuse when {label}");
        }

        // And it goes through when the fee is right.
        let mut i = idx();
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        apply_record(
            &mut i,
            &reveal,
            ALICE,
            200,
            true,
            TREASURY,
            &[(TREASURY.to_string(), price)],
        );
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE);
    }

    /// A commit is not consumed by a rejected reveal, so a user who underpaid
    /// can retry with the correct fee instead of losing the reservation.
    /// Cheap commits must not accumulate forever, and an ancient one must not
    /// still be redeemable.
    #[test]
    fn commits_expire_and_are_pruned() {
        let mut i = idx();
        let salt = [3u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        assert_eq!(i.commits.len(), 1);

        // Too late to redeem it.
        let late = 100 + commitmod::COMMIT_EXPIRY_BLOCKS + 1;
        apply_record(
            &mut i,
            &NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() },
            ALICE,
            late,
            true,
            TREASURY,
            &paid("GEOFF"),
        );
        assert!(i.names.is_empty(), "an expired commit must not register anything");

        // And a later commit sweeps the stale one out of state.
        apply(&mut i, &NameRecord::Commit { hash160: [9u8; 20] }, BOB, late);
        assert_eq!(i.commits.len(), 1, "the expired commit should have been pruned");
    }

    #[test]
    fn a_refused_reveal_does_not_burn_the_commit() {
        let salt = [8u8; commitmod::SALT_LEN];
        let hash = commitmod::commit_hash(&salt, b"GEOFF");
        let reveal = NameRecord::Register { salt: salt.to_vec(), name: b"GEOFF".to_vec() };
        let price = name_registry::fees::registration_divi(5).unwrap() as f64;

        let mut i = idx();
        apply(&mut i, &NameRecord::Commit { hash160: hash }, ALICE, 100);
        apply_record(&mut i, &reveal, ALICE, 200, true, TREASURY, &[]);
        assert!(i.names.is_empty());
        apply_record(&mut i, &reveal, ALICE, 201, true, TREASURY, &[(TREASURY.to_string(), price)]);
        assert_eq!(i.names.get("GEOFF").unwrap().owner, ALICE, "retry must work");
    }

    /// A name that moves on must stop being displayed for its old owner.
    #[test]
    fn transfer_drops_a_stale_reverse_claim() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        let target = base58::payload_to_address(0, &[9; 20], true);
        let (kind, h160) = base58::address_to_payload(&target, true).unwrap();
        let mut value = vec![kind];
        value.extend_from_slice(&h160);
        apply(
            &mut i,
            &NameRecord::SetRecord {
                name: b"GEOFF".to_vec(),
                entries: vec![Entry { key: record::KEY_DIVI_ADDRESS, value }],
            },
            ALICE,
            310,
        );
        apply(&mut i, &NameRecord::SetPrimary { name: b"GEOFF".to_vec() }, &target, 320);
        assert_eq!(i.primary.get(&target).map(String::as_str), Some("GEOFF"));

        apply(
            &mut i,
            &NameRecord::Transfer {
                name: b"GEOFF".to_vec(),
                new_owner: Address { kind: 0, hash160: [77; 20] },
            },
            ALICE,
            330,
        );
        assert!(i.primary.is_empty(), "the old display claim must not survive a transfer");
    }

    /// A transfer must also kill the listing, or the new owner inherits a sale
    /// the previous owner priced.
    #[test]
    fn transfer_clears_a_listing() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        apply(&mut i, &NameRecord::List { name: b"GEOFF".to_vec(), price: 1, min_lifetime_blocks: 0 }, ALICE, 200);
        apply(
            &mut i,
            &NameRecord::Transfer {
                name: b"GEOFF".to_vec(),
                new_owner: Address { kind: 0, hash160: [4; 20] },
            },
            ALICE,
            210,
        );
        assert!(i.names.get("GEOFF").unwrap().listing.is_none());
    }

    #[test]
    fn records_for_an_unregistered_name_do_nothing() {
        let mut i = idx();
        apply(&mut i, &NameRecord::SetRecord {
                name: b"NOBODY".to_vec(),
                entries: vec![Entry { key: record::KEY_URL, value: b"x".to_vec() }],
            }, ALICE, 100);
        assert!(i.names.is_empty());
    }

    #[test]
    fn the_index_survives_a_save_and_load_roundtrip() {
        let mut i = idx();
        register_name(&mut i, "GEOFF", ALICE, 100);
        i.names.get_mut("GEOFF").unwrap().records.insert(record::KEY_TELEGRAM, hex_of(b"geoff"));
        let back = index_from_json(&index_to_json(&i));
        assert_eq!(back.names.len(), 1);
        assert_eq!(back.names.get("GEOFF").unwrap().owner, ALICE);
        assert_eq!(
            back.names.get("GEOFF").unwrap().records.get(&record::KEY_TELEGRAM),
            Some(&hex_of(b"geoff"))
        );
    }

    #[test]
    fn plaintext_phone_numbers_are_recognised() {
        assert!(looks_like_plaintext_phone(b"+1 (555) 010-9999"));
        assert!(looks_like_plaintext_phone(b"07700900123"));
        // A hash or ciphertext is not mostly-digits-and-dashes.
        assert!(!looks_like_plaintext_phone(b"a3f9c2b81d4e7f60a1b2c3d4e5f60718"));
        assert!(!looks_like_plaintext_phone(b"12345"));
    }

    #[test]
    fn hex_helpers_roundtrip_and_reject_junk() {
        assert_eq!(unhex(&hex_of(b"hello")), Some(b"hello".to_vec()));
        assert_eq!(unhex("abc"), None);
        assert_eq!(unhex("zz"), None);
    }
}
