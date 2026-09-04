// NFD cross-chain bridge -- Divi side. Issues the on-chain lock/release records
// for the Divi<->Diva NFT bridge and reports maturity for the fast self-transfer
// path. The record wire format and the trust phases are frozen in
// docs/NFD-BRIDGE-INTERFACE.md. This module reuses the collectibles codec + anchor
// path byte-for-byte (no re-implementation, per the spec's drift warning).
//
// Phase 1 is the single-coordinator correctness skeleton: BRIDGE_DIVI is a
// coordinator-controlled address and the Diva-side mint authorization is a single
// signature. The wire format does NOT change when this decentralizes to the 26/38
// POAS quorum -- only who holds BRIDGE_DIVI and how many sign.

use crate::collectibles::{address_to_packed, anchor_record, pick_owner_utxo, tx_confirmations};
use crate::config::NodeConfig;
use crate::nfd_record;
use crate::rpc::RpcClient;

/// Default Divi confirmations at which a bridged Diva token matures (unfreezes).
/// Configurable per lock; MUST stay below Divi's 100-block max-reorg cap.
pub const DEFAULT_MATURITY_CONFS: u32 = 10;

pub struct LockOutcome {
    pub txid: String,
    pub nonce: u64,
}

pub struct ReleaseOutcome {
    pub txid: String,
}

/// Maturity view of a lock: how deep the lock tx is and whether the Diva token is
/// safe to unfreeze (and safe to bridge onward).
pub struct Maturity {
    pub confs: i64,
    pub required: u32,
    pub matured: bool,
}

/// Pure maturity rule, factored out so it is unit-testable without a node.
fn is_matured(confs: i64, required: u32) -> bool {
    confs >= required as i64
}

/// Lock an NFD you own to the bridge (Divi -> Diva). Issues a BRIDGE-OUT record
/// that reassigns the NFD to the well-known BRIDGE_DIVI address and carries the
/// destination Diva EVM address, the round-trip `nonce`, and `maturity_confs`
/// (the fast self-transfer knob). Funded from `owner_addr`, which is how the
/// overlay ledger proves you are the current owner. `diva_dest` is a 20-byte EVM
/// address in hex (no 0x). Public NFDs (Percs) pass `wrapkey_ptr = None`; for
/// encrypted NFDs it is the content key already rewrapped to the federation.
pub fn lock(
    cfg: &NodeConfig,
    owner_addr: &str,
    nfd_mint_txid: &str,
    diva_dest: &str,
    nonce: u64,
    maturity_confs: u32,
    wrapkey_ptr: Option<&str>,
) -> Result<LockOutcome, String> {
    let rpc = RpcClient::new(cfg);
    let record =
        nfd_record::encode_bridge_out(nfd_mint_txid, diva_dest, nonce, maturity_confs, wrapkey_ptr)?;
    let utxo = pick_owner_utxo(&rpc, owner_addr)?;
    let txid = anchor_record(&rpc, &utxo, &record, None)?;
    Ok(LockOutcome { txid, nonce })
}

/// Release a locked NFD back to Divi (Diva -> Divi). Federation-side: issues a
/// BRIDGE-IN record transferring the NFD from BRIDGE_DIVI to `new_owner_addr`,
/// referencing the authorizing Diva burn (`diva_burn_ref`, 32 bytes hex) and the
/// matching `nonce`. Funded from `bridge_addr` (BRIDGE_DIVI), which is how the
/// ledger proves the federation controls the lock. For encrypted NFDs
/// `wrapkey_ptr` is the CK rewrapped to the returning owner.
pub fn release(
    cfg: &NodeConfig,
    bridge_addr: &str,
    new_owner_addr: &str,
    diva_burn_ref: &str,
    nonce: u64,
    wrapkey_ptr: Option<&str>,
) -> Result<ReleaseOutcome, String> {
    let rpc = RpcClient::new(cfg);
    let new_owner_packed = address_to_packed(&rpc, new_owner_addr)?;
    let record = nfd_record::encode_bridge_in(&new_owner_packed, diva_burn_ref, nonce, wrapkey_ptr)?;
    let utxo = pick_owner_utxo(&rpc, bridge_addr)?;
    let txid = anchor_record(&rpc, &utxo, &record, None)?;
    Ok(ReleaseOutcome { txid })
}

/// Maturity status of a lock tx, for the Diva side (may the token unfreeze?) and
/// the UI countdown. `maturity_confs` is the value carried in the BRIDGE-OUT.
pub fn maturity_of(cfg: &NodeConfig, lock_txid: &str, maturity_confs: u32) -> Maturity {
    let confs = tx_confirmations(cfg, lock_txid);
    Maturity { confs, required: maturity_confs, matured: is_matured(confs, maturity_confs) }
}

/// Read and classify a bridge record from a tx, or None if the tx carries no
/// BRIDGE-OUT / BRIDGE-IN record. A watcher uses this on candidate txs (block
/// scanning / the coordinator itself lives outside this module).
pub fn read_bridge_record(
    cfg: &NodeConfig,
    txid: &str,
) -> Result<Option<nfd_record::NfdRecord>, String> {
    match crate::collectibles::read_record(cfg, txid)? {
        Some(r @ nfd_record::NfdRecord::BridgeOut { .. }) => Ok(Some(r)),
        Some(r @ nfd_record::NfdRecord::BridgeIn { .. }) => Ok(Some(r)),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maturity_rule() {
        // provisional until N, matured at/after N; -1 (unknown/unconfirmed) is not matured
        assert!(!is_matured(-1, 10));
        assert!(!is_matured(0, 10));
        assert!(!is_matured(9, 10));
        assert!(is_matured(10, 10));
        assert!(is_matured(11, 10));
        // a zero-maturity lock (fast, no wait) is matured as soon as it is in a block
        assert!(is_matured(1, 0));
    }
}
