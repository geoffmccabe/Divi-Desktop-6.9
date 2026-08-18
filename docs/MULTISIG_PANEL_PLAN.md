# DD69 MultiSig Panel — Build Plan (v1, basic)

Date: 2026-Aug-18. Status: PLAN ONLY, not built.

## Goal
Add a new left-sidebar menu item **MultiSig**, positioned directly under **Governance**.
It is a full working panel (not a preview) with all basic multisig features: create a
shared N-of-M wallet, view balances, propose a spend (Send), co-sign a pending spend,
and broadcast when enough signatures are collected. Same DD69 branding/styling as every
other panel.

At the top of BOTH the MultiSig panel AND the Governance panel, show two read-only
public wallet balances:
- Foundation: `DPhJsztbZafDc1YeyrRqSjmKjkmLJpQpUn`
- Charity:    `DPujt2XAdHyRcZNB5ySZBBVKjzY2uXZGYq`

Access-limiting (who can see/use these, tied to governance membership) is a LATER phase.
This v1 is the basic engine + UI only, open to any wallet user.

## Why this is buildable now (confirmed in code 2026-Aug-18)
- Divi 6.9 core has complete standard P2SH OP_CHECKMULTISIG multisig. Registered RPCs:
  `createmultisig`, `addmultisigaddress`, `createrawtransaction`, `signrawtransaction`
  (supports iterative multi-party partial signing, returns `complete` flag),
  `decoderawtransaction`, `sendrawtransaction`, `validateaddress`, `decodescript`.
  Source: /Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/ (script/standard.cpp,
  script/sign.cpp CombineSignatures, wallet_ismine.cpp, rpcmisc.cpp, rpcwallet.cpp,
  rpcrawtransaction.cpp).
- NO PSBT (BIP-174) and NO combinerawtransaction. Multi-party signing uses the legacy
  method: pass concatenated raw-tx hex between signers; signrawtransaction merges via
  CombineSignatures. We build the "pass it between people" step ourselves.
- DD69 already drives the raw-tx toolchain and already builds/spends P2SH (HTLC escrow,
  bearer codes). So the low-level plumbing is proven in DD69.
  Rust: /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/ (fastsend.rs,
  escrow.rs, dvxp.rs, bearer.rs). Tauri command surface: crates/app/src/main.rs.
- DD69 has ZERO existing multisig code today (confirmed). This is all-new wiring on top
  of existing plumbing.

## Panel layout (matches existing DD69 panels)
1. Top strip: two read-only cards, Foundation + Charity, each showing address (abbrev,
   click to copy) and live balance in DIVI. Small "public wallet" label. This same
   strip component is reused at the top of the Governance panel.
2. My multisig wallets: list of shared wallets this user is part of, each showing the
   shared address, the N-of-M rule, current balance, and any pending (awaiting-signature)
   spends with a badge count.
3. Actions row (native DD69 buttons/styling):
   - **Create** shared wallet: choose N and M, paste co-signer public keys (or pick own),
     get the shared P2SH address + the redeemScript to share with co-signers.
   - **Send / Propose spend**: pick a shared wallet, enter recipient + amount, produce a
     half-signed transaction blob to hand to co-signers.
   - **Sign**: paste/open a pending spend, review decoded details (to, amount, fee, which
     wallet), add your signature, see updated status (e.g. "2 of 3 signed").
   - **Broadcast**: enabled once complete; sends to the network.
4. History: recent completed multisig spends for wallets the user is in.

## What we build (Rust backend + React UI)
Backend (new module, e.g. crates/supervisor/src/multisig.rs, exposed as Tauri commands
in crates/app/src/main.rs, mirroring how escrow_*/bearer_* are exposed):
- create shared wallet -> wraps createmultisig / addmultisigaddress; persists the
  redeemScript + participant pubkeys locally so we can reconstruct spends.
- build a spend -> createrawtransaction over the shared wallet's coins.
- sign a spend -> signrawtransaction with the redeemScript in prevtxs + this user's key;
  return updated hex + complete flag + human-readable decoded summary.
- broadcast -> sendrawtransaction.
- read balance for an arbitrary address (for Foundation/Charity + shared wallets).
UI (new folder ui/src/wallet/multisig/, styled with existing theme tokens like the
governance/ folder does; new nav item in nav.ts, view in Shell.tsx, icon in icons.ts).

## Balance source — DECIDED 2026-Aug-18: local node, via addressindex
Geoff chose: use our own node for all balances. No external explorer.

Reality confirmed in source:
- DD69's bundled node currently runs with addressindex OFF (default). Config written at
  /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/install.rs:301-322;
  launch args at crates/supervisor/src/process.rs:133-137. No addressindex/spentindex/
  txindex is set.
- To read the CURRENT balance of an address the user does NOT own, the correct RPC is
  `getaddressbalance`, which HARD-REQUIRES `-addressindex` (impl rpcmisc.cpp:817-873;
  throws "No information available for address" if the index is off).
- Watch-only import (`importaddress`, exists, no reindex needed) was evaluated and
  REJECTED for this: it only reliably yields TOTAL RECEIVED (getreceivedbyaddress), not
  current balance after spends. listunspent excludes watch-only; getbalance "*" excludes
  watch-only. Treasury wallets spend, so watch-only would overstate the balance. Wrong.

PLAN: enable `addressindex=1` in the bundled divi.conf (install.rs conf body). Turning it
on triggers a ONE-TIME full reindex (slow first startup, then permanent). Fold this into
the existing reindex-recovery path (process.rs:211-220) + PrimerLove loading screen so it
is a graceful "preparing your node" step, not a hang.

KEY JUSTIFICATION: the governance voting-weight snapshot engine ALREADY requires
addressindex (getaddressdeltas / getaddressbalance historical reconstruction — proven in
scratchpad/snapshot_spike.py). So addressindex was always going to be enabled for the DAO.
These two treasury balances are simply the first visible consumer of that switch. One
reindex serves both governance and this panel.

Consequence to watch: enabling addressindex on existing installs forces that reindex on
next launch. Communicate it in the loading UI. New installs pay it during initial sync
anyway (marginal extra cost). The user's OWN multisig wallets do NOT need addressindex —
addmultisigaddress adds them to the wallet, so their balance comes from normal wallet
calls for free; addressindex is only needed for the two outside treasury addresses (and
governance snapshots).

## Phasing
- Phase 1 (this plan): two-wallet header strip (reused in Governance too) + basic
  multisig create/send/sign/broadcast, open to all, legacy hex-blob signer passing.
- Phase 2 (later, Geoff's "limiting factors"): gate visibility/use to governance
  members (board/team roles), tie the treasury multisig to the DAO, nicer signer-passing
  over the same off-chain/Arweave channel governance uses instead of copy-paste blobs.

## Open questions for Geoff
1. Balance source: A / B / C above? (recommend C)
2. For v1, is copy-paste of the half-signed blob between co-signers acceptable, or do you
   want the nicer share-channel now? (recommend copy-paste for v1, upgrade in Phase 2)
3. Are Foundation/Charity themselves going to become DD69-managed multisig wallets, or
   are they display-only for now? (assume display-only for v1)
