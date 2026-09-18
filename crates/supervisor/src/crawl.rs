// ── Speaking Divi to other nodes, directly ─────────────────────────────────
//
// Two questions the wallet could not previously answer:
//
//   1. "Is that node actually working?" The old check opened a TCP connection
//      and called that alive. Anything listening on the port passes that test:
//      a firewall, a load balancer, a web server, a node stuck mid-startup.
//      Here we complete a real Divi handshake, so alive means it spoke Divi.
//
//   2. "Who else is out there?" A node only knows machines it dialled itself.
//      Its address book is not reachable over RPC in Divi 3.0.0.0 (the method
//      does not exist), so the wallet could never see beyond its own ~45 peers.
//      But every node will HAND OVER its address book to another node that asks
//      in the protocol. So we ask, as a node would.
//
// This is an ordinary peer-to-peer conversation, the same one nodes have with
// each other constantly. We connect, introduce ourselves, ask the standard
// question, read the answer and disconnect. Nothing is sent that a normal node
// would not send, and nothing about the user's wallet ever goes over it.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Divi mainnet message prefix, from chainparams.cpp. Every message starts with
/// it; a reply that doesn't is not a Divi node.
const MAGIC: [u8; 4] = [0xdf, 0xa0, 0x8d, 0x8f];
pub const P2P_PORT: u16 = 51472;

const PROTOCOL_VERSION: i32 = 70915;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(2500);
const READ_TIMEOUT: Duration = Duration::from_millis(3500);
/// A cap on one peer's reply. Their address book can be large and we have no
/// reason to read an unbounded amount from a stranger.
const MAX_REPLY_BYTES: usize = 512 * 1024;

pub struct CrawlResult {
    pub ip: String,
    /// Completed a Divi handshake. NOT merely "the port answered".
    pub alive: bool,
    /// What it calls itself, e.g. "DIVI Core: 3.0.0.0". Empty if it didn't say.
    pub subver: String,
    /// Its best block height, as it claims.
    pub height: i64,
    /// Addresses it knows about. These are the nodes we could not otherwise see.
    pub addrs: Vec<String>,
}

fn sha256d(data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let first = Sha256::digest(data);
    let second = Sha256::digest(first);
    let mut out = [0u8; 32];
    out.copy_from_slice(&second);
    out
}

/// magic + 12-byte command + length + first 4 bytes of the double hash.
fn frame(command: &str, payload: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(24 + payload.len());
    msg.extend_from_slice(&MAGIC);
    let mut cmd = [0u8; 12];
    cmd[..command.len()].copy_from_slice(command.as_bytes());
    msg.extend_from_slice(&cmd);
    msg.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    msg.extend_from_slice(&sha256d(payload)[..4]);
    msg.extend_from_slice(payload);
    msg
}

fn write_varint(out: &mut Vec<u8>, n: u64) {
    if n < 0xfd {
        out.push(n as u8);
    } else if n <= 0xffff {
        out.push(0xfd);
        out.extend_from_slice(&(n as u16).to_le_bytes());
    } else if n <= 0xffff_ffff {
        out.push(0xfe);
        out.extend_from_slice(&(n as u32).to_le_bytes());
    } else {
        out.push(0xff);
        out.extend_from_slice(&n.to_le_bytes());
    }
}

fn read_varint(buf: &[u8], at: &mut usize) -> Option<u64> {
    let first = *buf.get(*at)?;
    *at += 1;
    Some(match first {
        0xfd => {
            let v = u16::from_le_bytes(buf.get(*at..*at + 2)?.try_into().ok()?) as u64;
            *at += 2;
            v
        }
        0xfe => {
            let v = u32::from_le_bytes(buf.get(*at..*at + 4)?.try_into().ok()?) as u64;
            *at += 4;
            v
        }
        0xff => {
            let v = u64::from_le_bytes(buf.get(*at..*at + 8)?.try_into().ok()?);
            *at += 8;
            v
        }
        n => n as u64,
    })
}

/// A network address as it appears inside a version message: services, then a
/// 16-byte address, then the port. We send zeroes: we are not advertising
/// ourselves, only asking a question.
fn push_blank_addr(out: &mut Vec<u8>) {
    out.extend_from_slice(&0u64.to_le_bytes()); // services
    out.extend_from_slice(&[0u8; 16]); // address
    out.extend_from_slice(&0u16.to_be_bytes()); // port
}

