# Node-type differentiation on the DD69 map — context handoff

Purpose: let a fresh agent pick up "show different node types on the network map
with distinct glyphs" without re-deriving anything. Read this first.

Goal (Geoff): the map should visually distinguish node types —
- **Heart (pink)** = Lovenode (phone light-staking wallet)
- **Square** = Box Wallet staker (a friend's staking client)
- **Grey dot** = old original Divi Core 3.0.0.0
- **Purple dot (+ existing DD69 flourishes)** = DD69 / modernized core nodes
- plus any other client types we can detect (see "Other node types" below).

Nothing is coded for this yet. A scope doc is the next step.

---

## Project basics

- **DD69** = Divi Desktop 6.9. Tauri (Rust + React) wallet. Repo `~/Divi-Desktop-6.9`, branch `main`.
- **Modernized core** = `~/Divi-Blockchain_6.9` (OpenSSL-free, native-arm64 fork of Divi Core).
- **Build + ship**: `cd ui && npm run build` FIRST, then
  `cargo build --release -p divi-desktop-69`, then copy the binary into
  `~/Divi-Desktop-6.9/target/release/bundle/macos/Divi Desktop 69.0.3.app/Contents/MacOS/`,
  `codesign --force --deep --sign -` the .app, `ditto` it to
  `/Applications/Divi Desktop 69.0.3.app`, `xattr -cr`, then `open` it.
  (Plain `cargo build` does NOT rebuild the web UI — always `npm run build` first.)
- **Runtime**: app connects to a remote IONOS test node (`109.228.38.104`) over an
  SSH tunnel LaunchAgent (`com.divi.dd69.tunnel`, local 51500 → node 51473).
  Node profile in `~/Library/Application Support/divi-desktop-69/nodes.json`
  (there's also a built-in "Desktop" = local node option, and a "Divi Love Scan"
  remote profile).

## Coordination warning

`NetworkMap.tsx`, `knownPeers.ts`, and `index.css` are the **map agent's actively
edited files**. Edits here have collided before. Keep new logic in NEW files where
possible; make minimal, surgical edits to the shared canvas.

---

## The map today (key files)

- `/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/NetworkMap.tsx` — canvas map.
- `/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/knownPeers.ts` — 30-day
  known-peer store (`dd69.knownPeers`); `loadKnown()` union-heals leftover
  per-scope stores so the count stays complete (~92 nodes).
- `/Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/network.rs` —
  `peers()` reads `getpeerinfo`; already exposes each peer's **`subver`**.
- The map plots live P2P peers + the 30-day known set (all full nodes), each
  IP-geolocated.
- **Existing placeholder**: the "Nodes by Country" panel in `NetworkMap.tsx` has a
  pink heart (♥) "Lovenodes" column (CSS `nbc-h-love` / `nbc-love` in
  `index.css`), but the count is **hardcoded to 0** — the visual slot was
  reserved, with no detection behind it.

---

## What is detectable per node

The single per-peer identifier available is **`subver`** — the BIP-14 user-agent
string from `getpeerinfo`, already surfaced through `network.rs`.

Live sample (test node, its ~48 connected peers): every peer reports the
identical `"DIVI Core: 3.0.0.0"`. No port or protocol-flag distinction exists.

### DD69 / modernized core IS distinguishable by subver

In `/Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/clientversion.h` and
`.../clientversion.cpp`:
- `CLIENT_NAME_STR = "DIVI Core"`, numeric/consensus version stays `3.0.0.0`.
- The modernized fork appends **`CLIENT_VERSION_SUFFIX "-dd69.1"`** to the
  subversion and `--version` (without touching the consensus version).
- `FormatSubVersion` builds `"DIVI Core: 3.0.0.0"` then appends the suffix.

So a DD69-core node should announce a subver like **`DIVI Core: 3.0.0.0-dd69.1`**,
distinct from the old core's plain `DIVI Core: 3.0.0.0`. **This is the mechanism**
to classify old-core vs DD69-core on the P2P layer: substring-match the suffix.

Caveat to verify: confirm a live DD69-core node actually broadcasts the suffixed
subver over P2P (build it, connect it, read its `subver` from a peer's
`getpeerinfo`). Until a DD69 node is on the network, everything reads `3.0.0.0`.

---

## Lovenodes are NOT P2P-visible

Source: `https://github.com/geoffmccabe/Divi-lovenode/blob/main/docs/FOR-OTHER-AGENTS.md`.

- A Lovenode is a **phone light-staking wallet**: stores no blockchain, does the
  stake-win math on a **relay server**, signs winning blocks locally.
- It connects to the **relay over WebSocket/TCP**, NOT the Divi P2P network. So it
  **never appears in `getpeerinfo`**, has no subver, and the map cannot observe it.
- The doc *wants* a network map embeddable in the phone app and DD69, but
  describes **no registry/endpoint/API** listing Lovenodes or their IPs/locations
  yet. The relay receives "addresses only".

To plot Lovenodes, the **relay must expose an endpoint** listing active Lovenodes
(IPs, or pre-geolocated city/country). DD69 would fetch that and draw them as a
**separate overlay**, not from the peer list. That endpoint does not exist yet.

Two honesty flags for the design:
1. Plotting a phone's raw IP reveals user location — consider coarsening to
   city/country.
2. Lovenodes are "told about" (relay-fed), while full nodes are "observed"
   (P2P) — they should read differently on the map, not be conflated.

---

## Other node types to consider a glyph for

- **Box Wallet** (friend's staking client): unknown whether it sets a distinct
  subver. NEEDS a live sample — connect to the network and look for a non-"DIVI
  Core" or differently-suffixed subver.
- **Monstruo / DiviMonster wallet** (`https://divimonstruo.com/divimosterapp/`):
  a **web-based LIGHT wallet** with staking ("Vault"-style). No public GitHub,
  developer name, or version string found (searched 2026-Jul-26). Like Lovenode,
  a light/web wallet does NOT run a full P2P node, so it won't announce its own
  subver on the network. If it stakes, it does so via a hosted backend/vault —
  those backend nodes would appear as ordinary Divi Core peers UNLESS the
  operator sets a custom subver. So Monstruo is **not P2P-detectable as a distinct
  type today**; distinguishing it would need either a custom subver on its backend
  nodes or a Monstruo-side registry/endpoint. Treat it like Lovenode: a
  relay/backend participant, not an observed peer.
- **General rule**: any client that participates in P2P is classifiable by its
  `subver`; anything that only talks to a relay/backend needs a server-side
  registry.
- Practical buckets to expect on-wire: plain `DIVI Core: 3.0.0.0` (old core),
  `...-dd69.x` (DD69 core), possible Box Wallet string, and an "Unknown / other"
  fallback for anything unrecognized. Historic PIVX/Dash-lineage strings are
  unlikely on Divi but the parser should tolerate them.

---

## Proposed shape of the work (for the scope doc)

1. **Backend**: `network.rs` already returns `subver` per peer. Add a small
   classifier (old-core / dd69-core / box-wallet / other) by subver match — keep
   it in a new module or a pure helper, don't bloat the peer struct.
2. **Map (full nodes)**: pick the glyph from the node's class — grey dot (old),
   purple + DD69 flourishes (dd69), square (box), etc. Keep the drawing change in
   `NetworkMap.tsx` minimal and coordinate with the map agent.
3. **Lovenodes (separate overlay)**: fetch from the future relay endpoint; draw
   hearts; label as relay-reported, not observed. Blocked on the relay exposing a
   list.
4. **Legend + the existing ♥ "Lovenodes" country column**: wire the real counts
   once detection exists; add legend entries for each glyph.

Open items before/while scoping:
- Get a **Box Wallet subver** sample.
- Decide whether the **Lovenode relay** will expose a node-list endpoint (and at
  what location granularity).
- Confirm a live **DD69-core** node broadcasts the `-dd69.x` subver over P2P.

---

## Status

- Nothing coded for node-type differentiation yet.
- Immediate next step Geoff asked for: **write the scope doc** (glyph-per-type +
  subver classification + relay overlay for Lovenodes), and identify other node
  types worth a differentiator.
