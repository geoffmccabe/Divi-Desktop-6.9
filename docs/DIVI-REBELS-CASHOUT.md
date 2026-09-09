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
