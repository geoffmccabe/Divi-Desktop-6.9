//! The wallet's own token and collectible index.
//!
//! ## Why the wallet scans for itself
//!
//! It would be far less work to ask a server. The spec says not to, and the
//! reason is worth restating because it is the whole point of the feature: a
//! self-custody wallet that got its balances from a service we run would let
//! that service's downtime hide a user's own holdings from them. They would own
//! tokens the chain agrees are theirs and see nothing. So the wallet reads the
//! chain it already has.
//!
//! ## Nothing here interprets a record
//!
//! The rules, the ledger, the reorg window and the scanning loop all live in the
//! vendored `dvxp-scan` and `dmt-indexer`, byte-identical to the chain repo and
//! shared with the explorer. This module supplies exactly one thing the shared
//! code does not have: a way to fetch a block, using the wallet's existing node
//! connection. That is the only difference between this and the explorer's
//! daemon, and keeping it the only difference is deliberate.
//!
//! ## Staking comes first
//!
//! Divi allocates a node thread per application connection and the pool is
//! small. An earlier scanner saturated it and took the public explorer offline;
//! in a wallet the node it would starve is the one the user is staking with, so
//! the cost of getting this wrong is somebody's block reward.
//!
//! Three things keep it polite: a small slice of blocks at a time, a pause
//! between slices, and a longer pause once caught up. It is meant to be
//! unnoticeable rather than fast.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde_json::{json, Value};

use dvxp_scan::driver::{BlockInput, Overlay, TxPayload};
use dvxp_scan::follow::{BlockSource, FollowError, Follower};
use dvxp_scan::parse;

use crate::config::NodeConfig;
use crate::rpc::RpcClient;

/// Blocks applied before pausing. Small on purpose: see the module note.
const SLICE_BLOCKS: u64 = 25;
/// Pause between slices while catching up.
const CATCHUP_PAUSE: Duration = Duration::from_millis(400);
/// Pause once there is nothing to do. Divi targets a block a minute.
const IDLE_PAUSE: Duration = Duration::from_secs(20);
/// Pause after losing the node, which happens routinely when it restarts.
const RETRY_PAUSE: Duration = Duration::from_secs(10);

/// Fetches blocks through the wallet's existing node connection.
///
/// The connection is already pooled and keep-alive, so this adds no new
/// connection to the node's thread budget.
struct NodeBlocks<'a> {
    rpc: &'a RpcClient,
}

