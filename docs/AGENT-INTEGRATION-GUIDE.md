# Divi Desktop 6.9 — integration guide for other agents

For anyone (human or agent) building something that has to talk to, extend, or
sit alongside this wallet. It covers what exists, how it is put together, the
exact surfaces you can call, the traps that have already cost us time, and what
is still to come.

Sibling projects and their docs:

| Project | Repo | Owns |
|---|---|---|
| **This wallet** | `geoffmccabe/Divi-Desktop-6.9` | wallet UI, node supervision, PoE/NFD/C2PA front ends |
| **The chain** | `geoffmccabe/Divi-Blockchain_6.9` | C++ core, opcodes, consensus, node RPCs |
| **Divi Love Scan** | (explorer) | block explorer + inspector |

Authoritative chain-side specs live in the blockchain repo, **not here**:
`docs/SOFTFORK-OPCODES.md`, `docs/POE-NFT-RECORD-FORMAT.md`,
`docs/NFD-COLLECTIBLES-SPEC.md`, `docs/DMT-TOKENS-SPEC.md`, `docs/ROADMAP.md`.
If this document and those disagree about a record format, **they win**.

---

## 1. What this is

A ground-up replacement for Divi Desktop 2.0, which had not been updated since
2023 and crashed by corrupting its own datadir. Roughly 10 MB instead of 150 MB,
because it uses the OS webview rather than shipping Chromium.

- **Shell:** Tauri 2.11 (Rust). macOS uses WKWebView.
- **Front end:** React 18 + Vite 5 + Tailwind 3, bundled by `vite-plugin-singlefile`
  into one HTML file embedded in the binary. **No CDN, no runtime fetch of assets.**
- **Logic:** a Rust crate (`dd69-supervisor`) that owns all node interaction.

```
crates/
  app/         Tauri shell — every #[tauri::command] lives in src/main.rs
  supervisor/  all real logic; no UI, no Tauri types
ui/src/        React app (wallet/, admin/)
ops/mothernode/  server-side scripts (fork collector)
docs/
```

---

## 2. Rules that will bite you

**2.1 Every node-touching command must be `async fn` + `spawn_blocking`.**
Tauri runs a sync command on the UI thread. Our RPC is blocking, so one sync
command against a slow node freezes the window and locks the user out of their
own wallet. Every command in `main.rs` follows this shape — match it.

**2.2 `cargo build` does NOT rebuild the front end.**
There is no `beforeBuildCommand`, and we build with plain `cargo`, not
`tauri build`. The binary embeds whatever is in `ui/dist` at compile time.

```
cd ui && npm run build        # ALWAYS first
cargo build --release -p divi-desktop-69
```

Skip step one and you will ship a stale UI and debug a bug you already fixed.
This has happened more than once, including shipping an entire feature invisibly.

**2.3 Typecheck without a pipe.** `npx tsc --noEmit | head` masks the exit code
and has let a real error through. Run it bare.

**2.4 Never fabricate a status.** House rule, learned the hard way: if the node
does not answer, say so. Do not invent "busy", do not substitute a different
data source silently, do not show a number whose provenance changed. Several of
the worst bugs in this codebase were dishonest UI, not broken logic.

---

## 3. The integration surface — Tauri commands

Call from JS via `invoke("name", { args })`. Wrappers live in
`ui/src/wallet/api.ts`. Arguments are camelCase in JS, snake_case in Rust;
Tauri converts.

### Node & chain
| Command | Returns | Notes |
|---|---|---|
| `node_status` | phase, headline, blocks, peers | `peers: null` = node did not answer. Poll ≤5s. |
| `recent_blocks(count)` | block height, time, txids, stake winner/amount | count clamped 1–20 |
| `chain_orphans(force?)` | stale tips, tip, span, ratePct | ⚠ see 5.2 — expensive |
| `network_peers` | peers[] + selfIp | from `getpeerinfo` |
| `geolocate_ips(ips)` / `self_geo` | city/country/isp | external ip-api call |
| `probe_peers(ips)` | online bool | TCP connect to :51472 |

