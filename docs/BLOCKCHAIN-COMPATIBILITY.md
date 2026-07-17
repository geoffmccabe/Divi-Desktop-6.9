# Divi Desktop 6.9 ⇄ Divi Blockchain 6.9 — Compatibility & Action List

This wallet supervises the `divid` node from **`geoffmccabe/Divi-Blockchain_6.9`**
(branch `modernize/remove-openssl`) — a fork of Divi Core that removed OpenSSL and
now builds a **native arm64 (Apple Silicon)** binary. Mirror of the contract in the
blockchain repo (`docs/WALLET-COMPATIBILITY.md`).

## TL;DR

A compatibility review found **10 of 11 supervisor touchpoints already work with the
modernized node, unchanged** — RPC calls, `getstakingstatus` fields, the `divid.pid`
file, the `Last shutdown was prepared:` marker, corruption/reindex handling, datadir,
and `divi.conf` are all identical. Consensus/RPC/on-disk format did not change.

**The one gap is wallet-side and it matters:** the node fork now *produces* a fast
native-arm64 `divid`, but this wallet's binary resolver would still pick an old
Intel/Rosetta daemon if one is present — so the speedup silently disappears unless we
fix selection.

## Action list (this repo)

1. **Fix `find_divid` (`crates/supervisor/src/process.rs`).** Reorder so the *bundled
   modernized binary wins first*; demote or remove the old Divi Desktop 2.0 unpack
   path. This is the single change needed to actually run the native arm64 node.
2. **Bundle `divid` per target** (Tauri sidecar/`resources` in `crates/app/tauri.conf.json`,
   currently absent): `aarch64-apple-darwin` (the win) + `x86_64-apple-darwin` +
   `x86_64-pc-windows-msvc` + `x86_64-unknown-linux-gnu`, sourced from the blockchain
   repo's tagged release. Prefer bundling over runtime download; keep download for
   auto-update (Phase 10) only.
3. **Read `getnetworkinfo.subversion` once at startup.** The fork reports
   **`v3.0.0.0-dd69.1`**. Accept `v3.0.0.0*`; **warn (non-blocking)** if the `-dd69.*`
   suffix is absent ("running a stock/unknown divid, not the bundled fast build").
   Pin the expected suffix + the binary's SHA-256.
4. **Verify each shipped `divid` SHA-256 before exec** (upholds the "never run a
   swapped daemon" property in PLAN.md).
5. **Smoke-test the recovery ladder** against a genuinely corrupt chainstate using the
   modernized binary — confirm the corruption/`Last shutdown was prepared` strings and
   `-reindex`/`-reindex-chainstate` behavior match what the supervisor expects.

## What the node guarantees (rely on these; C1–C10)

Local JSON-RPC 1.0 (Basic auth, default port 51473) for `getblockcount`,
`getconnectioncount`, `getbestblockhash`, `getblock`, `getstakingstatus`, `stop`;
`getstakingstatus` booleans named exactly `validtime/haveconnections/walletunlocked/
enoughcoins/mintablecoins/mnsync` with `"staking status"` a JSON **bool**; RPC key
JSON **types** stable; `divid.pid` written/removed in the datadir; `debug.log` prints
`Last shutdown was prepared: true|false` each start; `stop` = flush-then-exit (≈9–13s,
never SIGKILL); `-reindex(-chainstate)` valid; datadir/`divi.conf` unchanged; numeric
consensus version stays 3.0.0.0. Full text: blockchain repo `docs/WALLET-COMPATIBILITY.md`.

## What we owe the node

Never SIGKILL mid-flush; always `stop`+wait. Prefer the verified fork binary. Gate
"fast build" UX on the `-dd69.*` suffix, not the numeric version.
