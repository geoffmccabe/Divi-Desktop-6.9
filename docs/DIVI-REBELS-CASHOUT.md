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

## ⛔ SUPERSEDED: the first payout address (2026-Sep-27)

**Do not wire `D6V6dP2L5CN386Wg1LZF7KszXxuuSDvmmd` into anything.** It is kept
here rather than deleted so that nobody re-finds it in a chat log and uses it.

It is a child of the main scan node's wallet, and that is exactly what made it
wrong: see blocker 4 below for why an address inside a wallet gives the payout
key the run of the whole wallet. Geoff's answer was better than either option
either session proposed — rather than accept the risk or move the float, he is
fixing it at the source:

> *"I will add a way within Dd69 to add extra parallel wallets, then get you an
> address, and I'll put more DIVI in here when it doesn't run dry. So start
> building what you can around this and the last plans and assume you'll have an
> address to work from and a way to draw from it too."*

So Rebels gets a **dedicated parallel wallet** holding only the game float, and
the address below is replaced by one from it. Build against that assumption; the
real address is still to come.

## The address as received (2026-Sep-27, superseded, NOT in use)

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

### 4. The wallet question, which the address answers and then reopens

Geoff, 2026-Sep-27: *"the addr i gave you is a child addr generated from the
main divi scan node address, the one on fasthosts in london"*.

That closes risks 1 and 2 above on his own word: the address is his, chosen
deliberately, and derived from a wallet whose key the London box holds. It opens
a bigger one in their place, raised by the gameplay session.

**An address is not a pot you can spend from.** Checked in the node source
rather than assumed from Bitcoin habit: `sendtoaddress` takes a destination and
an amount and has NO source parameter (`rpcwallet.cpp:1310`), and selection runs
over the whole wallet's UTXOs. So "pay Rebels winnings from the treasury
address" means, at the RPC level, "pay from whatever that wallet holds". The
payout key's reach is the entire scan node wallet, not a Rebels float.

The three consequences, each checked in the source rather than reasoned about,
because two of them turned out milder than they first looked and one did not:

| | Status |
|---|---|
| **Blast radius is the whole wallet** | **REAL, and the one that matters.** The doc above says "keep it small; it is a hot wallet", and that instruction cannot hold if the wallet is also the scan node's. `REBELS_DAILY_CAP` still bounds a bug or a break-in to 2,000 DIVI/day and remains the real backstop, but what sits behind it is no longer a small float. |
| **A payout could spend a staking UTXO** | Real but mild. There is no auto-lock for staking coins, so a payout can spend one. Nothing breaks: the node simply has less staking. Worth knowing, not worth alarm. |
| **A payout could spend masternode collateral** | **Handled by the node, PROVIDED two things.** `LockUpMasternodeCollateral()` is called at startup (`init.cpp:1599`) and locked coins are skipped by coin selection (`AvailableUtxoCalculator.cpp:91`), so a routine payout cannot spend a locked collateral outpoint. The locks are memory-only, which does not matter, because init re-applies them every start. The two provisos, both defaults going the right way and neither checkable from here: the collateral must be **declared in masternode.conf** (the lock walks `masternodeConfig.getEntries()` and nothing else), and **`-mnconflock` must not be 0** (`MasternodeModule.cpp:456`, default true). Say "protected provided X and Y", never just "protected": the difference is the whole value of the claim. |

**The question put to Geoff:** should the Rebels treasury share the scan node's
wallet, or be its own wallet holding a small float, with this child address
funded from the node rather than living inside it?

**Both sessions recommend a separate wallet.** It is the hot/cold separation
this document was already reaching for, and it makes the daily cap a second line
of defence rather than the only one. No amount of coin locking fixes the first
row of that table; only a different wallet does.

---

---

## What Geoff decided (2026-Sep-27)

All four blockers answered. Recorded as his decisions, with what each one does
and does not settle.

**The wallet — a dedicated parallel wallet.** Not a child address of the scan
node. This closes blocker 4 by design rather than by accepting it: the payout
key will reach a wallet holding only the game float, which is the hot/cold
separation both sessions recommended. Waiting on the address.

**The gate — LW-Auth, not a number we choose.** Authentication is coming to the
web version and becomes the Sybil boundary, with KYC or self-custody-only
withdrawal held in reserve if it proves insufficient. **So no guest payout path
is to be built.** This is the right shape: the earlier proposal was a starter
amount per connecting address, which would have made an IP the boundary, and an
IP is cheap. An account someone had to authenticate is not.

