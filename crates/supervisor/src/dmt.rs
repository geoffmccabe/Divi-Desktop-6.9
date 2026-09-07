//! Divi Meta Tokens: creating and moving them from the wallet.
//!
//! Sits beside [`crate::names`] and [`crate::poe`] and uses [`crate::dvxp`] for
//! everything protocol-agnostic, exactly as they do.
//!
//! ## What this module does NOT contain
//!
//! **No record layouts.** Every byte comes from `dmt_indexer::encode`, the same
//! crate the indexer reads records with, vendored byte-identical from the chain
//! repo. A wallet with its own copy of a layout is a second implementation of
//! the format, and two implementations of one format eventually become two
//! formats. `dvxp-core` prevents that between indexers; this prevents it between
//! the indexer and the wallet.
//!
//! **No coin selection.** [`crate::dvxp::broadcast_record`] does it, pinned to
//! the author. See below.
//!
//! ## The rule that shapes every function here
//!
//! **A record's author is the address funding `vin[0]`.** Not the wallet, not
//! the signer, not the change address. So every call passes `from`, and change
//! returns to that same address, or the next record in a sequence could no
//! longer be funded by the identity the rules require.
//!
//! This is not theoretical. Running the encoders against a real chain for the
//! first time lost three of four records to exactly this: perfectly valid
//! records, mined, fees paid, and ignored, because ordinary coin selection had
//! funded them from a change address holding no tokens. Nothing tells the user.
//! Their balance simply does not move.
//!
//! ## Why every send is checked first
//!
//! An overlay record that breaks a rule is **ignored, not rejected**. The
//! transaction still confirms and the fee is still paid. From the user's side
//! that is indistinguishable from success until they look at their balance. So
//! anything that can be known locally is checked before a transaction is built,
//! and the answer is a sentence rather than an error code.

use serde_json::json;

use dmt_indexer::encode;
use dmt_indexer::record::TokenId;
use dvxp_core::codec::Address;

use crate::config::NodeConfig;
use crate::dvxp::{self, Payment};
use crate::rpc::RpcClient;

/// A token id as people write it: `height:tx_index` of the issuing transaction.
///
/// The ticker is a human alias on top; every record references this.
pub fn token_id_string(t: TokenId) -> String {
    format!("{}:{}", t.height, t.tx_index)
}

pub fn parse_token_id(s: &str) -> Result<TokenId, String> {
    let (h, i) = s
        .split_once(':')
        .ok_or("A token id looks like 306:2: the block it was created in, then its position in that block.")?;
    Ok(TokenId {
        height: h.trim().parse().map_err(|_| "That token id's block number is not a number.")?,
        tx_index: i.trim().parse().map_err(|_| "That token id's position is not a number.")?,
    })
}

/// Where token registry fees go, or a plain refusal.
///
/// Deliberately the same shape as [`crate::names::treasury_address`]: either a
/// real address or an error, never a placeholder that looks like an address.
///
/// The token crate's compiled-in treasury is still all zeroes, and the fee is
/// checked against it, so on a real chain a payment to an address nobody
/// controls would satisfy the fee. Returning an error rather than that address
/// is what stops the wallet participating in it.
pub fn treasury_address(chain: &str) -> Result<String, String> {
    treasury_address_with(chain, std::env::var("DIVI_DMT_TREASURY").ok().as_deref())
}

/// The decision itself, with the override passed in rather than read from the
/// environment.
///
/// Split out because reading a process-global inside the logic makes it
/// untestable: Rust runs tests in parallel threads of one process, so a test
/// that sets the variable changes what every other test sees. That is not a
/// hypothetical, it is the flaky failure that caught this.
pub fn treasury_address_with(chain: &str, configured: Option<&str>) -> Result<String, String> {
    if let Some(v) = configured {
        let v = v.trim();
        if !v.is_empty() {
            return Ok(v.to_string());
        }
    }
    if is_testnet_like(chain) {
        return Err(
            "No test treasury address is set. Set DIVI_DMT_TREASURY to an address before creating \
             tokens on this chain."
                .into(),
        );
    }
    Err(
        "Creating tokens is not open yet: the treasury address for token fees has not been set in \
         this build. Creating one now would send the fee somewhere unrecoverable, so the wallet \
         refuses."
            .into(),
    )
}

/// Matches `names.rs`, deliberately. Two modules disagreeing about what counts
/// as a test chain is how one of them ends up refusing a fee the other allows.
fn is_testnet_like(chain: &str) -> bool {
    chain != "main"
}

