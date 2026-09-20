// ── Telling the map what the supervisor itself is doing ────────────────────
//
// The interface can only draw what it starts. Everything the supervisor does on
// its own — every RPC call made while sending, staking or syncing — was
// invisible, which is why an RPC stall looked like the wallet had simply frozen
// rather than like the node had gone quiet.
//
// This crate deliberately does not depend on tauri, so it cannot talk to the
// webview. Instead it pushes small events into a channel; the app crate drains
// it and forwards them. The supervisor stays free of interface concerns.
//
// TELEMETRY MUST NEVER SLOW DOWN THE NODE PATH. The channel is bounded and
// every send is a try_send: when the interface is busy or nothing is listening,
// events are DROPPED rather than queued or blocked on. A missed animation is a
// non-event; a wallet stalled behind its own logging is not.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct MapFeedEvent {
    /// A trigger name from the interface's animation catalog, e.g. "self.ok".
    pub trigger: String,
    /// The node it concerns, when it concerns one.
    pub ip: Option<String>,
    /// Free text for the tooltip.
    pub detail: Option<String>,
}

static TX: OnceLock<SyncSender<MapFeedEvent>> = OnceLock::new();
static LAST_OK: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_HEIGHT: Mutex<Option<i64>> = Mutex::new(None);

/// Called once by the app crate at startup. Later calls return None.
pub fn subscribe() -> Option<Receiver<MapFeedEvent>> {
    let (tx, rx) = sync_channel(256);
    if TX.set(tx).is_ok() {
        Some(rx)
    } else {
        None
    }
}

fn push(trigger: &str, ip: Option<String>, detail: Option<String>) {
    if let Some(tx) = TX.get() {
        // Dropped when the queue is full. See the note at the top of the file.
        let _ = tx.try_send(MapFeedEvent {
            trigger: trigger.to_string(),
            ip,
            detail,
        });
    }
}

/// The node answered an RPC call.
///
/// Rate limited, because a busy wallet makes many calls a second and the map
/// only needs a heartbeat. Being rate limited does not make it dishonest: each
/// one that IS emitted is a real round-trip that really completed.
pub fn node_answered() {
    let now = Instant::now();
    {
        let mut last = LAST_OK.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = *last {
            if now.duration_since(t) < Duration::from_millis(1000) {
                return;
            }
        }
        *last = Some(now);
    }
    push("self.ok", None, None);
}

/// The node did NOT answer: a transport failure, a timeout, a refused socket.
///
/// Never rate limited. A stall is the single most useful thing the map can
/// show, and it is exactly the moment a dropped event would matter.
pub fn node_silent(reason: &str) {
    push("self.fail", None, Some(reason.to_string()));
}

/// How long since ANY ordinary RPC call came back, if one ever has.
///
/// Every call in the app funnels through `RpcClient::send`, which stamps this
/// on success, so it is the truest available answer to "is the node talking to
/// us". The watchdog leans on it rather than on a probe of its own: a probe
/// can fail for reasons of its own making (a fresh socket this node's ageing
/// accept loop dislikes, a timeout tuned too tight), and on 2026-Sep-20 one
/// did exactly that — it declared a node dead eighteen seconds after that node
/// had accepted a block in 28 milliseconds, and the restart that followed hung
/// the wallet for a quarter of an hour. Real traffic cannot lie in that way.
pub fn since_answer() -> Option<Duration> {
    let last = LAST_OK.lock().unwrap_or_else(|e| e.into_inner());
    last.map(|t| t.elapsed())
}

/// The chain moved. Emitted only on a genuine change of height, so a poll that
/// returns the same block produces nothing.
pub fn block_height(height: i64) {
    {
        let mut last = LAST_HEIGHT.lock().unwrap_or_else(|e| e.into_inner());
        if *last == Some(height) {
            return;
        }
        // The first reading is where we started, not an advance worth a ripple.
        let first = last.is_none();
        *last = Some(height);
        if first {
            return;
        }
    }
    push("self.block", None, Some(format!("Block {height}")));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_height_is_not_an_advance() {
        // Without a subscriber nothing is sent, but the de-duplication state
        // still has to behave: the first reading must not count as a change.
        *LAST_HEIGHT.lock().unwrap() = None;
        block_height(100);
        assert_eq!(*LAST_HEIGHT.lock().unwrap(), Some(100));
        block_height(100); // same height again — no change
        assert_eq!(*LAST_HEIGHT.lock().unwrap(), Some(100));
        block_height(101);
        assert_eq!(*LAST_HEIGHT.lock().unwrap(), Some(101));
    }
}
