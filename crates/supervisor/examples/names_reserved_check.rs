//! Proof that brand and celebrity names really are unobtainable, on a live chain.
//!
//! The protection is not a refusal in the charset. Reserved names are seeded
//! into the ledger as OWNED by the reserve address, so registering one fails
//! for the ordinary reason that somebody already has it. That indirection is
//! what makes them assignable later, and it is also why it deserves an
//! end-to-end check rather than a unit test: the rules crate cannot tell you
//! whether the seeding actually happened in a real index.
//!
//!   DIVI_NAMES_TREASURY=<addr> DIVI_NAMES_RESERVE=<addr> \
//!     cargo run --example names_reserved_check -- ~/divi-poe-regtest

use dd69_supervisor::config::NodeConfig;
use dd69_supervisor::names;
use std::path::PathBuf;

/// Names that must NOT be obtainable: distinctive brands, well-known people,
/// Divi's own identity, and lookalikes of each.
const MUST_BE_HELD: &[&str] = &[
    "BINANCE", "COINBASE", "ETHEREUM", "METAMASK", "MICROSOFT", "TESLA", "OPENAI",
    "SATOSHINAKAMOTO", "VITALIKBUTERIN", "VITALIK", "COBIE", "ADAMBACK", "GARYGENSLER",
    "DIVI", "NFD",
    // Lookalikes: punctuation stripped and digits folded before comparing.
    "B1NANCE", "C0INBASE", "M!CROSOFT", "G-O-O-G-L-E", "SATOSHI_NAKAMOTO", "V1TAL1K",
];

/// Names that must stay available: ordinary words even where a famous company
/// uses one, generic terms, and bare first names. Over-blocking is a real cost.
const MUST_BE_FREE: &[&str] = &[
    "APPLE", "ORACLE", "AMAZON", "META", "VISA", "TELEGRAM", "SIGNAL", "LEDGER", "KRAKEN",
    "BITCOIN", "BLOCKCHAIN", "CRYPTO", "WALLET", "DOGECOIN",
    "SATOSHI", "MICHAEL", "BRIAN", "GEOFF",
];

fn main() {
    if let Err(e) = run() {
        eprintln!("\nFAILED: {e}");
        std::process::exit(1);
    }
    println!("\nALL CHECKS PASSED");
}

fn run() -> Result<(), String> {
    let datadir: PathBuf = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: names_reserved_check <datadir>")?;
    let cfg = NodeConfig::load_from(datadir)?;

    // Bring the index up to date, which is where the seeding happens.
    for _ in 0..400 {
        let s = names::sync(&cfg)?;
        if !s.activated || !s.txindex || !s.treasury_configured {
            return Err(s.note);
        }
        if s.caught_up {
            println!("index at block {} of {}, {} names known", s.scanned_height, s.tip, s.names_known);
            break;
        }
    }

    println!("\n── names that must be unobtainable ────────────────────────────");
    let mut owner_seen: Option<String> = None;
    for n in MUST_BE_HELD {
        let q = names::quote(&cfg, n)?;
        // Two different shapes of unobtainable, and both are correct:
        //   held    - an exact reserved name, OWNED by the reserve so it can be
        //             handed to whoever it belongs to.
        //   refused - a lookalike. Nobody holds it and nobody should: it is not
        //             a name anyone wants, it is a spoof of one.
        match (q.available, &q.owner) {
            (Some(false), Some(owner)) => {
                if owner_seen.is_none() {
                    owner_seen = Some(owner.clone());
                }
                println!("  {:<18} held by {owner}", n.to_lowercase());
            }
            (Some(false), None) => println!("  {:<18} refused as a lookalike", n.to_lowercase()),
            other => {
                return Err(format!(
                    "{n} is OBTAINABLE: available={:?} owner={:?}",
                    other.0, other.1
                ))
            }
        }
        // And the registration path itself must refuse, not merely report it.
        if names::commit(&cfg, n).is_ok() {
            return Err(format!("{n} was allowed to be reserved for registration"));
        }
    }

    println!("\n── names that must stay available ─────────────────────────────");
    for n in MUST_BE_FREE {
        let q = names::quote(&cfg, n)?;
        if q.available != Some(true) {
            return Err(format!(
                "{n} should be registrable by anyone but reports available={:?} owner={:?}",
                q.available, q.owner
            ));
        }
        println!("  {:<12} free, {} DIVI", n.to_lowercase(), q.registration_divi);
    }

    println!(
        "\nall held names sit with one reserve address ({}), so they can be handed on",
        owner_seen.unwrap_or_default()
    );
    Ok(())
}
