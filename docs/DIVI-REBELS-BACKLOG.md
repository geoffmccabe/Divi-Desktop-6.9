# Divi Rebels: the running list

Every instruction Geoff has given, in the order given, with what actually
happened to it. Audited 2026-Sep-06. Anything not marked DONE is either in
progress or waiting on him, and the waiting ones say what for.

Branch `feat/divi-rebels`, cut from `integration/all-features`. Installed builds
are versioned 69.7.x.

## Done

| # | Asked for | Where it lives |
|---|---|---|
| 1 | A Star Wars style vector arcade game | `crates/app/src/community/divirebels/` |
| 2 | Call it Divi Rebels | throughout |
| 3 | Make the enemy look like a TIE fighter | `rebelsFx.ts` `makeFighter` |
| 4 | Scope multiplayer over the node globe | `docs/DIVI-REBELS-ORBIT-SPEC.md` |
| 5 | Build phase 1: fly, dock, rearm | `ui/src/wallet/rebels/` |
| 6 | Use the REAL globe and towers, not a lookalike | `GlobeMap.tsx` `flight` hook |
| 7 | Mini-globe scale, 1m = 100km | `orbitWorld.ts` R = 100 |
| 8 | TIE button by Flat/Globe, game inside the window | `NetworkMap.tsx` |
| 9 | Hide the blockstream AND its eye while playing | `NetworkMap.tsx` |
| 10 | Cockpit view, no ship in the middle | `rebelsController.ts` |
| 11 | Guns from the screen edges, converging | `rebelsCombat.ts` `gunMuzzles` |
| 12 | 3D bullets that obey physics | `rebelsCombat.ts`, `rebelsFx.ts` |
| 13 | Enemy fighters that spawn, chase and attack | `rebelsCombat.ts` |
| 14 | Bullets hitting towers explode | tower stays; it is a real node |
| 15 | Better explosions | `rebelsFx.ts` flash, debris, shockwave |
| 16 | Laser sound, twice 0.05s apart, ±10% | `rebelsAudio.ts` |
| 17 | Recharge station sound while docked | `rebelsAudio.ts` |
| 18 | Torpedoes: 2, ctrl-click, 4s fuse, 5x damage | `rebelsCombat.ts` |
| 19 | Torpedo and ship explosion sounds | `rebelsAudio.ts` |
| 20 | Shields pulse 3/sec ±20%, half as solid | `rebelsFx.ts` `makeShieldRig` |
| 21 | Bullets gold and half the size | `rebelsFx.ts` |
| 22 | Explosions half the size | `rebelsFx.ts` |
| 23 | One continuous dive from orbit to your node | `rebelsController.ts` phases |
| 24 | Fence the pointer in, ESC to leave | pointer lock plus a click fence |
| 25 | Enemies 100 shield, overflow to hull | `rebelsCombat.ts` `hurtEnemy` |
| 26 | Knockback and spin scaled by damage | `rebelsCombat.ts` |
| 27 | Wreckage in 3 pieces, orbiting, decaying | `rebelsCombat.ts` junk |
| 28 | Wreckage is shootable and dangerous | `rebelsCombat.ts` |
| 29 | Shield bubble with a percentage | `rebelsFx.ts` |
| 30 | Stake win = 3x damage for 60s | reads `stakeWin.ts` |
| 31 | Points = damage done, never more | `hurtEnemy` returns what landed |
| 32 | Points bottom right, large | `RebelsHud.tsx` |
| 33 | Leaderboard by node name, else address | `rebelsScores.ts` |
| 34 | Points reset on death | `rebelsController.ts` |
| 35 | Top 100, best game and all time | `rebels_scores` table |
| 36 | High Scores button and modal | `RebelsScoreboard.tsx` |
| 37 | Player has 100 shields too | `orbitFlight.ts` |
| 38 | Enemy fire green, single stream, 10-100 | `rebelsFx.ts`, `rebelsCombat.ts` |
| 39 | Enemy magazine then a 10s recharge | `rebelsCombat.ts` |
| 40 | Perfect enemy accuracy, dodgeable | aims at where you are, now |
| 41 | Only the left button shoots | `rebelsController.ts` |
| 42 | Right button raises a red guard | `rebelsFx.ts` `makeGuardShell` |
| 43 | Guard: 0.5s, 10 uses, soaks 80%, home refill | `orbitFlight.ts` |
| 44 | Scores in Supabase | `supabase/migrations/*_rebels_scores.sql` |
| 45 | One leaderboard place per player | one row per name, both tables |
| 46 | Tower windows and a turning beacon | `towerLights.ts`, from Kaiju |
| 47 | Watch the GPU cost of all those windows | shared materials, shader LoD |
| 48 | Seven rarity tiers of enemy ship | `rebelsCombat.ts` `TIERS` |
| 48b | Per-tier kills kept for ever, per player | `rebels_scores.tier_kills` |
| 49 | Mini gun on E: aims at the pointer, quarter damage, quarter round | `rebelsCombat.ts` |
| 50 | Your tower red, the stake winner keeps gold, on map and in game | `tokens.ts` mapSelf |
| 51 | Docking STOPS the ship for the resupply | `orbitFlight.ts` |
| 52 | 3D enemy fire: panned and attenuated by where it was fired | `rebelsAudio.ts` |
| 53 | Tracers on every round, lingering three seconds | `rebelsCombat.ts` |

