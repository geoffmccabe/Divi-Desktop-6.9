# Payment Requests & Subscriptions on Divi

**Status:** Payment requests — built and shipping in Divi Desktop 6.9.
Subscriptions — designed, not built.
**Owner:** the DD69 wallet workstream. **Audience:** other Claude agents working
on the chain, the indexer, the scanner, DMT, NFDs and the bridge.
**Last updated:** 2026-Jul-20.

Read alongside, in the chain repo (`geoffmccabe/Divi-Blockchain_6.9`):
`docs/POE-NFT-RECORD-FORMAT.md` (the DVXP envelope), `docs/INDEXER-ARCHITECTURE.md`
(the shared `dvxp-core` crate), `docs/SOFTFORK-OPCODES.md`, `docs/DMT-TOKENS-SPEC.md`,
`docs/NFD-COLLECTIBLES-SPEC.md`.

---

## 1. What these two features are

**Payment requests** — "please pay me 50 DIVI for invoice 42", delivered
on-chain, arriving in the payer's wallet as a normal incoming transaction. The
payer sees it, and pays with one click. **A request is an invitation, never an
authorisation.** Nothing about it can move the payer's money.

**Subscriptions** — a recurring payment, e.g. 50 DIVI every month. The honest
framing matters: in a UTXO chain nobody can *pull* funds from a wallet. The only
question is **who enforces the arrangement** — the payer's software, or the
chain. Four designs are given in §6, from "standing order" to a genuinely
chain-enforced direct debit.

---

## 2. Record type allocation — claim this before you collide

Payment requests take **DVXP type `0x05`**. The registry as of writing:

| type | owner | meaning |
|------|-------|---------|
| `0x01` | chain/PoE | Proof of Existence anchor |
| `0x02` | NFD | Divi Collectibles (mint / transfer / key-announce) |
| `0x03` | chain/PoE | PoE Merkle batch root |
| `0x04` | DMT | Multi-token layer |
| **`0x05`** | **wallet** | **Payment requests (this document)** |

`0x06`+ are unclaimed. **If you need a type byte, add it to this table in a PR
so the next agent sees it.**

---

## 3. Wire format (implemented, forkless)

Envelope exactly as `POE-NFT-RECORD-FORMAT.md` defines it, in an `OP_META`
(`0x6a`) output, value 0:

```
"DVXP"(4) | version 0x01 (1) | type 0x05 (1) | subtype (1) | body
```

Hex prefix for matching: `445658500105`.

### subtype `0x01` — REQUEST (implemented)

| field   | size | encoding | meaning |
|---------|------|----------|---------|
| pay_to  | 21   | `dvxp-core` `Address` (version byte + hash160) | where the money should go |
| amount  | 8    | u64 little-endian, satoshis | `0` = payer chooses (donation) |
| expiry  | 4    | u32 little-endian, unix seconds | `0` = never expires |
| memo    | rest | UTF-8 | free text, capped at 480 bytes |

Fixed portion is 34 bytes after the 6-byte prefix, leaving ~560 for the memo
inside the 603-byte carrier. Parsers **must** bounds-check: this is attacker-
supplied data. Decode the memo lossily rather than rejecting — a hostile string
must not break a UI.

### subtype `0x02` — CANCEL (specified, not built)

| field | size | meaning |
|-------|------|---------|
| request_txid | 32 | the request being withdrawn |

Only meaningful from the original requester; an indexer **must** verify the
sender matches (see §5).

### subtype `0x03` — RECEIPT (specified, not built)

| field | size | meaning |
|-------|------|---------|
| request_txid | 32 | the request being settled |
| amount | 8 | u64 LE satoshis actually paid |

Gives a publicly verifiable invoice→settlement pair. Note the **one data output
per transaction** limit (`MempoolConsensus.cpp`): a payment carrying a receipt
cannot also carry any other DVXP record.

---

## 4. Delivery: the notification-output trick

**This is the part to copy if you build anything similar.**

The addressing problem: a bare `OP_META` record gives the payer no way to know
it exists without scanning every block.

The solution: a request transaction has **two outputs** —

1. a small payment to the **payer's own address** (the notification), and
2. the `OP_META` record.

The payer's wallet already watches its own addresses, so requests arrive through
entirely ordinary machinery (`listtransactions` → `getrawtransaction` on
receives only). **No chain scan, no indexer, no new infrastructure**, and it
works on today's node with no fork.

Properties worth keeping:

- **Spam-resistant by construction.** Sending costs a fee plus the notification
  (currently `0.0001 DIVI` each). Mass-begging costs real money.
- **Self-cleaning.** When the payer pays, the wallet spends the notification
  output as an input, so the dust does not accumulate in the UTXO set.
- **Costs the payer nothing** to receive.

Anyone building a "message the holder of address X" feature (bridge
notifications, NFD offers, DMT airdrop announcements) should reuse this shape
rather than inventing another one.

---

## 5. What an indexer/scanner should do with type 0x05

For `dvxp-core`, this is one `RecordHandler` (`record_type() -> 0x05`). Notes
for whoever implements it:

- **`RecordContext.sender` (vin[0] prevout address) is the requester.** It is
  not in the body — deliberately, to save bytes — so ownership rules must come
  from the context.
- **CANCEL must check the sender matches the original request's sender.**
  Otherwise anyone can cancel anyone's invoices.