/// Which chain the node is actually on. Asked rather than assumed: a wallet that
/// guessed mainnet on a regtest node would refuse to work, and one that guessed
/// the other way would be far worse.
fn chain_name(rpc: &RpcClient) -> String {
    rpc.call("getblockchaininfo", json!([]))
        .ok()
        .and_then(|v| v["chain"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "main".into())
}

/// Resolve a Divi address string to the 21-byte form records use.
///
/// Uses the scanner's decoder, so the wallet and the indexer agree on what an
/// address is, including on testnet and regtest.
fn address_of(s: &str) -> Result<Address, String> {
    dvxp_scan::parse::addr_from_str(s.trim())
        .ok_or_else(|| format!("{s} is not a Divi address, so nothing was sent."))
}

/// What the wallet knows before it spends anything.
#[derive(Debug, Clone)]
pub struct PreflightWarning {
    pub blocking: bool,
    pub message: String,
}

/// Checks that need no index: does this address hold any DIVI to author with?
///
/// The index-dependent half (does this address hold enough of the token, is the
/// ticker taken, is the commit mature) needs a scanned ledger, which needs the
/// overlay genesis height to be set. Until then the wallet checks what it can
/// and says so rather than implying more assurance than it has.
fn preflight_author(rpc: &RpcClient, from: &str) -> Result<(), String> {
    let unspent = rpc.call("listunspent", json!([0, 9_999_999, [from]]))?;
    let total: f64 = unspent
        .as_array()
        .map(|a| a.iter().filter_map(|c| c["amount"].as_f64()).sum())
        .unwrap_or(0.0);
    if total <= 0.0 {
        return Err(format!(
            "{from} has no DIVI to spend, so it cannot author this record. A token record is \
             attributed to whichever address pays for the transaction, so it has to be funded \
             from the address that owns the tokens."
        ));
    }
    Ok(())
}

/// Create a token.
///
/// `ticker` may be empty: a token always has a numeric id and works without a
/// name, and the name is separately priced. Claiming one is a two-step
/// commit-then-reveal, so this refuses a ticker outright rather than half-doing
/// it; see [`commit_ticker`].
#[allow(clippy::too_many_arguments)]
pub fn create_token(
    cfg: &NodeConfig,
    from: &str,
    premine: u64,
    decimals: u8,
    fee_divi: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    let treasury = treasury_address(&chain_name(&rpc))?;

    let issue = dmt_indexer::record::issue::Issue {
        flags: 0,
        decimals,
        ticker: Vec::new(),
        salt: None,
        premine,
        terms: None,
        metadata_ptr: None,
    };

    // Refused here rather than after a fee has been paid. The encoder applies
    // the same checks the indexer would on the way in.
    let payload = encode::issue(&issue).map_err(|e| e.to_string())?;

    let fee = dmt_indexer::fees::token_creation_fee_duffs() as f64 / 1e8;
    let sent = dvxp::broadcast_record(
        &rpc,
        &payload,
        &[Payment { address: treasury, divi: fee }],
        fee_divi,
        Some(from),
    )?;
    Ok(sent.txid)
}

/// Send tokens to one address.
pub fn send_tokens(
    cfg: &NodeConfig,
    from: &str,
    token: &str,
    amount: u64,
    to: &str,
    fee_divi: f64,
) -> Result<String, String> {
    if amount == 0 {
        return Err("Sending zero of something moves nothing.".into());
    }
    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    let id = parse_token_id(token)?;
    let recipient = address_of(to)?;
    let payload = encode::send(id, amount, recipient).map_err(|e| e.to_string())?;

    let sent = dvxp::broadcast_record(&rpc, &payload, &[], fee_divi, Some(from))?;
    Ok(sent.txid)
}

/// Send one token to many addresses in a single record.
///
/// Divi's 603-byte data output is 7.5 times Bitcoin's, which is what makes an
/// airdrop fit in one record at all. It is still finite: the encoder refuses a
/// list that does not fit rather than truncating it, and the message says so, so
/// a caller batching a large airdrop knows to split.
pub fn airdrop(
    cfg: &NodeConfig,
    from: &str,
    token: &str,
    payouts: &[(String, u64)],
    fee_divi: f64,
) -> Result<String, String> {
    if payouts.is_empty() {
        return Err("An airdrop with no recipients moves nothing.".into());
    }
    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    let id = parse_token_id(token)?;
    let mut group = dmt_indexer::record::transfer::Group { token: id, payouts: Vec::new() };
    for (addr, amount) in payouts {
        if *amount == 0 {
            return Err(format!("The amount for {addr} is zero, so that line moves nothing."));
        }
        group
            .payouts
            .push(dmt_indexer::record::transfer::Payout { amount: *amount, to: address_of(addr)? });
    }

    let transfer = dmt_indexer::record::transfer::Transfer { groups: vec![group] };
    let payload = encode::transfer(&transfer).map_err(|e| e.to_string())?;

    let sent = dvxp::broadcast_record(&rpc, &payload, &[], fee_divi, Some(from))?;
    Ok(sent.txid)
}

/// Destroy units permanently. The only record that ever does.
pub fn burn_tokens(
    cfg: &NodeConfig,
    from: &str,
    token: &str,
    amount: u64,
    fee_divi: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    let id = parse_token_id(token)?;
    let payload = encode::burn(id, amount).map_err(|e| e.to_string())?;

    let sent = dvxp::broadcast_record(&rpc, &payload, &[], fee_divi, Some(from))?;
    Ok(sent.txid)
}

/// Freeze a token's supply permanently. Issuer only, and irreversible.
pub fn lock_supply(
    cfg: &NodeConfig,
    from: &str,
    token: &str,
    fee_divi: f64,
) -> Result<String, String> {
    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    let id = parse_token_id(token)?;
    let payload = encode::lock_supply(id).map_err(|e| e.to_string())?;

    let sent = dvxp::broadcast_record(&rpc, &payload, &[], fee_divi, Some(from))?;
    Ok(sent.txid)
}

/// Reserve a ticker, about twelve minutes before revealing it.
///
/// Front-running protection, not a delay to apologise for: it turns a mempool
/// race, which an attacker wins by paying a higher fee, into a twelve-block
/// reorg, which Divi's hard hundred-block cap makes impossible.
///
/// Returns the salt alongside the txid. **The caller must keep the salt**: the
/// reveal cannot be built without it, and it is not recoverable from the chain.
pub fn commit_ticker(
    cfg: &NodeConfig,
    from: &str,
    ticker: &str,
    fee_divi: f64,
) -> Result<(String, [u8; 20]), String> {
    let name = ticker.trim().to_ascii_uppercase();
    dmt_indexer::ticker::validate(name.as_bytes())
        .map_err(|_| format!("{name} is not a usable ticker."))?;

    let rpc = RpcClient::new(cfg);
    preflight_author(&rpc, from)?;

    // From a real CSPRNG. A salt derived from a timestamp would be guessable,
    // and a guessable salt defeats the commitment entirely.
    let mut salt = [0u8; 20];
    getrandom::getrandom(&mut salt)
        .map_err(|_| "Could not generate a secure salt, so nothing was sent.")?;

    let commitment = encode::commitment_of(&salt, name.as_bytes());
    let payload = encode::name_commit(&commitment).map_err(|e| e.to_string())?;

    let sent = dvxp::broadcast_record(&rpc, &payload, &[], fee_divi, Some(from))?;
    Ok((sent.txid, salt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_ids_round_trip_in_the_form_people_read() {
        let id = TokenId { height: 4_131_200, tx_index: 3 };
        assert_eq!(token_id_string(id), "4131200:3");
        assert_eq!(parse_token_id("4131200:3").unwrap(), id);
        // Whitespace from a copy and paste should not defeat it.
        assert_eq!(parse_token_id(" 4131200 : 3 ").unwrap(), id);
    }

    /// The error a person sees has to say what to do, not name a parser.
    #[test]
    fn a_bad_token_id_explains_the_shape_rather_than_failing_silently() {
        let e = parse_token_id("nonsense").unwrap_err();
        assert!(e.contains("306:2"), "the message should show the shape: {e}");
        assert!(parse_token_id("4131200").is_err());
        assert!(parse_token_id("4131200:x").is_err());
    }

    #[test]
    fn addresses_from_other_chains_are_refused() {
        assert!(address_of("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").is_err());
        assert!(address_of("DPqBoHatvxSTvxdCyEMWtRoRtEt2xjcHUb").is_ok());
        // Regtest and testnet must work, or the feature cannot be tested off
        // mainnet, which is the one place you would want it proven first.
        assert!(address_of("yCsJe6YGB4My3xiQjyUU4dC2Gc7v1H8Cna").is_ok());
    }

    /// A placeholder treasury must never be handed out as if it were real.
    ///
    /// Takes the override as an argument rather than setting an environment
    /// variable, so it cannot interfere with any other test running beside it.
    #[test]
    fn the_treasury_refuses_rather_than_returning_a_placeholder() {
        let mainnet = treasury_address_with("main", None);
        assert!(mainnet.is_err(), "mainnet has no treasury set in this build");
        assert!(mainnet.unwrap_err().contains("unrecoverable"));

        let test = treasury_address_with("regtest", None);
        assert!(test.is_err());
        assert!(test.unwrap_err().contains("DIVI_DMT_TREASURY"));

        // An empty setting is not a setting.
        assert!(treasury_address_with("regtest", Some("   ")).is_err());
    }

    #[test]
    fn a_configured_treasury_is_used_on_either_chain() {
        let addr = "yCsJe6YGB4My3xiQjyUU4dC2Gc7v1H8Cna";
        assert_eq!(treasury_address_with("regtest", Some(addr)).unwrap(), addr);
        assert_eq!(treasury_address_with("main", Some(addr)).unwrap(), addr);
        // Whitespace from a copy and paste should not defeat it.
        assert_eq!(treasury_address_with("main", Some("  yCsJe6YGB4My3xiQjyUU4dC2Gc7v1H8Cna ")).unwrap(), addr);
    }
}
