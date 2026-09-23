use crate::config::NodeConfig;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;

/// One shared, connection-pooling agent for the whole app. The legacy node's RPC
/// server drops connections under churn (a new socket per call overwhelms its
/// accept loop — "RPCAcceptHandler: Invalid argument"), so we keep connections
/// alive and reuse them instead of opening a fresh one for every request.
///
/// The idle pool is capped well below the node's rpcthreads (16). That server
/// dedicates one worker thread to each kept-alive connection, so if the app held
/// as many idle connections as the node has threads, none would be left to
/// answer new requests and the RPC would appear dead while the node is healthy.
/// A small pool leaves most threads free.
/* ---- HOW MANY CALLS AT ONCE ----
   The node answers on sixteen threads and every kept-alive connection from
   here pins one of them. The interface has two dozen panels polling on their
   own clocks, and the moment they all ask together (a node switch remounts
   every one of them) the node has no thread left for the call that matters:
   Geoff's 5,000 DIVI send sat behind the pollers until the read timed out.
   So at most this many RPC calls are in flight from this process; the rest
   wait their turn here, in order, instead of piling onto the node. Sends
   still queue, but they are never refused for want of a thread. */
const MAX_IN_FLIGHT: usize = 6;

struct Gate {
    busy: Mutex<usize>,
    free: Condvar,
}

fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(|| Gate { busy: Mutex::new(0), free: Condvar::new() })
}

struct Slot;
impl Slot {
    fn take() -> Slot {
        let g = gate();
        let mut n = g.busy.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= MAX_IN_FLIGHT {
            n = g.free.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Slot
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        let g = gate();
        let mut n = g.busy.lock().unwrap_or_else(|e| e.into_inner());
        *n = n.saturating_sub(1);
        g.free.notify_one();
    }
}

/// Calls that make the node do real work on a big wallet: a send on a wallet
/// with thousands of coins can take longer than the ordinary read timeout,
/// and cutting it off does not stop the node, it only loses the answer.
fn is_slow_call(method: &str) -> bool {
    matches!(method, "sendtoaddress" | "sendmany" | "walletpassphrase" | "sendrawtransaction" | "fundrawtransaction")
}

/* ---- WHICH REQUEST WEDGED THE NODE ----
   Three days running (2026-Sep-21, 22, 23) Geoff's node stopped answering
   while still following the chain. A thread sample showed why: one RPC
   request spinning at full CPU for hours with the node's main lock held, so
   every other request queued behind it for ever. The node program ships
   without symbols, so the sample could not say WHICH request. This can: any
   request that takes longer than a few seconds, or never answers, is written
   to the setup log by name. The wedge then names itself. Timeouts are noted
   once per request name every few minutes, because a wedged node fails every
   poll and the log would otherwise fill with the same line. */
const SLOW_AFTER: Duration = Duration::from_secs(5);
const TIMEOUT_NOTE_EVERY: Duration = Duration::from_secs(300);

fn note_slow(method: &str, took: Duration, no_answer: bool) {
    if took < SLOW_AFTER {
        return;
    }
    let secs = took.as_secs();
    if !no_answer {
        crate::setuplog::log(format!("rpc: {method} took {secs}s to answer"));
        return;
    }
    static LAST: OnceLock<Mutex<std::collections::HashMap<String, std::time::Instant>>> = OnceLock::new();
    let mut last = LAST.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    let due = last.get(method).map_or(true, |t| now.duration_since(*t) >= TIMEOUT_NOTE_EVERY);
    if due {
        last.insert(method.to_string(), now);
        crate::setuplog::log(format!("rpc: {method} gave no answer after {secs}s"));
    }
}

fn slow_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(8))
            .timeout_read(Duration::from_secs(180))
            .timeout_write(Duration::from_secs(30))
            .max_idle_connections(2)
            .max_idle_connections_per_host(2)
            .build()
    })
}

fn shared_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(8))
            .timeout_read(Duration::from_secs(30))
            .timeout_write(Duration::from_secs(30))
            .max_idle_connections(6)
            .max_idle_connections_per_host(6)
            .build()
    })
}

/// What came back when we took the node's pulse.
///
/// Three outcomes, not two, because the cure for one of them is the disease
/// for the others: restarting a node that is merely still loading its chain
/// index throws away the loading work and starts it again, forever.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pulse {
    /// It replied — including a refusal like "still starting up". It is alive.
    Answered,
    /// The RPC port accepted a connection and then nothing came back. This,
    /// and only this, is a wedge.
    Silent,
    /// Nothing is listening on the RPC port yet: still loading, or shutting
    /// down. Not a fault, and never a reason to restart.
    NotListening,
}

/// Minimal JSON-RPC client for the local divid. Local loopback only.
pub struct RpcClient {
    url: String,
    auth: String,
    host: String,
    port: u16,
}

/// Project rule: no raw daemon error ever reaches a user. Errors are turned
/// into a plain sentence here, at the boundary, so every caller inherits it.
fn humanize(code: i64, msg: &str) -> String {
    match code {
        -28 => format!("The node is still starting up ({}).", msg.trim_end_matches("...")),
        -13 => "The wallet is locked — unlock it first.".into(),
        -6 => "Not enough funds for that.".into(),
        _ => msg.to_string(),
    }
}

