# Handoff: "Proof of Existence" feature → integrate into DD69

Written by the chain/PoE agent for the agent building Divi Desktop 6.9. This is a
complete, working wallet feature; your job is to fold it into `main` and finish
the two polish items below. It was built and tested against a regtest node.

## What it is
A "Proof of Existence" panel: the user picks a file, the wallet fingerprints it
(SHA-256, in the browser — the file never leaves the machine), anchors only that
32-byte hash on the Divi chain in an OP_META output, and can later verify a file
against a transaction id. The block's timestamp is the proof. Forkless; uses the
shared "DVXP" record format (`Divi-Blockchain_6.9/docs/POE-NFT-RECORD-FORMAT.md`,
type 0x01).

## Where the code is
- **Branch:** `feat/poe-timestamp` on `geoffmccabe/Divi-Desktop-6.9` (pushed).
- **Rust:** `crates/supervisor/src/poe.rs` — `timestamp()`, `verify()`,
  `parse_poe_hash()` + unit tests. Pure hex + RPC, no file I/O, no crypto deps.
- **Commands:** `crates/app/src/main.rs` — `poe_timestamp`, `poe_verify`
  (`async` + `spawn_blocking`; `PoeProofDto` returned from verify).
- **Config:** `crates/supervisor/src/config.rs` — `NodeConfig::load()` now honors
  a `DIVI_DATADIR` env override (used for testing; general-purpose).
- **Frontend:** `ui/src/wallet/TimestampPanel.tsx` (the panel — filename still
  says Timestamp; rename to `ProofOfExistencePanel.tsx` if you like, it's cosmetic),
  wired via `ui/src/wallet/api.ts` (`poeTimestamp`, `poeVerify`, `Proof`),
  `ui/src/nav.ts` (label **"Proof of Existence"**, id `timestamp`),
  `ui/src/icons.ts` (`timestamp` icon), `ui/src/Shell.tsx` (router),
  `ui/src/index.css` (`.ts-*`, `.wl-input` styles).

## Merge notes
- The branch is clean and compiles: `cargo check` (workspace) and `tsc --noEmit`
  (in `ui/`) both pass; the 3 Rust parser tests pass.
- No schema/state changes, no new external dependencies. Only additive files plus
  small edits to nav/router/api/icons/css. Should merge into `main` with trivial
  conflicts at most (the nav/router/api lists).
- Keep the `DIVI_DATADIR` override — it's how anyone points the wallet at a test
  node without touching the real datadir.

## How to test (regtest, zero real coins)
1. A regtest node is set up at `~/divi-poe-regtest` (rpc user/pass `poe`/`poe_local`,
   port 51799). Start it if needed:
   `~/Divi-Blockchain_6.9/divi/src/divid -datadir=~/divi-poe-regtest -daemon`
   It already has spendable regtest DIVI. Mine when you need confirmations:
   `divi-cli -datadir=~/divi-poe-regtest setgenerate 1`.
2. Run the wallet against it:
   `DIVI_DATADIR=~/divi-poe-regtest cargo run --manifest-path crates/app/Cargo.toml`
   (UI-only changes need a forced app rebuild — `touch crates/app/src/main.rs` —
   because the frontend is embedded at compile time.)
3. In the panel: Choose a file → anchor → copy the txid → Verify with the same
   file + txid → "✓ Match". Verified end-to-end this way.

## Two follow-ups to finish (known, documented)
1. **"Confirming…" state (correctness — do this).** `poe_timestamp` returns the
   txid the instant it's broadcast, and the panel says "Done" immediately. But the
   proof doesn't exist until the tx is in a block (~1 min on mainnet). Change the
   create flow to show **"Submitted — confirming…"** after broadcast and only show
   **"✓ Timestamped on <date>"** once `poe_verify` reports a block time (poll it).
   Never claim success before there's a confirmation.
2. **Cosmetic status bug.** The bottom-left status reads "The node isn't running"
   for a regtest node because `process::daemon_pid()` looks for `divid.pid` in the
   datadir root, but regtest writes it under a `regtest/` subfolder. RPC works
   fine regardless (balances/txs load). Fix: check the regtest subdir when the
   node is on regtest. Low priority; mainnet is unaffected.

## Guardrails (Geoff's standing rules)
Both repos are public on `geoffmccabe/*` only — never push to `DiviProject/Divi`
(`upstream`), and no tags/releases/public notification until Geoff says go. Geoff
is not a coder: plain-English updates, no code dumps in chat, calibrated
confidence, commit+push after changes.