fn version_payload() -> Vec<u8> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut p = Vec::with_capacity(96);
    p.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    p.extend_from_slice(&0u64.to_le_bytes()); // our services: none, we relay nothing
    p.extend_from_slice(&now.to_le_bytes());
    push_blank_addr(&mut p); // them
    push_blank_addr(&mut p); // us
    p.extend_from_slice(&0u64.to_le_bytes()); // nonce
    // Identify honestly as the wallet doing a network check, rather than
    // impersonating a core node.
    let agent = b"/DD69-netcheck:1.0/";
    write_varint(&mut p, agent.len() as u64);
    p.extend_from_slice(agent);
    p.extend_from_slice(&0i32.to_le_bytes()); // start height
    p.push(0); // do not relay transactions to us
    p
}

/// One decoded message: (command, payload).
fn next_message(buf: &[u8], at: &mut usize) -> Option<(String, Vec<u8>)> {
    if buf.len() < *at + 24 {
        return None;
    }
    if buf[*at..*at + 4] != MAGIC {
        return None; // not Divi, or we have lost framing: stop rather than guess
    }
    let cmd_bytes = &buf[*at + 4..*at + 16];
    let end = cmd_bytes.iter().position(|b| *b == 0).unwrap_or(12);
    let command = String::from_utf8_lossy(&cmd_bytes[..end]).to_string();
    let len = u32::from_le_bytes(buf[*at + 16..*at + 20].try_into().ok()?) as usize;
    if len > MAX_REPLY_BYTES || buf.len() < *at + 24 + len {
        return None;
    }
    let payload = buf[*at + 24..*at + 24 + len].to_vec();
    *at += 24 + len;
    Some((command, payload))
}

/// Decode an `addr` message into plain IP strings. Entries are
/// timestamp + services + 16-byte address + port; IPv4 sits inside the IPv6
/// form with the standard prefix.
fn parse_addr(payload: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = 0usize;
    let Some(count) = read_varint(payload, &mut at) else {
        return out;
    };
    for _ in 0..count.min(1000) {
        if payload.len() < at + 30 {
            break;
        }
        let ip = &payload[at + 12..at + 28];
        at += 30;
        // ::ffff:a.b.c.d — an IPv4 address in IPv6 clothing.
        if ip[..12] == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff] {
            let v4 = format!("{}.{}.{}.{}", ip[12], ip[13], ip[14], ip[15]);
            if !v4.starts_with('0') {
                out.push(v4);
            }
        }
        // IPv6 nodes are skipped: the rest of the wallet, the geo cache and the
        // map all key on IPv4 today, so adding them here would produce entries
        // nothing downstream could place or draw.
    }
    out
}

/// Talk to one node: handshake, then ask for its address book.
pub fn crawl_one(ip: &str, want_addrs: bool) -> CrawlResult {
    let mut r = CrawlResult {
        ip: ip.to_string(),
        alive: false,
        subver: String::new(),
        height: 0,
        addrs: Vec::new(),
    };

    let Some(sa) = format!("{ip}:{P2P_PORT}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
    else {
        return r;
    };
    let Ok(mut s) = TcpStream::connect_timeout(&sa, CONNECT_TIMEOUT) else {
        return r;
    };
    let _ = s.set_read_timeout(Some(READ_TIMEOUT));
    let _ = s.set_write_timeout(Some(READ_TIMEOUT));

    if s.write_all(&frame("version", &version_payload())).is_err() {
        return r;
    }

    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut shook = false;
    let mut asked = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(9);

    while std::time::Instant::now() < deadline && buf.len() < MAX_REPLY_BYTES {
        match s.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break, // timeout: whatever we have is what we get
        }

        let mut at = 0usize;
        while let Some((cmd, payload)) = next_message(&buf, &mut at) {
            match cmd.as_str() {
                "version" => {
                    // It answered in Divi. That alone is more than the old TCP
                    // check ever established.
                    r.alive = true;
                    let mut p = 80usize; // version..nonce is a fixed-size prefix
                    if let Some(len) = read_varint(&payload, &mut p) {
                        let end = p + len as usize;
                        if let Some(sv) = payload.get(p..end) {
                            r.subver = String::from_utf8_lossy(sv).to_string();
                            if let Some(h) = payload.get(end..end + 4) {
                                r.height = i32::from_le_bytes(h.try_into().unwrap_or([0; 4])) as i64;
                            }
                        }
                    }
                    let _ = s.write_all(&frame("verack", &[]));
                }
                "verack" => {
                    shook = true;
                    if want_addrs && !asked {
                        asked = true;
                        let _ = s.write_all(&frame("getaddr", &[]));
                    }
                }
                "ping" => {
                    // Answer so they keep talking to us long enough to reply.
                    let _ = s.write_all(&frame("pong", &payload));
                }
                "addr" => {
                    r.addrs.extend(parse_addr(&payload));
                    if !r.addrs.is_empty() {
                        // One good answer is enough; don't linger on a stranger.
                        buf.drain(..at);
                        return r;
                    }
                }
                _ => {}
            }
        }
        buf.drain(..at);
        if shook && !want_addrs {
            break;
        }
    }
    r
}

