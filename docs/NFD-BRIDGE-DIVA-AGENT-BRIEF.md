# Handoff brief: NFD<->Diva bridge — coordinator + devnet deploy + round-trip

You (the DIVA-chain agent) own the coordinator, the DIVA devnet deploy, and the
end-to-end round-trip. The wire format is FROZEN and both halves are already built
and committed, so this is integration, not fresh design. Phase 1 only: a single
trusted coordinator, regtest + devnet, NO real value. Full decentralization is
gated on DIVA POAS and is out of scope here.

## Read first (authoritative — do not re-invent)
- Frozen wire interface: `/Users/geoffreymccabe/dd69-nfd/docs/NFD-BRIDGE-INTERFACE.md`
- Builder spec: `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-EVM-AND-NFT-BRIDGE-SPEC.md`
- Phased plan + maturation lock: `/Users/geoffreymccabe/diva/NFT_BRIDGE_PLAN.md`

## Already built — DO NOT rebuild
- **DIVA contract:** `NFDBridge721.sol` on branch `feat/nfd-bridge721` in the
  worktree `/Users/geoffreymccabe/diva-nfd-bridge/bridge/contracts/`. Compiles
  (solc 0.8.36). Self-contained ERC-721 + gate: `mintFromLock` / `attestMaturity`
  / `recall` / `burnToRelease`. Authority = a single coordinator key for now (swap
  `_recoverAuthority` for the 26/38 POAS quorum in Phase 2; ABI unchanged). Merge
  that branch into your DIVA line (the diva repo is local-only, no remote).
- **Divi side:** DVXP subtypes `0x07` BRIDGE-OUT / `0x08` BRIDGE-IN + `bridge.rs`
  (`lock`/`release`/`maturity_of`/`read_bridge_record`) on branch
  `feat/nfd-collectibles` in `/Users/geoffreymccabe/dd69-nfd`. 57 tests pass.
- **Divi-side CLI for you to drive from Node:** `examples/bridge_cli.rs`. Run:
  `DIVI_DATADIR=~/divi-poe-regtest cargo run -p dd69-supervisor --example bridge_cli -- <cmd>`
  JSON out. Commands:
  - `scan <txid>` -> the BRIDGE-OUT/IN record on that tx, or null
  - `meta <nfd_mint_txid>` -> `{content_ptr, thumb_ptr, collection_id, traits_ptr}` (the MetaCommit; absent fields = 32 zero bytes)
  - `maturity <lock_txid> <maturity_confs>` -> `{confs, required, matured}`
  - `lock <owner> <nfd_txid> <diva_dest20> <nonce> <maturity_confs>` -> `{txid, nonce}` (test helper; the wallet normally issues locks)
  - `release <bridge_addr> <new_owner> <burn_ref32> <nonce>` -> `{txid}`

## Your job (Phase 1)
1. **Deploy** `NFDBridge721` to the DIVA devnet with a coordinator key as the
   authority. Add it to `redeploy-all.sh` and write its `.addr`.
2. **Build the coordinator** (Node, alongside `bridge/scripts/*`), doing three loops:
   - **Lock -> mint.** Poll new Divi regtest blocks; for each txid run `bridge_cli scan`.
     On `kind=bridge_out`, run `bridge_cli meta <nfd_id>` for the MetaCommit, then
     sign and submit `mintFromLock(nfd_id, to=diva_dest, nonce, maturity_confs, meta, sig)`.
     The token mints FROZEN (provisional).
   - **Mature / recall.** Poll `bridge_cli maturity <lock_txid> <maturity_confs>`;
     once `matured=true`, sign+call `attestMaturity(tokenId)` to unfreeze (this
     permanently removes the bridge's burn power). If the lock reorged out, sign+call
     `recall(tokenId, nonce)` to burn the still-frozen token.
   - **Burn -> release.** Subscribe to `Released(nfd_id, tokenId, diviDest, nonce)`;
     on the event run `bridge_cli release <BRIDGE_DIVI> <diviDest> <burnTxHash> <nonce>`
     to issue the Divi BRIDGE-IN that returns the NFD.
3. **Prove one round-trip** on regtest-Divi <-> devnet-DIVA: lock a Perc -> frozen
   mint -> mature/unfreeze -> `burnToRelease` -> released back on Divi, identity
   intact. Also test replay rejection and one `recall`.

## Signature digests (must match the contract byte-for-byte)
`DOMAIN = keccak256(abi.encode(block.chainid, contractAddr, "NFDBridge721.v1"))`.
Coordinator signs (secp256k1, raw digest, 65-byte r||s||v — no eth-personal prefix):
- mint: `keccak256(abi.encode(DOMAIN, "mintFromLock", nfd_id, to, nonce, maturity_confs, meta))`
- mature: `keccak256(abi.encode(DOMAIN, "attestMaturity", tokenId))`
- recall: `keccak256(abi.encode(DOMAIN, "recall", tokenId, nonce))`
`tokenId = uint256(keccak256(abi.encodePacked(nfd_id)))`.

## Constraints / notes
- Percs are **Public** (no content key), so ignore the encrypted/wrapkey path for launch.
- `BRIDGE_DIVI` is a coordinator-controlled Divi regtest address that must hold a
  little DIVI to fund BRIDGE-IN releases.
- Do **not** build Phase 2 (POAS quorum) yet; the wire format won't change when it lands.
- **Coordinate back with the NFD agent before changing the frozen interface or the
  authorization digests** — both sides must match exactly or records/sigs silently fail.
