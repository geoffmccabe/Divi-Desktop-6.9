# Divi Rebels: cashing out

How DIVI won in the game becomes DIVI in a wallet. Built 2026-Sep-09.

## The shape

Three machines, each doing the one thing only it can:

| Where | What it knows | What it can do |
|---|---|---|
| The cockpit (DD69 app) | nothing it is trusted on | ask, and show the answer |
| The room worker (Cloudflare) | which account is asking | write the request down |
| The ledger (Cloudflare Durable Object) | what every account is owed | reserve, confirm, release |
| The London node | the treasury key | move coins |

Nothing about an amount is ever decided on the player's machine.

## The account

The ledger account is the address the cockpit's socket connected FROM, as
Cloudflare saw it (`CF-Connecting-IP`). It is not the node string the client
sends, because the client can send anything. A node's public address is the
one thing about it nobody else can present.

Consequences, stated in the panel: two players behind one home router share
one account; a VPN moves yours.

## The conversation

1. Player presses CASH OUT with a destination address. The app checks the
   address with the local node (`validate_address`) before sending anything.
2. The room banks the current run, then asks the ledger to record the request
   under the seat's account. The ledger refuses under 100 DIVI, refuses a
   second request while one is waiting, and refuses a malformed address.
3. Every minute the London payout service (`/usr/local/bin/divi-rebels-payout.py`,
   timer `divi-rebels-payout.timer`) asks the ledger for what is waiting.
4. For each: `validateaddress` on the node (rejected with a reason if bad),
   `reserve` (the ledger takes the amount out of the balance BEFORE any coin
   moves, which is the protection against paying twice), `sendtoaddress`,
   `confirm` with the txid. The receipt appears in the player's panel.
5. A send that fails releases the hold; the request survives for next round.
   A send that succeeds but cannot be confirmed is written to
   `/var/lib/divi-rebels/payout.json` and confirmed first thing next round;
   if the hold has expired by then the case is parked for a person.

## Brakes on the London side

Environment in `/etc/divi-rebels-payout.env` (0600, root):

- `REBELS_DAILY_CAP` (default 2000 DIVI a day). Bounds any bug or break-in.
- `REBELS_KEEP_BACK` (default 5 DIVI) left in the wallet for fees.

The wallet on London is UNENCRYPTED, which is what lets a timer send without
a passphrase. It holds the treasury address that purchases are paid to, so
income refills it. Keep it small; it is a hot wallet.

## Routes

Public (with the payout secret): `/ledger/pending`, `/ledger/reserve`,
`/ledger/confirm`, `/ledger/release`, `/ledger/reject`, `/ledger/balance`,
`/ledger/top`.

Binding-only (a room speaking over the Durable Object binding, refused from
the internet by both the router and the object): `/ledger/credit`,
`/ledger/purse`, `/ledger/request`.

## Operating it

    ssh root@109.228.38.104
    journalctl -u divi-rebels-payout.service -n 50      # what it did
    cat /var/lib/divi-rebels/payout.json                # today's total, anything parked
    python3 /usr/local/bin/divi-rebels-payout.py --dry-run   # (with the two env files loaded)

Reinstall after editing: `sh contrib/rebels-room/payout/install.sh`.
Redeploy the worker after editing it: `cd contrib/rebels-room && npx wrangler deploy`.

## Not verified end to end

No account has reached 100 DIVI yet, so the full chain (request, reserve,
send, confirm) has been exercised only by the unit tests on the ledger and
room, and by the service's dry run against the live ledger. The first real
payout should be watched in the journal.

---

## The Divi Rebels payout address (received 2026-Sep-27, NOT yet in use)

Geoff, relayed through the gameplay session: *"D6V6dP2L5CN386Wg1LZF7KszXxuuSDvmmd
for the Divi Rebels address"*. He describes it as a child address of his Scanner
node wallet, to be the source rewards are paid from.

```
D6V6dP2L5CN386Wg1LZF7KszXxuuSDvmmd
```

**Decoded three times by implementations sharing no code**, before being written
down. All three agree:

| | |
|---|---|
| version byte | 30 |
| hash160 | `0ec084cc0c1bb7d025db7476f2b6a98d0eb769d5` |
| checksum | `cb266df4`, calculated and seen |

Version 30 is `base58Prefixes[PUBKEY_ADDRESS]` in `CMainParams`
(chainparams.cpp:234), so this is specifically a mainnet pay-to-pubkey-hash
address: not a script address, which is 13, and not testnet. Each check was also
shown to REJECT a deliberately bent character, because a validator that accepts
everything proves nothing.

### Nothing points at it yet, and that is deliberate

The payout service still pays from the London hot wallet
(`/usr/local/bin/divi-rebels-payout.py`, see above). Three things have to happen
before this address sends a coin, and none has:

1. **Geoff confirms the address directly**, and the question to put to him is a
   specific one. Three separate things could be wrong with a payout address, and
   they need separating, because the checks above only close one of them:

   - **Transcription** — a character lost or changed between his message and
     this file. **Closed.** A base58check address carries a four-byte checksum,
     so a corrupted address fails validation; only about one in four billion
     mangled strings would slip through. Three implementations sharing no code
     decoded this one to the same hash160 and the same checksum, and each was
     shown to reject a deliberately bent character. Relaying this particular
     kind of string is self-checking, which is not true of relaying in general.
   - **Substitution** — a whole, valid, *different* address put in place of the
     right one anywhere along the way. **Not closed, and no checksum can close
     it**, because the substitute is well formed by construction. This is the
     entire reason "check the destination at the source" is the standing rule
     for moving crypto rather than a formality: address-swapping is a known
     attack class precisely because every automated check still passes.
   - **Intent** — whether this well-formed mainnet address is the wallet he
     actually wants Rebels paid into, and whether he still holds its key today.
     **Not closed by anything technical.** If he pasted a different wallet of
     his own, or one from another project, every check either session can run
     still passes.

   So the question is not "did it arrive intact" — that is provable and proven.
   It is: **is this the wallet you want Rebels payouts to land in, and do you
   hold its key today?**
2. **The guest sign-in gate is decided.** Web guests cannot cash out at all
   today (`mayCashOut` refuses every guest), and that gate is currently the only
   thing standing between us and unlimited free accounts, because a guest's
   account key is a string their own browser invents. Paying guests means
   loosening it, and how far is a money decision.
3. **The rate is settled.** A Divi Sphere is one whole DIVI, so a fighter pays 5
   and a player clearing waves earns roughly 5,850 an hour, against a wallet
   holding about 1,880 and a global cap of 2,000 a day. Nothing can be stolen at
   those numbers, but the first serious player empties the float.

Until all three, this section is a record and not a configuration.