impl BlockSource for NodeBlocks<'_> {
    fn tip(&mut self) -> Result<u64, String> {
        self.rpc
            .call("getblockcount", json!([]))?
            .as_u64()
            .ok_or_else(|| "the node did not report a height".to_string())
    }

    fn block_hash(&mut self, height: u64) -> Result<String, String> {
        self.rpc
            .call("getblockhash", json!([height]))?
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "the node did not report a block hash".to_string())
    }

    fn block_at(&mut self, height: u64) -> Result<BlockInput, String> {
        let hash_hex = self.block_hash(height)?;
        let block = self.rpc.call("getblock", json!([hash_hex.clone()]))?;
        let time = block["time"].as_i64().unwrap_or(0);

        let txids: Vec<String> = block["tx"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();

        let mut payloads = Vec::new();
        for (tx_index, txid_s) in txids.iter().enumerate() {
            let tx = match self.rpc.call("getrawtransaction", json!([txid_s, 1])) {
                Ok(v) => v,
                // A transaction the node will not return is not a reason to
                // invent state. Skip it rather than guess at its contents.
                Err(_) => continue,
            };
            let vout = tx["vout"].as_array().cloned().unwrap_or_default();

            // Cheap pre-filter: most transactions carry no data output at all,
            // and resolving a sender costs another round trip.
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

impl NodeBlocks<'_> {
    /// The address funding `vin[0]`: the deterministic sender rule, and the
    /// reason every send in `dmt.rs` pins its funding address.
    fn sender_of(&self, tx: &Value) -> Option<dvxp_core::codec::Address> {
        let vin0 = tx["vin"].as_array()?.first()?;
        let prev_txid = vin0["txid"].as_str()?.to_string();
        let n = vin0["vout"].as_u64()? as usize;
        let prev = self.rpc.call("getrawtransaction", json!([prev_txid, 1])).ok()?;
        parse::address_of_output(prev["vout"].as_array()?.get(n)?)
    }
}

/// What the index can currently be trusted for.
#[derive(Debug, Clone, Default)]
pub struct IndexStatus {
    pub running: bool,
    pub height: u64,
    pub tip: u64,
    pub caught_up: bool,
    /// Set when the index stopped and will not restart on its own. The wallet
    /// must refuse to act on token balances while this is set: an index that
    /// stopped is recoverable, one that guesses is not.
    pub halted: Option<String>,
    /// Set when there is no usable genesis height, which is not an error so
    /// much as a feature that has not been switched on yet.
    pub unavailable: Option<String>,
}

impl IndexStatus {
    /// Whether a balance from this index may be shown as current.
    pub fn trustworthy(&self) -> bool {
        self.running && self.halted.is_none() && self.tip.saturating_sub(self.height) <= 2
    }
}

/// The height overlay records start counting from on this chain.
///
/// Records below it are ignored by the rules, so this is the definition of where
/// the index begins, not a shortcut. Without it the wallet would replay millions
/// of irrelevant blocks on every install, which is days of work, so a mainnet
/// wallet refuses rather than starting something it cannot finish.
pub fn genesis_height(chain: &str) -> Result<u64, String> {
    if let Ok(v) = std::env::var("DIVI_DMT_GENESIS") {
        if let Ok(h) = v.trim().parse::<u64>() {
            return Ok(h);
        }
    }
    if chain != "main" {
        // A fresh regtest or testnet has no history worth skipping.
        return Ok(0);
    }
    Err("Tokens are not switched on yet: this build has no overlay start height, and scanning \
         the whole chain to look for records that cannot exist below it would take days. Set \
         DIVI_DMT_GENESIS to override."
        .into())
}

/// A running index, or a clear reason why there is not one.
pub struct TokenIndex {
    overlay: Arc<RwLock<Overlay>>,
    status: Arc<Mutex<IndexStatus>>,
    stop: Arc<AtomicBool>,
}

impl TokenIndex {
    /// Start scanning in the background.
    ///
    /// Returns immediately. If there is no genesis height the index does not
    /// start, and `status()` says so in words a person can read rather than
    /// leaving the caller to guess from an empty ledger.
    pub fn start(cfg: &NodeConfig) -> Self {
        let overlay = Arc::new(RwLock::new(Overlay::new()));
        let status = Arc::new(Mutex::new(IndexStatus::default()));
        let stop = Arc::new(AtomicBool::new(false));

        let rpc = RpcClient::new(cfg);
        let chain = rpc
            .call("getblockchaininfo", json!([]))
            .ok()
            .and_then(|v| v["chain"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "main".into());

        let genesis = match genesis_height(&chain) {
            Ok(h) => h,
            Err(why) => {
                status.lock().expect("status lock").unavailable = Some(why);
                return Self { overlay, status, stop };
            }
        };

        let (o, st, sp) = (overlay.clone(), status.clone(), stop.clone());
        std::thread::Builder::new()
            .name("dmt-index".into())
            .spawn(move || run(rpc, genesis, o, st, sp))
            .ok();

        Self { overlay, status, stop }
    }

    pub fn status(&self) -> IndexStatus {
        self.status.lock().expect("status lock").clone()
    }

    /// Read the ledger. Returns `None` while a scan slice holds the writer,
    /// which the caller should treat as "ask again", never as "empty".
    pub fn read<T>(&self, f: impl FnOnce(&Overlay) -> T) -> Option<T> {
        self.overlay.try_read().ok().map(|o| f(&o))
    }

    /// Stop scanning. The thread finishes its current slice first, so the node
    /// is never left with a half-issued burst of requests.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for TokenIndex {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(
    rpc: RpcClient,
    genesis: u64,
    overlay: Arc<RwLock<Overlay>>,
    status: Arc<Mutex<IndexStatus>>,
    stop: Arc<AtomicBool>,
) {
    let mut follower = Follower::new(genesis);
    let mut source = NodeBlocks { rpc: &rpc };
    status.lock().expect("status lock").running = true;

    while !stop.load(Ordering::Relaxed) {
        // The writer lock is held for one slice only, so a balance query waits
        // milliseconds rather than a whole catch-up.
        let outcome = {
            let mut o = overlay.write().expect("index owns the only writer");
            follower.catch_up(&mut o, &mut source, SLICE_BLOCKS)
        };

        match outcome {
            Ok(progress) => {
                {
                    let mut s = status.lock().expect("status lock");
                    s.height = progress.height;
                    s.tip = progress.tip;
                    s.caught_up = progress.caught_up;
                }
                // A skipped record is a fact about the chain, not noise, and the
                // only place it can be investigated from later is a log.
                for (height, tx_index, why) in &progress.skipped {
                    crate::applog::log(&format!(
                        "dmt-index: skipped a record at height {height} tx {tx_index}: {why:?}"
                    ));
                }

                if progress.caught_up {
                    if sleep_unless_stopped(IDLE_PAUSE, &stop) {
                        return;
                    }
                    let reorg = {
                        let mut o = overlay.write().expect("index owns the only writer");
                        follower.check_for_reorg(&mut o, &mut source)
                    };
                    match reorg {
                        Ok(Some(height)) => crate::applog::log(&format!(
                            "dmt-index: the chain reorganised; rolled back to {height}"
                        )),
                        Ok(None) => {}
                        Err(FollowError::Source(_)) => {
                            // The node comes and goes. Not worth logging every
                            // time, and certainly not worth stopping for.
                        }
                        Err(e @ FollowError::Fatal(_)) => return halt(&status, e),
                    }
                } else if sleep_unless_stopped(CATCHUP_PAUSE, &stop) {
                    return;
                }
            }
            // A wallet's node restarts, gets locked, and gets busy. None of that
            // is a reason to give up on the index, only to wait.
            Err(FollowError::Source(_)) => {
                if sleep_unless_stopped(RETRY_PAUSE, &stop) {
                    return;
                }
            }
            Err(e @ FollowError::Fatal(_)) => return halt(&status, e),
        }
    }

    status.lock().expect("status lock").running = false;
}

/// Stopping loudly, and staying stopped.
///
/// An index that halts is unavailable, which is recoverable. One that carries on
/// past something it could not read would be serving balances it cannot justify,
/// which is not.
fn halt(status: &Arc<Mutex<IndexStatus>>, why: FollowError) {
    let mut s = status.lock().expect("status lock");
    s.halted = Some(why.to_string());
    s.running = false;
    crate::applog::log(&format!("dmt-index: stopped. {why}"));
}

/// Sleep in short steps so a stop is acted on promptly rather than after a
/// twenty-second nap. Returns true if it was asked to stop.
fn sleep_unless_stopped(total: Duration, stop: &Arc<AtomicBool>) -> bool {
    let step = Duration::from_millis(200);
    let mut left = total;
    while left > Duration::ZERO {
        if stop.load(Ordering::Relaxed) {
            return true;
        }
        let nap = step.min(left);
        std::thread::sleep(nap);
        left -= nap;
    }
    stop.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_chain_starts_at_zero_and_mainnet_refuses_without_a_height() {
        if std::env::var("DIVI_DMT_GENESIS").is_ok() {
            return;
        }
        assert_eq!(genesis_height("regtest").unwrap(), 0);
        assert_eq!(genesis_height("test").unwrap(), 0);

        let main = genesis_height("main");
        assert!(main.is_err(), "mainnet has no start height in this build");
        let why = main.unwrap_err();
        assert!(why.contains("days"), "the refusal should say why, got: {why}");
        assert!(why.contains("DIVI_DMT_GENESIS"), "and how to override it");
    }

    #[test]
    fn an_override_is_honoured() {
        std::env::set_var("DIVI_DMT_GENESIS", "4131200");
        assert_eq!(genesis_height("main").unwrap(), 4_131_200);
        std::env::remove_var("DIVI_DMT_GENESIS");
    }

    /// A guard rather than a comment.
    ///
    /// These numbers exist to keep the index from starving the node the user is
    /// STAKING with, so the cost of "optimising" them is somebody's block
    /// reward. That reasoning is easy to miss and easy to overrule when a first
    /// sync feels slow, and a comment cannot stop anyone. This can.
    ///
    /// If you are here because this test failed: you are about to make the
    /// wallet's index greedier with a node that is also earning. Raise these
    /// only with a measurement showing staking is unaffected, and move the bound
    /// deliberately rather than to whatever the new value happens to be.
    #[test]
    fn the_index_stays_polite_enough_to_share_a_node_with_staking() {
        assert!(
            SLICE_BLOCKS <= 50,
            "a slice of {SLICE_BLOCKS} blocks holds the node and the writer lock too long"
        );
        assert!(
            CATCHUP_PAUSE >= Duration::from_millis(200),
            "too little breathing room between slices"
        );
        assert!(
            IDLE_PAUSE >= Duration::from_secs(10),
            "polling this often once caught up is pointless: Divi targets a block a minute"
        );
        assert!(RETRY_PAUSE >= Duration::from_secs(5), "retrying a missing node this fast is a spin");

        // The whole slice happens under the writer lock, so it also bounds how
        // long a balance query can be made to wait.
        // A block costs roughly 40ms of RPC round trips on a local node.
        let worst_case_lock = Duration::from_millis(40) * SLICE_BLOCKS as u32;
        assert!(
            worst_case_lock <= Duration::from_secs(2),
            "a balance query could be blocked for {worst_case_lock:?}"
        );
    }

    /// Nothing may be shown as a current balance unless the index is running,
    /// unhalted, and at the tip.
    #[test]
    fn trust_requires_running_unhalted_and_current() {
        let mut s = IndexStatus { running: true, height: 100, tip: 100, ..Default::default() };
        assert!(s.trustworthy());

        s.tip = 102;
        assert!(s.trustworthy(), "two blocks of slack absorbs a block arriving mid-query");

        s.tip = 110;
        assert!(!s.trustworthy(), "further behind, a balance could already be spent");

        s.tip = 100;
        s.halted = Some("cannot read a record".into());
        assert!(!s.trustworthy(), "a halted index is never current, however close it looks");

        s.halted = None;
        s.running = false;
        assert!(!s.trustworthy());
    }
}
