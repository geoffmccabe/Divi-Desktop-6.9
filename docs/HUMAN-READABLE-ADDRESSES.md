# Human Readable Addresses (Divi Names) — what is built

Audience: another agent working on DD69, the explorer, or an indexer.

Plan and rationale: `Divi-Blockchain_6.9/docs/DIVI-NAMES-PLAN.md`.
Normative rules: `Divi-Blockchain_6.9/contrib/name-registry/`.

**No fork of any kind.** Records ride in `OP_META` exactly like PoE, NFD and DMT.
A node that never upgrades relays, validates and stores every one of these
transactions correctly and stays in consensus permanently; it simply cannot
resolve names.

---

## The core refactor that came with it

Three things were pulled out of feature code into shared code, because Divi
Names would otherwise have been the third copy of each.

**1. `crates/supervisor/src/dvxp.rs`** — all protocol-agnostic record plumbing:
choosing a funding coin, building the `OP_META` output, signing, broadcasting,
and parsing a script push back into a payload. `poe.rs` now uses its parser
instead of carrying a second one. NFD and DMT should adopt it next; the two
things it already gets right that are easy to get wrong are the three script
push forms (direct, `PUSHDATA1`, `PUSHDATA2`) and Divi's refusal to accept a
duplicate output address, which silently drops an output if you do not merge.

Funding uses `minconf=0` on purpose, so a batch of records chains through one
block instead of stalling at roughly one per minute. Divi predates Bitcoin's
mempool ancestor limit and has none, so those chains are unbounded.

**2. `crates/supervisor/src/base58.rs`** — Base58Check for Divi addresses, both
directions, hand written rather than a dependency. Sixty lines, fully tested,
and an address codec is exactly the kind of small security-relevant code that
should not arrive through the supply chain. Version bytes from
`chainparams.cpp`: mainnet P2PKH 30, P2SH 13; testnet 139 and 19.

**3. `crates/dvxp-core/` and `crates/name-registry/`** — vendored, byte-identical
copies of the chain repo's `contrib/` crates, so the wallet cannot drift from an
indexer. **Do not edit them here.** Edit the chain repo, then
`./scripts/sync-divi-crates.sh --apply`. Running that script with no arguments
checks for drift and fails loudly; wire it into CI when there is one.

---

## One namespace, not two

A DMT token ticker is simply a short Divi Name. `dmt-indexer/src/ticker.rs` is
now a thin adapter over `name_registry::charset` that pins the ticker length
bound at 8; names go to 32. DMT behaviour is unchanged and its 72 tests pass
untouched.

The reason is not tidiness. With two namespaces, `GEOFF` the person and `GEOFF`
the token are different objects owned by different people, and every wallet has
to disambiguate. That ambiguity is a phishing surface, and it would have been
permanent after launch.

**Charset stays uppercase-only ASCII.** That makes the entire Unicode homoglyph
attack class structurally impossible, which is a live unsolved problem for ENS.
The UI renders names in lowercase; the record stores uppercase, so `geoff`,
`Geoff` and `GEOFF` can never be three different people. Do not "add Unicode for
international names" later: it gives away the one thing we have that ENS cannot
get back.

---

## Wallet layer

`crates/supervisor/src/names.rs` owns the local index, the pending-commit store
and the flows. Two JSON files in the DD69 config directory:

| file | contents |
|---|---|
| `names-index-<chain>.json` | the scanned registry, one file per network |
| `names-pending.json` | commit salts, written BEFORE the commit is broadcast |

The salt write order matters. Crash after writing and before broadcasting and
you have a useless salt on disk, which costs nothing. The other order loses the
commit's fee and the name.

One file per network is deliberate: a single shared file meant switching between
regtest and mainnet threw the other network's index away and rebuilt it, which on
mainnet is hours of scanning to recover something already correct.

**Scanning** walks blocks in 500-block chunks. Divi's `getblock` takes a BOOLEAN,
not a verbosity level, and returns transaction IDs only, so outputs have to be
fetched one transaction at a time. To keep that affordable, each block is first
pulled as raw hex and searched for the four magic bytes; almost every block has
none and costs a single call. Resolving a record's author needs `txindex=1`;
without it a record is skipped rather than attributed to the wrong person, and
the panel says so instead of showing an empty registry. Reorg handling is deliberately blunt: if the last scanned block is no
longer on the chain, the index is rebuilt from the activation height. Correct at
any age and cheap while the registry is young. Incremental undo data is the
follow-up.

**Two compiled-in constants are still `None` and both block things on purpose:**

* `MAINNET_ACTIVATION` — the launch height. Until it is set, mainnet reports
  "not open yet" rather than scanning millions of blocks that provably contain
  no name records.