**The rate — stays at 1 DIVI per sphere**, explicitly and knowingly. Geoff:
*"Nobody is so good that they can capture 5850 of those spheres, they couldn't
possibly do that, not in an hour. Not even in a day."* He is right that the
figure is a ceiling nobody reaches: it assumes clearing every enemy of every
wave for an hour without dying. The arithmetic, from the constants in
rebelsCombat.ts so it can be rechecked when they change:

| | |
|---|---|
| waves in an hour | 3600 / `WAVE_SECONDS` 120 = **30** |
| enemies per wave | `WAVE_FIRST` 10 + (n-1) x `WAVE_STEP` 2, so 10, 12, 14 ... 68 |
| enemies in an hour | 30 waves, averaging 39 = **1,170** |
| spheres | x `COIN_PER_KILL` 5 = **5,850** |
| DIVI at 1 per sphere | **5,850/hour, clearing everything** |

Fractions matter more than the ceiling, because nobody clears everything: a
quarter of it is still about 1,460/hour, which is most of the current float in
an hour and a half. **Nothing drains** at any of these numbers — guests cannot
withdraw, and the 2,000/day cap holds — so what accrues is an unpayable balance
rather than a loss. That makes it an expectation problem, not a security one,
and it is the reason `EARN_PER_DAY` stays even with a dedicated wallet: it
bounds the debt, and the debt now grows faster than the float.

Until the dedicated wallet's address arrives, this section is a record and not a
configuration.

## The debt grows faster than the float pays, and by how much

Written 2026-Sep-27, when custom enemies landed and made it worth putting a
number on. Not a bug and nothing here is broken: two different ceilings bound
two different things, and they do not agree.

| Ceiling | What it bounds | Value |
|---|---|---|
| `EARN_PER_DAY` (`ledger.ts`) | what ONE account may be CREDITED in a day | 10,000 DIVI |
| `REBELS_DAILY_CAP` (payout service) | what the WHOLE GAME may actually PAY OUT in a day | 2,000 DIVI |

So a single player may be credited five times what the treasury pays everybody
in a day, and twenty active players may be credited a hundred times it. The cap
does its job: no more than 2,000 DIVI a day leaves the wallet whatever happens.
What it does not do is stop a balance being promised that cannot be drawn.

**Custom enemies did not change either ceiling. They changed the SPEED.** A
built-in fighter drops `COIN_PER_KILL` 5 spheres at a DIVI each, so 2,000 kills
reached the daily allowance. A custom enemy at `WORTH_MAX` 10 drops 50, so 200
kills reach it. The ceiling per player per day is the same 10,000 it was; it is
simply reachable in a tenth of the time, and `WORTH_MAX` is what keeps that from
being worse.

**The decision this needs is Geoff's and it is not a code one.** Three honest
options, and doing nothing is one of them:

1. **Leave it.** Correct while the player count is small and nobody is near
   either ceiling. It costs nothing today and the cap is a real backstop.
2. **Bring `EARN_PER_DAY` down toward the payout cap**, so credit roughly tracks
   what can actually be paid. Safest, and it makes a player's balance mean
   something, but it caps a good session rather than an abusive one.
3. **Raise `REBELS_DAILY_CAP`** and fund the float to match what the game
   promises. The only one that lets the game pay what it says, and the only one
   that costs real DIVI.

Until it is decided, the thing NOT to do is quietly credit balances nobody can
withdraw, because the first player to try is the one who finds out.

### Decided 2026-Sep-28: raise the cap and fund the float

Geoff chose option 3. The earning rate stays as it is, and the treasury is
raised and funded to match what the game actually promises. Recorded here
rather than applied, for a reason he set himself.

**BLOCKED, and on his own earlier decision rather than on anything new.**
`REBELS_DAILY_CAP` lives in `/etc/divi-rebels-payout.env` on the London box, and
the wallet it currently bounds is the SCAN NODE'S wallet. Raising the cap there
would multiply the blast radius of the one risk this document calls "REAL, and
the one that matters", on an unencrypted hot wallet, in the same week he decided
to stop using that wallet. The cap is presently the ONLY line of defence around
it; raising it before the wallet moves removes most of what is left.