### Wallet
| Command | Notes |
|---|---|
| `wallet_balance` | spendable / staking / pending / immature |
| `wallet_addresses` | with per-address receive/send/stake counts |
| `new_receive_address`, `validate_address`, `address_qr` | |
| `list_transactions(count, from)` | **`null` = unreachable, `[]` = genuinely none.** Do not conflate. |
| `recent_activity` | newest 25 |
| `coin_maturity` | per-UTXO maturity |
| `send_coins(address, amount, passphrase?)` | |

### Security / staking
`wallet_status`, `unlock_wallet`, `lock_wallet`, `change_passphrase`,
`encrypt_wallet`, `wallet_seed`, `remember_password`, `forget_password`,
`start_staking(passphrase?)`, `resume_staking`, `staking_wallets`,
`lottery_info`, `lottery_wins(addresses)`, `lottery_board(addresses)`

### Applications
`poe_timestamp(hash)`, `poe_verify(txid, hash)`, `c2pa_inspect(path)`,
`payment_request_create(...)`, `payment_requests_inbox`, `divi_prices(...)`

---

## 4. Node facts (Divi Core v3.0.0)

Verified against a live mainnet node, not assumed.

- **No masternodes.** Removed 3+ years ago. Do not build anything expecting them.
- **No `getnodeaddresses`.** Peer discovery beyond `getpeerinfo` is not available;
  this app keeps its own 30-day known-peer store and TCP-probes it.
- **Stake transactions use category `stake_reward`** — not `stake`, not
  `generate`. Matching only on `"stake"` misses them.
- **Negative confirmations are real.** A conflicted/orphaned transaction reports
  `-1`. Rendering it raw produced "-1 confirmations" next to a green "+498 DIVI"
  that was never earned. Use `ui/src/wallet/confirmations.ts`.
- **Address format:** version byte 30, so addresses start with `D`. WIF secret
  version 212. Base58 excludes `0`, `O`, `I`, `l`.
- **Blocks ~60s.** Lottery cycle 10080 blocks mainnet (10 on regtest); top 11
  coinstakes win, rank 0 big, 1–10 small.
- **`OP_META` (0x6a)** is Divi's `OP_RETURN`, carrying **603 bytes**, one data
  output per transaction.
- **Remote mode:** set `DIVI_REMOTE=1` plus `DIVI_RPC_USER` / `DIVI_RPC_PASS` /
  `DIVI_RPC_PORT` and the supervisor skips local pid/datadir checks. Used with an
  SSH tunnel to the test node.

---

## 5. Performance traps, measured

**5.1 The node is easy to overload.** Aggressive polling from this app once made
a healthy node look "busy" for minutes. Current intervals: status 5s, map 10s,
transactions 60s deep + 3s shallow. Reuse the shared keep-alive `ureq::Agent` in
`rpc.rs`; do not open fresh connections.

**5.2 `getchaintips` costs ~18 SECONDS.** Measured repeatedly on a healthy node
at the 4.1M-block tip, against ~9ms for a normal call, and it holds the daemon's
main lock throughout. Polling it once a minute **wedged the node solid** — chain
stopped advancing, RPC stopped answering, CPU idle. It is now on-demand only,
cached 30 minutes in `chaintips.rs`, and never on a timer. **If you add a
feature that needs fork data, read the cache — do not call the node.**

**5.3 Sizing a node.** 3.7 GB RAM with `dbcache=1024` and no swap gets
OOM-killed repeatedly. Working config: `dbcache=300`, `maxconnections=24`, 4 GB
swap.

---

## 6. Data formats

All on-chain records share the **DVXP envelope** (blockchain repo,
`docs/POE-NFT-RECORD-FORMAT.md`):

```
OP_META(0x6a) PUSH( "DVXP"(4) | version(1) | type(1) | body )
```

| Type | Meaning |
|---|---|
| 0x01 | Proof of Existence — hashAlg(1) + 32-byte SHA-256 |
| 0x02 | NFD / Collectible — mint / transfer / key-announce subtypes |
| 0x03 | PoE Merkle batch root |
| 0x05 | Payment request |