impl RpcClient {
    pub fn new(cfg: &NodeConfig) -> Self {
        let token = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", cfg.rpc_user, cfg.rpc_pass));
        RpcClient {
            url: format!("http://{}:{}/", cfg.rpc_host, cfg.rpc_port),
            auth: format!("Basic {}", token),
            host: cfg.rpc_host.clone(),
            port: cfg.rpc_port,
        }
    }

    /// A one-shot health check with a short deadline and its OWN connection.
    ///
    /// Deliberately not pooled: the pooled agents keep connections alive, and a
    /// kept-alive connection occupies one of the node's worker threads for as
    /// long as it lives. Using the pool to ask "are you alive?" would make the
    /// watchdog part of the very problem it exists to detect. This opens a
    /// connection, asks, and closes it.
    ///
    /// The question is "does it answer at all", not "is it quick", so a short
    /// timeout is the point: a wedged node never answers however long we wait.
    pub fn pulse(&self, timeout: Duration) -> Pulse {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(4))
            .timeout_read(timeout)
            .timeout_write(Duration::from_secs(4))
            .max_idle_connections(0)
            .build();
        let body = json!({"jsonrpc":"1.0","id":"pulse","method":"getblockcount","params":[]});
        match agent
            .post(&self.url)
            .set("Authorization", &self.auth)
            .set("Connection", "close")
            .send_string(&body.to_string())
        {
            Ok(_) => Pulse::Answered,
            // A node still starting up DID answer; that is not a wedge.
            Err(ureq::Error::Status(_, _)) => Pulse::Answered,
            // Nothing came back. WHY matters enormously, and the old code threw
            // that away by returning a bare false. A refused connection means
            // the RPC server is not up — a node still loading the chain index,
            // or one on its way out — and restarting either is pointless or
            // harmful. Only a connection that is ACCEPTED and then goes silent
            // is the wedge this watchdog exists for.
            // Deciding WHICH of the two it is from ureq's error text would be
            // guesswork, so we ask the socket directly instead. It is one
            // connect, and it is unambiguous.
            Err(_) => {
                if self.port_accepts(Duration::from_secs(4)) {
                    Pulse::Silent
                } else {
                    Pulse::NotListening
                }
            }
        }
    }

    /// Can anything at all be connected to on the RPC port?
    fn port_accepts(&self, timeout: Duration) -> bool {
        use std::net::{TcpStream, ToSocketAddrs};
        let Ok(mut addrs) = (self.host.as_str(), self.port).to_socket_addrs() else {
            return false;
        };
        addrs.any(|a| TcpStream::connect_timeout(&a, timeout).is_ok())
    }

    // Send the request and return the full JSON-RPC envelope ({result, error}),
    // or Err only on a transport/parse failure.
    fn send(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "1.0", "id": "dd69", "method": method, "params": params});
        // Reuse a pooled keep-alive connection (see shared_agent). The 30s read
        // timeout tolerates the node's bursty spells; these run off the UI thread
        // (spawn_blocking) so waiting never freezes anything.
        let _slot = Slot::take();
        let agent = if is_slow_call(method) { slow_agent() } else { shared_agent() };
        let started = std::time::Instant::now();
        let resp = agent
            .post(&self.url)
            .set("Authorization", &self.auth)
            .send_string(&body.to_string());
        note_slow(method, started.elapsed(), resp.is_err() && !matches!(resp, Err(ureq::Error::Status(_, _))));
        // Every RPC call in the app funnels through here, which makes this the
        // one honest place to tell the map whether the node is answering. A
        // non-200 with a JSON body still means the node ANSWERED: it disagreed
        // with us, which is not the same as being unreachable.
        let text = match resp {
            Ok(r) => {
                crate::mapfeed::node_answered();
                r.into_string().map_err(|e| e.to_string())?
            }
            // divid returns RPC errors with non-200 status but a JSON body.
            Err(ureq::Error::Status(_, r)) => {
                crate::mapfeed::node_answered();
                r.into_string().map_err(|e| e.to_string())?
            }
            Err(e) => {
                crate::mapfeed::node_silent(&format!("{method} did not answer"));
                return Err(format!("cannot reach the node: {e}"));
            }
        };
        serde_json::from_str(&text).map_err(|_| "the node sent an unreadable reply".to_string())
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let v = self.send(method, params)?;
        if !v["error"].is_null() {
            let code = v["error"]["code"].as_i64().unwrap_or(0);
            let msg = v["error"]["message"].as_str().unwrap_or("unknown node error");
            return Err(humanize(code, msg));
        }
        Ok(v["result"].clone())
    }

    /// Like `call`, but returns Ok(None) when the node doesn't recognize the
    /// method (JSON-RPC "Method not found", -32601). This is how we prefer the
    /// new soft-fork RPCs (createpoe/verifypoe) and fall back cleanly to the
    /// forkless path on any node that hasn't shipped them yet.
    pub fn call_optional(&self, method: &str, params: Value) -> Result<Option<Value>, String> {
        let v = self.send(method, params)?;
        if !v["error"].is_null() {
            let code = v["error"]["code"].as_i64().unwrap_or(0);
            if code == -32601 {
                return Ok(None);
            }
            let msg = v["error"]["message"].as_str().unwrap_or("unknown node error");
            return Err(humanize(code, msg));
        }
        Ok(Some(v["result"].clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_error_is_humanized() {
        let s = humanize(-28, "Loading block index...");
        assert!(s.contains("starting up"));
        assert!(!s.contains("-28"));
    }
}
