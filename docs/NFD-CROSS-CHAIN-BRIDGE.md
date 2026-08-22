# NFD Cross-Chain Bridge (Divi <-> Diva) — POINTER

This early draft has been SUPERSEDED to avoid drift. Two code-verified specs and a
frozen wire contract now own this topic. Read those, not a duplicate here:

1. **Design + trust model + protocol (authoritative):**
   `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-EVM-AND-NFT-BRIDGE-SPEC.md`
2. **Phased plan + the instant-mint maturation lock (fast self-transfer):**
   `/Users/geoffreymccabe/diva/NFT_BRIDGE_PLAN.md`
3. **Frozen byte-exact interface both sides implement:**
   `./NFD-BRIDGE-INTERFACE.md`

Divi-side implementation lives in `crates/supervisor/src/bridge.rs` (this repo).
DIVA-side `NFDBridge721` contract lives under `~/diva/bridge/contracts/`.

Core invariant (all three agree): an NFD is either freely owned on Divi, or locked
to `BRIDGE_DIVI` and represented by exactly one live ERC-721 on DIVA. Never both.
Full decentralization is gated on DIVA's POAS validator set (unbuilt); Phase 1 is a
single-coordinator correctness skeleton.
