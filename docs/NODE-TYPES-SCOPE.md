# Node-type differentiation on the map — build scope

Showing WHAT KIND of node each marker is: old core, DD69 core, Lovenode, Box
Wallet, and an "other/unknown" bucket. A heart = Lovenode, a square = Box Wallet
staker, a grey dot = old original core, DD69's coloured purple dots + effects =
DD69 core.

Files that matter (full paths):
- `/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/NetworkMap.tsx` — the map
- `/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/knownPeers.ts` — the 30-day node store
- `/Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/network.rs` — reads getpeerinfo, exposes `subver`
- `/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/api.ts` — the `Peer` shape (already carries `subver`)
- `/Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/clientversion.cpp` — where the core sets its wire user-agent

---

## 1. The one detection signal we have: `subver`

The only per-node identifier the peer-to-peer network gives us is the
**subversion string** (the "user-agent"), from the node's `getpeerinfo`. It
already flows end-to-end: `network.rs` reads it, `Peer.subver` carries it into
the UI, and the map's hover tooltip already shows it. Classifying a node by its
subver is therefore mostly UI work — IF the clients actually announce themselves
differently.

**Measured on the live network today: they don't.** All 48 connected peers report
the identical string **`DIVI Core: 3.0.0.0`**. There is currently zero subver
diversity to key off. Each node type below is only distinguishable to the degree
its client sets a distinct user-agent (or, for Lovenodes, isn't on P2P at all).

---

## 2. Each node type — is it actually detectable?

### Grey dot — old original core
Reports `DIVI Core: 3.0.0.0`. This is the default bucket: anything with the plain
string is treated as old core. **Detectable now** (it's the string everyone
sends).

### Purple dots + DD69 effects — DD69 modernized core
⚠ **Not distinguishable on the wire today.** The modernized fork DOES carry an
identifier — `CLIENT_VERSION_SUFFIX "-dd69.1"` in
`/Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/clientversion.cpp` — but that
suffix only lands in `CLIENT_BUILD` (used by `--version`). The **wire
subversion** is built by `FormatSubVersion`, which uses `CLIENT_VERSION_STR`
(`3.0.0.0`) with NO suffix. So a DD69 core and an old core send the *same*
`DIVI Core: 3.0.0.0`.

**To differentiate: one small chain-side change** — have `FormatSubVersion`
include the dd69 tag, so DD69 nodes advertise e.g. `DIVI Core: 3.0.0.0-dd69`.
This is cosmetic/informational (subver isn't consensus), so it's low-risk, but it
is a change in the CHAIN repo (`Divi-Blockchain_6.9`), owned by the chain agent —
a coordination item, not a DD69 edit. Caveat: it only tags nodes built *after*
the change, so DD69 nodes appear purple only as people run the newer core; older
DD69 builds stay grey until updated.

### Heart — Lovenode
**Invisible to P2P by design** (see `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/`
Lovenode notes). A Lovenode is a phone light-staker that talks to a **relay over
WebSocket**, never joins the peer network, and never appears in `getpeerinfo`. It
cannot be detected from peers at all. **Requires a separate data source:** the
Lovenode relay exposing an endpoint that lists active Lovenodes (their IPs or
pre-geolocated city/country). That endpoint does not exist yet. The map already
reserves the visual slot — the pink ♥ column in the Nodes-by-Country panel — but
it is **hardcoded to 0** with nothing behind it.

### Square — Box Wallet staker
**Unknown — needs one fact from the Box Wallet author.** If Box Wallet stakes as
a **full P2P node with a custom user-agent**, it's detectable the moment we know
its subver string (add one row to the registry below). If it stakes as a
light/relay client like a Lovenode, it's invisible to P2P and needs its own
data source. Nothing with a non-standard subver is currently connected to the
test node, so we can't infer which it is — ask the author for the exact
user-agent Box Wallet reports, or the port/relay it uses.

---

## 3. The design: a node-type registry

Not hard-coded branches — a small table (a new
`/Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/nodeTypes.ts`) mapping a
subver PATTERN → { type, marker, colour, label }, evaluated top-to-bottom, with
an "other/unknown" fallback. Adding a future client = one row. Sketch of the
rows:

| Match on subver | Type | Marker |
|---|---|---|
| contains `dd69` | DD69 core | purple dot + effects |
| contains `boxwallet` (TBD) | Box Wallet | square |
| exactly `DIVI Core: 3.0.0.0` | old core | grey dot |
| anything else | Other | hollow/neutral marker + show raw subver on hover |

Lovenodes are NOT matched by subver (they're not peers) — they come from the
relay feed and are drawn as hearts in a separate pass.

**Draw the "other/unknown" bucket honestly** rather than forcing every node into
a known type — an unrecognised subver should read as "unknown client" and show
its raw string on hover, so new clients are visible as soon as they appear even
before we add a row.

---

## 4. The persistence gap (important)

`subver` is only known for nodes we are **currently connected to**. The 30-day
known-peer store (`knownPeers.ts`) records lat/lon/city/country/lastSeen but
**not** the node's type. So a node we saw yesterday but aren't connected to now
has no type — it'd fall back to unknown/grey.

**Scope item:** extend the known-peer record to remember each node's last-seen
subver (hence type), so the marker persists when the node is offline. Small
addition to `knownPeers.ts` (a `subver?` field) + record it in the poll where
peers are folded into the store.

---

## 5. Other node types out there?

Honest answer: on the **current live network there is no hidden diversity** — 48
of 48 peers send the identical `DIVI Core: 3.0.0.0`. So there is nothing to
"discover" from the wire today. The realistic type list is the four above plus an
Other bucket. Candidates that COULD exist but would need a distinct user-agent
(or aren't P2P) to be separable:

- **Divi Desktop 2.0** (the old GUI wallet) — bundles the core; almost certainly
  reports plain `DIVI Core: 3.0.0.0`, so indistinguishable from old core. Not
  separable unless it set a custom subver (it didn't).
- **Exchange / explorer full nodes** — run standard core, standard subver. Not
  separable, and arguably shouldn't be — they're just old core.
- **Mobile / light wallets** — not P2P peers; invisible like Lovenodes.
- **Any future fork or custom client** — separable the instant it ships a
  recognisable user-agent; the registry + Other bucket surfaces it automatically.

So the map can meaningfully show: **grey (old core), purple (DD69 core, after the
subver tag), heart (Lovenode, via relay), square (Box Wallet, if it has a custom
subver), and a neutral "unknown client" for anything else.**

---

## 6. Dependencies before this can fully land

1. **Chain-side:** add the dd69 tag to the wire subversion in
   `clientversion.cpp` (chain agent). Without it, grey and purple can't be told
   apart. — *blocks purple*
2. **Lovenode relay:** an endpoint listing active Lovenodes + locations. — *blocks
   hearts*
3. **Box Wallet:** the author tells us its subver string (or that it's a relay
   client). — *blocks squares*
4. **DD69 (buildable now, no blockers):** the `nodeTypes.ts` registry, the
   subver→marker classification, the Other bucket, the `subver` field on
   `knownPeers`, and the map drawing the different markers. This works
   immediately for grey vs unknown, and lights up the other types as each
   dependency above lands.

## 7. Honesty constraints for the UI

- A marker reflects the client a node **advertises**, which a node can spoof.
  Fine for a friendly network map; don't present it as proof.
- Lovenodes are shown because the relay TELLS us, not because we observed them —
  they're a different kind of claim than a peer we're directly connected to. Keep
  that distinction legible (and mind the privacy of plotting phone IPs — consider
  coarsening Lovenodes to city/country).