**Native opcodes exist** on the chain's `feat/opcodes` branch:
`OP_POE = 0xba`, `OP_NFD = 0xbb`, with `createpoe` / `verifypoe` / `createnfd` /
`verifynfd` RPCs. This wallet **prefers the native form and falls back to the
DVXP form** when the node lacks those RPCs (see `poe.rs`). Any verifier you build
**must accept both**.

**Merkle batching uses RFC 6962** (Certificate Transparency), not Bitcoin's
construction — leaves `SHA256(0x00||h)`, nodes `SHA256(0x01||l||r)`, odd levels
promoted, never duplicated. The domain separation blocks CVE-2012-2459. If you
reimplement this with Bitcoin's tree, your proofs will not match ours.

---

## 7. Honesty constraints in user-facing claims

These are product requirements, not style notes. Several have already been
walked back once.

- **C2PA: we READ, we do not sign.** `c2pa_read.rs` verifies credentials others
  created. We are not "C2PA compliant" — that is a conformance listing for
  products that *generate* credentials. Remote manifest fetching is deliberately
  off, so opening a file never touches the network.
- **PoE proves existence and integrity, not truth.** Anyone can timestamp a fake.
  The value is chronology: a later fabrication cannot produce an earlier anchor.
- **NFDs are "permanent, private, owner-only" — never "uncopyable".** The current
  owner holds the key; nothing prevents copying after decryption.
- **Peer IPs reveal no wallet address**, transactions carry no location, and a
  stake winner is an address that cannot be mapped to a node or an IP. The map
  must never imply otherwise.
- **DIVI has almost no liquid market.** Aggregators disagree ~4.5× because they
  price different illiquid venues (CoinGecko follows a ~$3/day Uniswap pair;
  CoinMarketCap a zero-volume StakeCube pair). When a CMC key is set it is
  authoritative and we show *no* price on failure rather than silently
  substituting another source.

---

## 8. Client-side storage

`localStorage`, all `dd69.*`. Not secrets — treat as cache:

`txCache`, `knownPeers` (30-day TTL), `geoCache`, `selfGeo`, `chainHealth`,
`lotteryBoard`, `addressNames`, `value` (price settings incl. CMC key),
`askMode`, `stakingDesired`, `activeTheme`, `savedThemes`, `themeVersion`

⚠ Two builds sharing an app identity share this store. A debug build pointed at
regtest and a release build pointed at mainnet will read each other's cache —
which once produced a map full of "live" peers on a node that had none.

---

## 9. Roadmap

**Shipped:** wallet core, send/receive, staking + lottery, network map with peer
geolocation and blockchain visualisation, PoE (create/verify/history), Chain
Health with fork tracking, coin maturity, password/encryption, price display,
C2PA inspection, payment requests, skinnable themes.

**In flight:** NFD/Collectibles (crypto + mint/view proven on regtest; Arweave
relay pending), unencrypted thumbnails on Arweave, Ethereum bridge, light
staking node for phones, DMT multi-token layer.

**Proposed, not built:** vanity ("glory") address generator — measured at ~23k
addr/sec/core on an M2 with incremental point addition, ~150k across 8 cores;
58× harder per character; note that imported vanity keys fall **outside the HD
seed** and break seed-phrase recovery.

---

## 10. Working alongside other agents

Several agents share these repos concurrently. What has actually caused
collisions:

- **Stage by path, never `git add -A`.** You will otherwise commit another
  agent's half-finished work.
- **`git fetch` before pushing**, and rebase rather than merge.
- **Hotspots:** `ui/src/index.css` (~600 lines, touched by nearly every UI task),
  `ui/src/wallet/NetworkMap.tsx` (~900), `crates/app/src/main.rs` (~800),
  `crates/supervisor/src/wallet.rs` (~500). Prefer a **new module** plus one line
  wiring it in. Inline styles in a new component beat editing `index.css`.
- **Check branches before concluding something does not exist.** Work may sit on
  `feat/opcodes`, `feat/nfd-collectibles`, `feat/poe-timestamp` rather than the
  branch you happen to have checked out. This document's author has twice
  reported a feature missing that was merely on another branch.