- **The requester is not the payee.** `pay_to` can be a different address, which
  is legitimate (a shop asking payment to its treasury). Do not assume they
  match, and do not display the sender as the payee.
- **State model:** `request_txid → {payer, pay_to, amount, expiry, memo, status}`
  where status is open / cancelled / paid / expired.
- **Settlement detection is heuristic**, and the scanner should say so: a payment
  to `pay_to` of the right amount after the request is *probably* settlement, but
  only an explicit RECEIPT record proves it.

**For scan.divi.love:** the useful views are a request's status, and an address's
open requests. Do not present unconfirmed requests as real — same rule as PoE
anchors.

---

## 6. Subscriptions — four designs, none built yet

The chain facts that constrain all of this (verified in `divi/src/script/`):

- `CLTV` (`0xb1`) is **present and active** — absolute timelocks work.
- `CSV` (BIP112, relative timelocks) is **absent**; `0xb2` is still a plain NOP.
- **`OP_LIMIT_TRANSFER` (`0xb8`) is a real covenant, live today.** It takes a
  limit and a 20-byte P2SH hash and enforces that when the output is spent, at
  most `limit` leaves and the remainder returns to that script.
  ⚠ It checks `vout[nIn]` — the output at the **same index** as the input being
  spent — so transactions must be built with the change in a specific position
  (`SignatureCheckers.cpp: CheckTransferLimit`).
- No witness data, no smart contracts, tx v1 only.

**Design A — standing order (wallet-side).** The wallet remembers the schedule
and sends on time. Trivial to build. Only pays while the wallet runs **and is
unlocked** — and note the staking-only unlock deliberately cannot spend, so this
needs a new limited unlock mode. That is a real security decision, not a
checkbox: a wallet that can spend unattended is a different threat model.

**Design B — pre-signed future payments.** The payer signs N transactions in
advance with increasing `nLockTime`, each spending the previous one's change.
The payee holds them and broadcasts one per period. Nothing need be online. The
payer can cancel by spending the coin first. Forkless, works today.

**Design C — chain-enforced, still forkless.** A P2SH script with two branches:
the payee may take at most the period amount (`OP_LIMIT_TRANSFER`) with the
remainder forced into a follow-on script that `CLTV` locks until the next due
date; or the payer may reclaim everything at any time (cancellation). Chaining
the per-period scripts requires building them **backwards** — the last period's
script hash must be known to embed in the previous one. Real direct debit,
enforced by consensus, using only opcodes Divi already has. Limits: fixed number
of periods, funds committed up front.

**Design D — add `CSV` in the combined soft fork.** One relative-timelock opcode
collapses Design C's chain of scripts into a single script meaning "at most X per
30 days, indefinitely". `0xb2` is already the reserved slot.

### Soft-fork note

**Per Geoff's decision, there will be ONE soft fork carrying all new features.**
So `CSV`, and any subscription-specific opcode, ride the same flag day as
whatever else is queued. Nobody should plan a separate activation.

If a native payment-request opcode is ever wanted (`OP_PAYREQ`), follow the
precedent already set by `OP_POE`/`OP_NFD`: an **undefined** opcode (not an
`OP_NOP`) as the first byte of a provably-unspendable output. A NOP-based
unspendable output is **anyone-can-spend on old nodes**, because the NOP is a
no-op and the trailing data push leaves a true value on the stack. `0xba` and
`0xbb` are taken; the next free ones are `0xbc`+.

---

## 7. Wallet implementation (what exists today)

In `geoffmccabe/Divi-Desktop-6.9`:

- `crates/supervisor/src/payreq.rs` — encode/parse/create/inbox, plus unit
  tests covering round-trip, hostile/truncated input, and rejecting a PoE
  record. **Reuse `parse_request` rather than re-deriving the format.**
- `crates/app/src/main.rs` — Tauri commands `payment_request_create`,
  `payment_requests_inbox`.
- `ui/src/wallet/PaymentRequests.tsx` — inbox + ask form, nav item "Payment
  Requests".

Constants: notification `0.0001 DIVI`, memo cap 480 bytes, fee reuses
`poe::MIN_FEE_DIVI`.

### Known limitations (do not paper over these)

1. **Requests are public** — amount, memo and both addresses are on-chain and
   readable by anyone. The private version should reuse the NFD **key-announce**
   record (type `0x02` subtype `0x03`) to encrypt the body to the payer, rather
   than inventing a second key mechanism.
2. **CANCEL and RECEIPT are specified but not implemented.**
3. **The inbox reads only received transactions**, so a request sent without a
   notification output is invisible to it. That is intended.
4. **No settlement tracking yet** — the wallet does not mark a request as paid.
5. `pay_to_address` decoding uses the node's `decodescript`; if that RPC is
   unavailable the UI falls back to showing the raw 21-byte hex.

---

## 8. Integration checklist for other agents

- **Chain/indexer:** add the type-`0x05` handler to `dvxp-core` per §5.
- **Scanner:** render request status; never show unconfirmed as settled.
- **NFD:** the key-announce record is the dependency for private requests — tell
  the wallet workstream if its format changes.
- **DMT:** requests are DIVI-denominated today. A token-denominated request
  needs a token id in the body; that is a **new subtype**, not a reinterpretation
  of `0x01`. Coordinate before allocating.
- **Bridge:** the notification-output pattern (§4) is the recommended way to tell
  a Divi address that something happened on another chain.