## Next, and in this order

Geoff chose the server (option B) on 2026-Sep-06, with anti-cheat as a
requirement rather than an afterthought, and the DIVI payout depends on it. So
these are one piece of work in two halves, and the second cannot ship first.

He also settled the privacy question: broadcast the REAL node location, because
connecting the game to reality is the point of it. So a player's position is
their node's actual position and their callsign is theirs, with no fuzzing and
no choosing a different hangar.

### 54. Server-authoritative multiplayer, with anti-cheat

A Cloudflare Durable Object room. Scoped in `docs/DIVI-REBELS-ORBIT-SPEC.md`.
The reason it comes first is that everything a player currently reports about
themselves is taken at its word: kills, score, and the leaderboard row. That is
fine for a toy and drainable the moment DIVI is attached to it.

What "anti-cheat" has to mean here, because it is easy to build the wrong thing:

* **The server owns the fighters and the hits.** It spawns them, it moves them,
  and it decides what died. A client that says "I killed forty" is ignored; it
  can only say "I fired, here, in this direction, at this tick".
* **Encryption is not the defence.** The connection is already wss, which stops
  somebody else reading it. It does nothing about the player themselves lying,
  and they are the threat. Only the server owning the simulation fixes that.
* **Rate and plausibility limits at the room**: shots per second, damage per
  minute, session length, kills per minute. A client that exceeds what the game
  physically allows is disconnected, not merely ignored.
* **Identity is the node.** Sign in with the Divi address, and running a node is
  the barrier to entry. Worth being honest about its size: if the prize is real
  money, setting up a node is a morning's work, so node ownership raises the
  cost of an attack, it does not prevent one. Per-node caps still matter.
* **The leaderboard becomes server-written.** Today the wallet calls
  `rebels_submit` directly with whatever number it likes. Once the room exists,
  only the room may call it, and the anon key loses that grant.

### 55. Paying out DIVI

Settled with Geoff, to be built ON TOP of 54 and not before it:

* **1000 kills earns 100 DIVI**, so a tenth of a DIVI a kill.
* **A hundred DIVI minimum to claim.** It may build up; any amount over the
  hundred can be taken at once.
* **Earnings survive death.** The score resets when the ship is lost; earned
  DIVI does not.
* **Paid from the London node's treasury** for now.
* **A CASH IN DIVI button** on the launch screen, next to LAUNCH and HIGH
  SCORES, showing what is owed.
* **A low-balance banner in the wallet**, with a button that sends 2000 DIVI
  from Geoff's wallet to the game wallet in one go.

### 56. The room and the ledger (2026-Sep-06)

**Built and deployed**, at `https://divi-rebels-room.geoff-de3.workers.dev`.
Source in `/Users/geoffreymccabe/dd69-rebels/contrib/rebels-room`.

Two Durable Objects.

**`RebelsRoom`**, one per world, runs the fight. Fighters, bullets, hit
arbitration, kills, coins and waves all live there. A cockpit reports where its
own ship is and pulls triggers; it never reports what it hit, and there is no
message it can send that raises its own score. Ammunition, shields, guards and
torpedoes are the room's numbers. Transforms are bounded by what the ship can
physically fly since the last accepted one, and a report outside that is
refused and snapped back.

The simulation is the game's own `rebelsCombat`, extended to many players,
rather than a second copy written for the server. Two implementations of one
fight always end up disagreeing, and the disagreement always favours the liar.

**`RebelsLedger`**, one for everything, holds what each node is owed. It cannot
send DIVI, deliberately: the treasury key stays on the London node, so the worst
a break-in here can do is corrupt a scoreboard. A claim subtracts the balance
BEFORE any coin moves, so a repeated or racing claim finds it already gone.
A confirmation turns the hold into a payment; a release gives it back.

Still to do, in order:

1. **Wire the cockpit to the room.** The client still runs its own fight. Until
   it connects, multiplayer exists on the server and nowhere else.
2. **The London payout service.** The half that actually signs and sends. It
   reserves from the ledger, sends, then confirms; on failure it releases.
3. **The CASH IN DIVI button** and the low-balance banner.
4. **Server-side flight.** The one thing still taken on trust. It needs
   prediction and reconciliation to feel right, and shipping it badly makes the
   game worse while making it no harder to cheat at the thing that pays.

## Testing

Six suites, run from the repo root, no renderer and no DOM:

    sh scripts/run-orbit-tests.sh               flight model
    sh scripts/run-rebels-combat-tests.sh       bullets, fighters, wreckage
    sh scripts/run-rebels-controller-tests.sh   the globe hook and input
    sh scripts/run-divirebels-tests.sh          the solo arcade game
    sh scripts/run-rebels-room-tests.sh         what the room refuses
    sh scripts/run-rebels-ledger-tests.sh       ways to be paid twice

The last two are written from the attacker's side: not "does an honest player
work" but "what happens when the message is a lie".

The rendering cannot be tested headlessly: react-globe.gl will not initialise
under software rendering, so a headless browser shows a black sphere and the map
never reports ready. Anything visual is first seen in the real app.
