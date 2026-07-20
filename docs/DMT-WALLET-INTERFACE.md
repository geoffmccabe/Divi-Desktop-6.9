# DMT wallet interface — what the front end needs from the indexer

**Audience:** the DMT workstream (`contrib/dmt-indexer`, `contrib/dvxp-core` in
`Divi-Blockchain_6.9`) and whoever builds the wallet panel or explorer pages.

`docs/INDEXER-ARCHITECTURE.md` asks to coordinate before the block scanner,
reorg/undo and state store are written. This is the front end's half of that
conversation: the questions a wallet and an explorer actually ask, so the state
store is shaped around real queries rather than reverse-engineered later.

Nothing here changes the record format or the rules — those are settled in
`docs/DMT-TOKENS-SPEC.md`, which remains authoritative. This only concerns the
read interface and where the index runs.

---

## 1. Where the index should run: in the wallet, not on our server

The wallet **already runs a full node**. If token balances came from
`scan.divi.love`, a self-custody wallet would silently become dependent on a
server we operate — a user could hold tokens the chain agrees are theirs and see
nothing because our machine was down. That contradicts §11.1 of the spec, which
invites competing implementations precisely so nobody depends on us.

So: **the wallet embeds the indexer and scans its own node.** The explorer runs
the same code independently. Two implementations of the same rules, cross-checked
by the per-block fingerprint — which is exactly what the fingerprint is for.

**This is affordable because DMT has a genesis height.** Records before it are
ignored (spec §9.6), so a wallet never scans the 4.1M blocks of history that
predate tokens; it starts at genesis and stays current from there. At launch that
is minutes of work, growing by ~1,440 blocks a day. Compare this with the full
UTXO scan the explorer needed, which took 2.9 hours — the difference is entirely
the genesis height, and it is what makes local indexing practical.

**Consequence for the scanner:** it must be usable as a **library**, not only as
a daemon. The wallet will drive it from its own supervisor process, feeding it
blocks from the local node, and needs to control when it runs so it never
competes with staking for RPC.

> Learned the hard way: a scanner at ~1,170 blocks/sec with 12 workers saturated
> the node's RPC threads and took the public explorer offline. Whatever the
> wallet embeds must be throttled and yield to the node's own work.

---

## 2. Queries the wallet needs

Shapes are indicative; names are the indexer's to choose. Amounts are **integers
in the token's smallest unit** — never floats, and never pre-divided by
`decimals`. The UI applies `decimals` for display only (spec §11.1, §11.4).

| # | Query | Why |
|---|---|---|
| 1 | `balances(addresses[]) -> [{token_id, amount}]` | The wallet holds many addresses; one call, not N |
| 2 | `token(token_id) -> TokenMeta` | Ticker, name, decimals, supply, policy, issuer |
| 3 | `tokens_meta(token_ids[]) -> TokenMeta[]` | Batch, so a balance list renders in one round trip |
| 4 | `history(addresses[], from, limit) -> TokenEvent[]` | The token equivalent of transaction history |
| 5 | `ticker_status(ticker) -> {taken, owner?, price}` | Before a user commits to a name |
| 6 | `mint_terms(token_id) -> {price, cap, minted, window}` | To show whether an open mint is live and what it costs |
| 7 | `sync_state() -> {height, tip, fingerprint, halted}` | **Required** — see §4 |

**`TokenMeta`** needs at minimum: `token_id`, `ticker`, `name`, `decimals`,
`total_supply`, `max_supply`, `supply_locked`, `issuer`, `mint_open`, and the
genesis txid so the UI can link to the explorer.

**`TokenEvent`** needs: `kind` (issue / mint / transfer-in / transfer-out / burn),
`token_id`, `counterparty`, `amount`, `height`, `txid`, `block_time`.

---

## 3. What the wallet must be able to build (write path)

Reads are not enough; the panel has to create records. The cleanest split is that
the indexer crate owns **encoding** and the wallet owns **funding and signing**,
since key handling lives in the node.

Needed: given the operation and its arguments, return the **payload bytes** for
the OP_META output. The wallet then selects inputs, adds the data output, signs
and broadcasts — the same path `poe.rs` already uses for Proof of Existence.

Encoders required for: ISSUE, TRANSFER, MINT, NAME COMMIT, BURN, LOCK SUPPLY,
ISSUER TRANSFER.

A **validate-before-send** call would also prevent a whole class of user error:
"would this record be accepted, and if not, why?" — checked locally before any
DIVI is spent.

---

## 4. Sync state is not optional

The wallet must be able to say *"as of block N"* and know when it cannot be
trusted:

- **Behind the tip** — balances shown may be stale; say so rather than implying
  they are live.
- **Halted** (unknown version, or a reorg deeper than the 200-block undo window,
  per spec §9.4) — the UI must show an explicit error and **refuse to send**. A
  wallet that spends from state it knows may be wrong is worse than one that
  stops.
- **Fingerprint** — surfaced so a user or a third party can compare against
  another implementation. This is the spec's own defence against silent
  divergence (§9.2) and it only works if the value is actually visible.

---

## 5. UI rules taken from the spec (recorded here so they are not lost)

From §11, and deliberately restated because each is easy to violate by accident:

1. **No coin-protection UI.** No lock lists, no "protected" markers. The
   address-balance model removed that hazard; showing guards would imply a danger
   that does not exist.
2. **A DIVI reserve at token-holding addresses**, so a transfer can always be
   paid for. The wallet should warn *before* an address runs dry, not after.
3. **`decimals = 0` renders as whole units**, never with a decimal point.
4. **Ticker registration is commit → ~12 minutes → issue**, presented as
   front-running protection, not as an apology for a delay.
5. **Never say the network enforces balances.** It does not (§2). The accurate
   phrasing is that records are permanently recorded and ordered by the Divi
   chain.

---

## 6. Open questions for the DMT workstream

1. **Library or daemon?** The wallet needs the scanner callable in-process.
2. **State store shape** — the queries above are what the front end asks; the
   schema should serve them directly rather than being derived per call.
3. **Encoding API** — will the crate expose payload encoders, or should the
   wallet reimplement them? Reimplementing invites exactly the divergence
   `dvxp-core` exists to prevent, so the crate seems right.
4. **Genesis height** — still unset, and the wallet's initial sync cost depends
   entirely on it.

Until these land, the panel is built against a stub with these shapes, so
adopting the real indexer is a wiring change rather than a rewrite.
