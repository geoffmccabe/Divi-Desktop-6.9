# Divi Rebels: purchases, and where they are saved

Written 2026-Sep-09 after two faults from a recorded session.

## Whose guns they are

The player's, on every hull. Ownership was per ship (keyed by ship model),
which is how a minigun bought while the market showed Fighter 03 was missing
from Fighter 05 in flight. Now one set for the account
(`dd69.rebels.owned` = `{"*": [...]}`); the old per-ship save is folded in on
first read so nothing paid for is lost. Every caller still passes a ship id
and it is ignored (`rebelsArmoury.ts`).

## Saved to the account

The same account the ships and scores already use: the DD69 Supabase project
(`exchanges.ts` has the URL and public key), keyed by the node's name
(`playerName()`), table `rebels_loadout`, written only through the
`rebels_loadout_save` function. Migration:
`contrib/rebels-room/supabase/0002_rebels_loadout.sql` (applied).

- Saved a moment after any change to points or ownership (`rebelsLoadout.ts`).
- Read once when the game attaches and merged in: points earned and spent
  take the larger of the two copies, owned and purchases the union. So a
  reinstall or a second machine gets its guns back, and a stale copy on
  either side cannot undo a purchase.
- Direct writes to the table are refused (verified: 401); the function
  refuses negative points, non-arrays, and oversized payloads.

**What this is not:** proof. Like the scores, the row is the client's word.
Points are still a balance the client declares. The verified path is the
one the wallet's own points already use: confirm DIVI purchases by what
reached the treasury address on chain, and hold the balance server-side.
That is the next job if the economy matters.

## The map rebuilding under the game

The Node Map tears down and rebuilds its whole scene whenever its node list
changes (polled every ten seconds) or a map setting changes. It hands the
game back its scene and then a new one. That used to end the game: run
banked, room left, fight discarded, opening music back on, and from the
cockpit it looked like enemies had stopped coming. The black box confirmed
it: phase "fly", wave null, room off, opening music playing.

Now a detach mid-flight is a suspension: fight, flight, room and music are
kept; the next attach puts everything into the new scene and halves the
towers again. A detach not followed by an attach within 400ms
(`SUSPEND_GRACE_MS`) was the panel closing, and only then does the run end.
`dispose()` ends it at once.

## Every purchase, reviewed

| Purchase | Path | State |
|---|---|---|
| Weapons (points) | `buyWithPoints` → account set → saved to account | fixed, tested |
| Items (points) | same | fixed, tested |
| Points with DIVI | real send via `PurchaseWithDivi`, credited once per txid, saved to account | working (Geoff's 1,001 DIVI purchase credited 1,262.9 points), tested |
| Convert DIVI to points | local counters, saved to account | working |
| Cash out | ledger + London payout | built, awaiting first real payout |
| Ships | free to fly; choice and paint saved to `rebels_ships` | working |
