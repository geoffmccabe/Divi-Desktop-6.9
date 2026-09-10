# Divi Rebels multiplayer: where it stands

Reviewed 2026-Sep-09. The room is the Cloudflare Durable Object in
`contrib/rebels-room`; the client is `ui/src/wallet/rebels/rebelsRoom.ts`.

## Verified working

- Join, roster, nameplates, paint and hull per player, 20Hz state,
  interpolation on the client, backoff on disconnect (live two-client test,
  earlier session; unit tests in `test/room.test.ts` and `rebelsRoom.test.ts`).
- The room owns the fight: fighters, waves, bullets, coins, hits, kills, DIVI,
  respawn. The client sends position and fire requests and draws what the
  room says. Position is bounded by the flight model's own speed; shots must
  come from where the ship is.
- Ledger credit on leave and death, cash-out request and payout (see
  `DIVI-REBELS-CASHOUT.md`).

## Fixed today

- **The mini gun threw on the server.** The room called `miniMuzzle` with an
  outdated argument list; every mini-gun message raised an exception. Fixed.
- **Purchased weapons did nothing in a room.** Beams were sent as pulse shots;
  the mini gun was not gated; extra tubes and magazines were ignored. Now the
  client declares its gear on join (`gear` in `JoinIn`), the room sizes the
  magazine and rack from the items exactly as the solo game does, refuses a
  weapon that was not declared, fires beams server-side (`k: "beam"`, `w`
  names which) with the same burst and cost, and streams beams in the state
  message (`M`) so every player sees every beam.
- **Enemy aim error by tier** applies in the room, since it shares the
  simulation.

## Fixed 2026-Sep-10 (evening)

- **The wallet could never reach the room.** The webview's content security
  policy (`connect-src` in `crates/app/tauri.conf.json`) did not list the
  room's host, so every socket was refused inside the app and the HUD sat
  on "retrying" for good, while a plain browser connected fine. The host is
  in the policy now, and `rebelsRoom.test.ts` reads the config and checks
  the client's room address is allowed, so it cannot quietly come back.

- **The fight starts over when everyone is down.** Geoff's rule: waves climb
  until every player is dead or gone, then wave one. An empty room already
  started fresh; now the last death does too. Gems survive a reset: they are
  property, not part of the fight.

## Not right yet, in order of how much it matters

1. **Gear is the client's word.** A client can declare a beam it never bought.
   The room refuses undeclared weapons, which keeps the fight consistent, but
   it cannot verify a purchase. Same root as points: a server-side purchase
   record. The Supabase `rebels_loadout` row exists now and the room could
   read it by owner name, which would at least make the two agree; it is
   still not proof. Decide whether that is enough for a playtest.
2. **Flocks are not in the room.** The room can simulate them but never
   spawns one, and the wire has no drone flag, so a room client would draw a
   drone as a fighter. This is Phase 3 of `DIVI-REBELS-FLOCKS-V2-PLAN.md`.
3. **Peers cost 5 to 15 draw calls each.** Twenty players is 200 calls before
   a fighter is drawn. Level of detail for distant peers is in the FPS plan.
4. **Account identity is the connecting address.** Right for payouts, wrong
   for two people behind one router. A wallet-signed identity is the proper
   fix and a bigger job.
5. **One room, "earth".** Fine for a playtest; more than about twenty players
   needs rooms per region or a lobby.
6. **No reconnect resume.** A dropped socket rejoins as a new seat: the run's
   score is banked on the drop, which loses nothing, but the ship respawns.

## Ready for a playtest?

For a handful of trusted players, yes: join, fly, fight the same waves, see
each other's shots and beams, bank kills, cash out. For an open test, item 1
means anyone can arm themselves for free, and item 2 means no flocks.