/// Check many nodes at once, with a bounded worker pool.
///
/// `ask_count` peers are also asked for their address books. Asking everyone
/// would be slow and needlessly noisy; a handful of answers already reaches far
/// beyond what our own node can see, because each reply describes a different
/// slice of the network.
pub fn crawl(ips: &[String], ask_count: usize) -> Vec<CrawlResult> {
    use std::sync::{Arc, Mutex};
    let queue: Arc<Mutex<Vec<(String, bool)>>> = Arc::new(Mutex::new(
        ips.iter()
            .take(600)
            .enumerate()
            .map(|(i, ip)| (ip.clone(), i < ask_count))
            .rev()
            .collect(),
    ));
    let out: Arc<Mutex<Vec<CrawlResult>>> = Arc::new(Mutex::new(Vec::new()));
    let workers = 24.min(ips.len().max(1));

    let handles: Vec<_> = (0..workers)
        .map(|_| {
            let queue = Arc::clone(&queue);
            let out = Arc::clone(&out);
            std::thread::spawn(move || loop {
                let Some((ip, ask)) = queue.lock().ok().and_then(|mut q| q.pop()) else {
                    return;
                };
                let r = crawl_one(&ip, ask);
                if let Ok(mut o) = out.lock() {
                    o.push(r);
                }
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    Arc::try_unwrap(out)
        .ok()
        .and_then(|m| m.into_inner().ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_matches_the_protocol() {
        let m = frame("verack", &[]);
        assert_eq!(&m[..4], &MAGIC);
        assert_eq!(&m[4..10], b"verack");
        assert_eq!(&m[16..20], &0u32.to_le_bytes()); // empty payload
        // Checksum of the empty payload is the first 4 bytes of sha256d("").
        assert_eq!(&m[20..24], &sha256d(&[])[..4]);
        assert_eq!(m.len(), 24);
    }

    #[test]
    fn varints_round_trip() {
        for n in [0u64, 1, 0xfc, 0xfd, 0xffff, 0x1_0000, 0xffff_ffff, 0x1_0000_0000] {
            let mut b = Vec::new();
            write_varint(&mut b, n);
            let mut at = 0;
            assert_eq!(read_varint(&b, &mut at), Some(n), "value {n}");
            assert_eq!(at, b.len());
        }
    }

    #[test]
    fn addr_message_yields_ipv4_and_skips_v6() {
        let mut p = Vec::new();
        write_varint(&mut p, 2);
        // one IPv4-in-IPv6 entry
        p.extend_from_slice(&0u32.to_le_bytes()); // time
        p.extend_from_slice(&0u64.to_le_bytes()); // services
        p.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 203, 0, 113, 7]);
        p.extend_from_slice(&P2P_PORT.to_be_bytes());
        // one genuine IPv6 entry, which we deliberately ignore
        p.extend_from_slice(&0u32.to_le_bytes());
        p.extend_from_slice(&0u64.to_le_bytes());
        p.extend_from_slice(&[0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        p.extend_from_slice(&P2P_PORT.to_be_bytes());
        assert_eq!(parse_addr(&p), vec!["203.0.113.7".to_string()]);
    }

    #[test]
    fn a_reply_with_the_wrong_magic_is_not_decoded() {
        let mut m = frame("verack", &[]);
        m[0] ^= 0xff;
        let mut at = 0;
        assert!(next_message(&m, &mut at).is_none());
    }

    #[test]
    fn an_oversized_length_is_refused() {
        let mut m = frame("addr", &[]);
        m[16..20].copy_from_slice(&(u32::MAX).to_le_bytes());
        let mut at = 0;
        assert!(next_message(&m, &mut at).is_none());
    }
}