* `MAINNET_TREASURY` — where fees go. Registration is refused while it is unset,
  because a fee paid to a wrong address is lost silently and the user could
  never tell.

On regtest and testnet the activation height is 0, and the treasury comes from
`DIVI_NAMES_TREASURY`. That is how to test the whole flow today.

---

## Proven end to end on regtest

`crates/supervisor/examples/names_smoke.rs` drives the real flows against a real
daemon:

```
divid -datadir=~/divi-poe-regtest -daemon
DIVI_NAMES_TREASURY=<a regtest address> \
  cargo run --example names_smoke -- ~/divi-poe-regtest
```

Eleven steps, all passing: scan from scratch, quote and price, reserve, refuse a
reveal before maturity, register, appear in My Names, flip to taken, point at an
address and resolve it, claim a display name with both directions agreeing,
refuse a duplicate reservation, and stay stable across a fresh read.

**Keep this green.** Unit tests cover the rules engine and cannot catch the class
of bug that broke this feature twice: the rules and the transaction builder are
each individually correct but disagree about who authored a record. Only a live
chain shows that.

## Authorship: the thing most likely to be got wrong again

⚠ **Every rule here identifies a record's author as the address funding
`vin[0]`.** A reveal must come from the same address as its commit; an edit must
come from the name's owner; a display-name claim must come from the address the
name points at.

A wallet that picks coins freely will fund a record from an unrelated change
address. The transaction confirms, the fee is spent, and every indexer correctly
ignores it. Nothing happens and nothing complains.

Two things in `dvxp.rs` prevent that and must not be undone:

1. `select_coins` takes a `from` address and puts a coin from it FIRST. Only the
   first input is pinned, so a 50,000 DIVI registration does not require one
   address to hold the whole amount.
2. **Change returns to the author** rather than a fresh address. Otherwise the
   commit drains the author and the reveal twelve blocks later cannot be funded
   by the address the rules demand. This is not tidiness; it is what makes a
   two-step flow possible.

A consequence worth designing around in UI: claiming a display name requires the
address the name points at to hold a little DIVI, because that address has to
sign. Pointing a name at an empty address and then trying to display it fails,
with a message saying exactly that.

## Rules the index enforces

Everything below is covered by tests in `names.rs`. Anything failing a rule is
**skipped with no state change**; nothing ever destroys a name. That is the
deliberate rejection of Runes' cenotaph design, where a malformed record burns
holdings and an unrecognised field punishes anyone on older software.

* A reveal needs a matching commit, **from the same address**, at least 12 blocks
  deep. That converts a mempool race, winnable by fee-bumping, into a 12-block
  reorg, which is not winnable.
* A commit is spent once. First registration of a name wins, permanently.
* Only the owner can transfer, set records, clear records, renew or list.
* **Reverse resolution needs both directions to agree.** An address may claim a
  name as its display name only if that name's Divi-address record already
  points back at it, or anyone could display themselves as somebody else.
* A listing cannot be withdrawn inside its committed window. That window is what
  makes buying safe: it is what stops the Counterparty dispenser attack, where a
  seller cancels and keeps both the payment and the asset.
* A transfer clears any listing, so a new owner does not inherit a sale the
  previous owner priced.
* Renewing early keeps the unused remainder rather than truncating it.

---

## Not built yet

* **BUY.** The record type and the listing rules exist; applying a purchase needs
  the payment output checked against the listed price. Skipping it is safe and
  visible. Guessing would move a name for free.
* **Expiry enforcement.** `expiresHeight` is tracked and shown, and renewal
  works, but an expired name is not yet released. Grace period and the
  declining-price release auction are specified in `fees.rs` and unimplemented.
* **Send-box integration.** Typing a name into Send does not yet resolve. This is
  the highest-value remaining piece and also the highest stakes: whoever wires it
  must show the resolved raw address before broadcast, every time, never
  abbreviated behind the name.
* **Phone records.** The key exists and is refused in the clear, in both the UI
  and the Rust layer. A committed or encrypted form needs designing; the NFD
  X25519 sign-to-derive scheme is the obvious reuse.
* **Avatar and profile pointer.** Keys reserved; needs the NFD Arweave relay,
  which lives on the collectibles branch.

---

## Honest limits to keep saying

This is an overlay. The chain **carries and orders** the records; software
interprets them. Never write "the network enforces this" anywhere in UI or
marketing.

**Resolution is the highest-stakes thing this wallet does.** A wrong token
balance is embarrassing; a wrong address resolution sends somebody's money to a
stranger. The wallet therefore resolves only from its own index built from its
own node, and never asks a remote service. Keep it that way.