So the order is: dedicated wallet first, then the cap. Both need the address
that is still outstanding, which means one delivery unblocks both.

**When the address arrives, three changes and no code:**

| Change | Where | From | To |
|---|---|---|---|
| Payout wallet | London node | scan node wallet | the dedicated one |
| `REBELS_DAILY_CAP` | `/etc/divi-rebels-payout.env` | 2,000 | see below |
| Float | the dedicated wallet | n/a | about two days of the cap |

**Sizing the cap.** One principled anchor rather than a guess: `EARN_PER_DAY` is
10,000, so **10,000 a day is the cap at which the treasury can honour one player
having a maximal day**. That is the floor of any sensible answer. Multiply by the
number of people expected to play hard on the same day for the rest: about
25,000 for ten regulars, which is what the two sample games credit at roughly
twenty clears between them.

Two days of float rather than one, because a timer that fails overnight must not
strand payouts, and the float is refilled by purchases rather than by hand.

**What stays true whatever number is picked:** the cap is a backstop against a
bug or a break-in, not an economy control. `EARN_PER_DAY` is what bounds the
debt, and it stays. Raising the cap makes the game able to PAY what it promises;
it does not make anything safe that was not safe before, and every DIVI the cap
is raised by is a DIVI a break-in could take in a day.

## The address arrived, and it does not close blocker 4 on its own

Geoff, 2026-Sep-28: *"This will be the Divi Rebels pool/payout address:
D5Pf9vNNcdCPFkTCKpQjkHMcSRrWE7zCLu which is 'Wallet #2' in the Divi Scanner
node."*

Checked: 34 characters, leading D, clean base58, and different from the
superseded `D6V6dP2L5CN386Wg1LZF7KszXxuuSDvmmd`. Recorded, NOT wired.

**⚠ THE PAYOUT SERVICE CANNOT CHOOSE A WALLET.** Read in the daemon source
rather than assumed:

| Fact | Where |
|---|---|
| RPC acts on the ACTIVE wallet, resolved once | `init.cpp:220`, `multiWalletModule->getActiveWallet()` |
| `sendtoaddress` takes a `CWallet*` it is HANDED, not one it picks | `rpcwallet.cpp:1306` |
| There is no per-call wallet parameter | `rpcserver.cpp:1043`, `CWallet* pwallet = GetWallet()` |
| `setactivewallet` is not an RPC at all | absent from the RPC table |
| `loadwallet` IS an RPC and also switches coin minting | `rpcwallet.cpp:524`, `SwitchCoinMintingModuleToWallet` |
| The active wallet's name CAN be read | `getwalletinfo` → `active_wallet`, `rpcwallet.cpp:2894` |

So `sendtoaddress` spends whatever wallet that daemon has active, and nothing
about the destination or the treasury address changes it. **Funding Wallet #2
does not make payouts come out of Wallet #2.** If the scan node's main wallet is
still the active one, that is what gets spent, staking coins included, and the
only symptom would be a balance falling somewhere nobody is watching. The
separation would look done and would not be done.

### The two ways to actually get it, and they are not equivalent

1. **A separate daemon for the Rebels wallet** — its own datadir and rpcport,
   holding only the float, with the payout service pointed at it. The scan node
   keeps its own wallet active for staking and its masternode. This is the real
   hot/cold separation and the only option where the payout key cannot reach the
   node's coins at all, because it is not talking to that daemon.
2. **Make Wallet #2 the scan node's ACTIVE wallet** — one setting, no new
   process, but `loadwallet` moves the coin-minting module with it, so the node
   would stake from the game's float wallet instead of its own. That trades a
   money-safety problem for a node-operations one.

**Recommended: option 1.** Option 2 is cheaper today and is the kind of saving
that is repaid with interest by whoever is debugging staking in three months.

### Shipped meanwhile: the guard, which is right under either option

`REBELS_WALLET` in `/etc/divi-rebels-payout.env`. Set it to the wallet filename
payouts must come from, and a round **refuses to pay anything at all** if the
daemon has a different wallet active, checked before even reading the balance
(`getbalance` reads the active wallet too, so a figure from the wrong wallet
looks perfectly healthy).

**Unset, it is inert and says so on every round.** Deliberate: failing closed by
default would have stopped live payouts the moment it shipped, which is not a
change to make on a script's own initiative. **Setting it is part of the
cutover**, and until it is set the guard protects nothing.
