# Divi Rebels modularization: the game part

Written 2026-Sep-14. Owned by the game session (this document's author). The
build and versions half is docs/DIVI-REBELS-MODULAR-BUILD-AGENT.md, owned by the
Claude Code build agent. The two documents share one ownership table and one
order; read that one's section 2 for the rules both follow.

Geoff: "when it comes to the game itself, I think that you can do it."

Everything here is checked against the code as of app v69.9.47 (file sizes, call
sites and duplications read from the source). How big each split turns out to
be is an estimate from reading the structure.

## What I own

- The game: ui/src/wallet/rebels/** (after the build agent's package move, its
  new home), except the doors.
- The multiplayer server: contrib/rebels-room/** (including its deploys).
- The game's styles.
- The server-side check of signed-in players, and moving a guest's banked DIVI
  into their account.

I do not edit the version doors, build configs, CI, the globe split or
contrib/rebels-web, which are the build agent's. The door contract
(platform.ts) changes only by agreement, and only additively.

## My tasks

### G1. One shared message codec for the game and the server
- **Found:** the server packs players, enemies, shots and loot into rows by
  position, and the game unpacks them by position (row[0] is the id, row[1] to
  row[3] the position, and so on), each with its own copy of the layout
  (contrib/rebels-room/src/room.ts, ui/src/wallet/rebels/rebelsRoom.ts).
  A mismatch has already happened once: every join was refused with "bad home".
- **Do:** one module that both encode and decode, used by both sides, with a
  round-trip test for every row kind and the byte budgets unchanged (the wire
  suite).
- **Done when:** the room, room-client, wire and cockpit suites are green, and a
  deploy of the room plays identically in the app and on the web.

### G2. Cheats as their own module
- **Found:** test cheats spread through the controller (18 references) and the
  room (5).
- **Do:** one cheats module on each side that a door can leave out entirely.
  Public web and Lovenode leave it out; the app keeps it for testing; admin-only
  later with sign-in.
- **Done when:** `!21`, `!77`, `!8t`, `!9t` and `!1x` behave as today in the app,
  and the web build contains no cheat code (checked by the boundary guard).

### G3. One small store for "something changed"
- **Found:** browser-wide `window` events carry inventory, armoury and ship
  changes, and the same "inventory changed" signal is defined twice under two
  names in two files.
- **Do:** one typed subscribe/notify module, testable in node without faking
  `window`.

### G4. The game's styles out of the wallet stylesheet
- **Found:** about 60 Rebels rules live in the wallet's ui/src/index.css (2,224
  lines), so the web page loads the whole wallet stylesheet.
- **Do:** move them into the game's own stylesheet with a small game theme token
  file. The wallet keeps importing what it uses.
- **Done when:** the app and the web look identical (checked side by side) and
  the web page no longer loads the wallet stylesheet.

### G5. One account and data module
- **Found:** ten direct Supabase calls across five files: scores 3, loadout 2,
  ships 2, drop charts 2, forge 1. Each builds its own headers.
- **Do:** one client for all account reads and writes, with the connection and
  any sign-in credential supplied by the door. Sign-in on the web and Lovenode's
  own identity then change one place.
- **Done when:** same rows, same merges, all suites green; ready for the build
  agent's sign-in (B6).

### G6. The server's room split
- **Found:** contrib/rebels-room/src/room.ts (1,568 lines) mixes several jobs:
  - who a player is and what they may do (app address, web guest, soon signed-in)
  - the money side (banking, purse, cash-out)
  - the fight and the per-player broadcast
  - discipline (rate limits, strikes, snap-backs)
- **Do:** separate identity and permissions, economy, and simulation/broadcast
  modules. Then add the signed-in identity (verified session to an `sso:`
  account) and the guest-to-account merge, together with the build agent's B6.
- **Done when:** the 196 room tests are green, plus new tests for signed-in
  players and the merge. Deployed with app and web players checked.

### G7. The cockpit controller split, and controls as actions (the big one)
- **Found:** ui/src/wallet/rebels/rebelsController.ts is 2,807 lines.
  - Its per-frame function alone is about 940 lines.
  - About 500 lines are keyboard and mouse handlers that change the game
    directly.
  - The same file holds cheats, docking, death and respawn, the rear-gun view,
    drawing wingmen, camera zoom, sound wake-ups and the server connection.
  - The input seam from Stage A only swaps which listeners are attached; touch
    needs more than that.
- **Do, in small steps, each behind the 105 cockpit tests:**
  - an ACTIONS layer (throttle, strafe, lift, roll, aim, fire, torpedo, boost,
    weapon N, use, rear view, zoom), which keyboard and mouse produce today and
    touch produces later
  - flight and weapons stepping
  - docking and resupply
  - death, respawn and launch lifecycle
  - the camera
  - the rear-gun view
  - wingmen drawing
  - server sync
  - diagnostics
- **Done when:** the controller is a thin coordinator, each subsystem has its own
  tests, and Geoff plays the app and web and notices nothing different (DFlow
  frame time unchanged within noise).

### G8. The cockpit screen in pieces
- **Found:** ui/src/wallet/rebels/RebelsHud.tsx is both the cockpit layout and
  the switchboard for the launch card, death card, help, market and inventory
  (12 pieces of state).
- **Do:** a cockpit state hook plus separate pieces (gauges, launch card, death
  card, YOU HAVE DIED and wave banners, crosshair, corner badge), composed by a
  desktop layout. A phone layout can then arrange the same pieces.

### G9. Touch controls and the phone cockpit (after G7, G8 and the build agent's B5)
- Touch produces the G7 actions:
  - a left stick for throttle and strafe
  - drag right to aim
  - large fire button, smaller torpedo and boost buttons
  - tap the weapon icon to cycle
- Geoff designs the final layout; the draft is in docs/DIVI-REBELS-WEB-PLAN.md.
- The phone layout arranges G8's pieces. Measured on a real iPhone and Android
  through DFlow.

### G10. The combat simulation in systems (later, opportunistic)
- ui/src/wallet/rebels/rebelsCombat.ts (2,370 lines, 132 exports) covers waves,
  the dragon, swarms, projectiles and loot.
- It is well tested and also runs on the server, so it is split one system at a
  time, only when that system is being changed anyway.

## Order

The same table as the build agent's document, section 4.
- **Step 2:** I pause for its package move (B2) and globe split (B3). The
  gameplay session pauses too.
- **Step 3:** G1 to G4.
- **Step 4:** G5 and G6, ready for sign-in.
- **Step 5:** G7 and G8.
- **Step 6:** G9, then G10 when it comes up.

## Rules I hold myself to

- The full suite and tsc before every push. The boundary guard stays empty.
- No behaviour change unless the task says so; Geoff checks each step by playing.
- Merge feat/divi-rebels in before merging out; never touch another session's
  uncommitted work.
- The room is live for app and web players: every room deploy is tested against
  both.

## Log

### Review of the build agent's work before starting (2026-Sep-15)
- **Nothing of B1 to B7 existed yet** on any branch or in any folder: no test
  command, no package move, no Rebels CI workflow, no globe split.
- **Its recent work was elsewhere:**
  - "Release 69.11.0", merging all Rebels work into integration/all-features
  - map animation v2 on feat/map-animation-v2, which changes
    ui/src/wallet/GlobeMap.tsx (+30 lines), NetworkMap.tsx (+170) and
    ui/src/index.css (+165)
- **The installed app is 69.11.4,** built from that release line; feat/divi-rebels
  is at 69.9.47. So the app must NOT be installed from feat/divi-rebels any
  more: it would be a downgrade. Game changes reach the app through the release
  branch.
- The game's own files are identical on both lines.
- **Therefore:**
  - G1 to G3 are safe now: they touch none of the files the map work changed,
    and the package move has not started.
  - G4 (styles out of ui/src/index.css) waits until the map animation work is
    merged, because it edits the same stylesheet.
- **Every change to the messages must keep them byte-identical,** so the installed
  app and open web pages keep working when the room is redeployed.

### G1 done: one shared message codec (2026-Sep-15)
1. **Recorded first**, committed as 1e8ccbd before any change:
   contrib/rebels-room/test/wireGolden.test.ts runs a fixed scenario (seeded
   randomness, fixed clock) covering every row kind: ships, enemies, shots,
   stopped rounds, coins, torpedoes, wreckage, beams, loot with a private item
   drop, and wingmen. It saves the room's 39 state messages to
   contrib/rebels-room/test/golden/wire-state-v1.json. Two fresh recordings were
   identical.
2. **The codec:** ui/src/wallet/rebels/rebelsWire.ts, one pack and one unpack per
   row kind, with the layout written once. No THREE inside, so any client can
   use it.
3. **The room** packs with it, and **the cockpit** unpacks with it
   (rebelsRoom.ts). protocol.ts's `r1` is now the codec's.
4. **Proof:**
   - The room's messages are byte-identical to the recording.
   - ui/src/wallet/rebels/rebelsWire.test.ts unpacks all 781 recorded rows with
     both the new code and a verbatim copy of the old cockpit unpacking (what
     installed apps run), and they agree on every row.
   - It also has pack layout and round-trip checks (14 in all).
5. **Suites:** 33 green (the recording check and the codec tests are new). tsc
   clean.

### G2 done: cheats as their own module, and closed to web guests (2026-Sep-15)
- **Found while doing it:** the room ran any cheat message it received, from
  anyone. A web guest could type one line into the browser console on
  divi.love/rebels and summon a real dragon (which leaves a real Dragon Egg) or
  a swarm.
- **The cockpit's cheats** now live in ui/src/wallet/rebels/rebelsCheats.ts, moved
  verbatim. They reach the game only through a small CheatHost.
  - The door plugs them in (`cheats` in the contract): the app door does, the
    web door does not.
  - scripts/check-rebels-boundary.mjs now forbids rebelsCheats.ts in the core
    and the web page, so the public page carries no cheat code.
- **The room's cheats** now live in contrib/rebels-room/src/cheats.ts. room.ts
  decides who may use them and refuses web guests: silently, and not a strike.
  App seats keep them for testing; they become admin-only with sign-in.
- **Tests:**
  - room 199, including: a guest's !21 and !11 summon nothing, and an app
    seat's !21 still brings the dragon
  - cockpit 105 (the cheat tests run with the app's cheats plugged in)
  - boundary guard 4
  - wire recording unchanged
- **Suite:** 33 green. tsc clean for ui/ and contrib/rebels-room/.
- **Deployed 2026-Sep-15:**
  - room version 134fc727. One status check returned Cloudflare error 1101 during
    the few seconds the new version was starting; every check since returned
    normally.
  - web version f965cc48. The built page contains no cheat text.
- **Live check:** a script joined the real room as a web guest. It got the
  welcome, the game feed and the "Sign in to cash out" purse, and its !21 brought
  no dragon.

### G3 done: one store for "something changed" (2026-Sep-15)
- **The store:** ui/src/wallet/rebels/rebelsSignals.ts has two signals.
  "armoury" covers points, bought gear, found items, a ship's name and fitted
  upgrades. "ship" is which hull is flown.
- **Replaced:** the window events in rebelsArmoury.ts, rebelsInventory.ts,
  shipFleet.ts and shipChoice.ts, including the one name defined twice
  (CHANGED and INVENTORY_CHANGED). `subscribeArmoury` and `subscribeShip` keep
  their names, so their callers did not change. Nothing outside the game
  listened to the old events (checked).
- **Tests:** fleet 39, adding that each change is heard on the right signal,
  a throwing listener does not silence the others, and unsubscribing works.
  dropCharts listens to the store instead of counting window events.
- **Suite:** 33 green. tsc clean.

### G5 done: one account and data module (2026-Sep-15)
1. **Recorded first**, committed as 27ff262: ui/src/wallet/rebels/rebelsAccount.test.ts
   drives every account function against a fake network and saves all 14
   requests (address, method, sorted headers, body) to
   ui/src/wallet/rebels/golden/account-requests-v1.json. The functions are
   fetchDropConfig, saveDropConfig, saveLoadoutRemote, loadLoadoutRemote, forge,
   recordScore, fetchTop best and total, myTotals, saveShip, myFleet,
   saveFlyingShip and pullFleet. Two recordings were identical.
2. **The module:** ui/src/wallet/rebels/rebelsAccount.ts, with `accountRead(table
   and query)` and `accountCall(function, arguments)`. The connection is the
   door's: `account` in the contract (address, public key, and an optional
   signed-in `bearer`), defaulting to DEFAULT_ACCOUNT (the Divi Desktop project
   and its public key) in the HEADLESS, app and web doors.
3. **Moved onto it:** all ten call sites in dropConfigRemote.ts, rebelsForge.ts,
   rebelsLoadout.ts, rebelsScores.ts and rebelsShips.ts. Their five copies of the
   headers are gone. The room server reaches the drop charts through the same
   module (HEADLESS connection).
4. **Proof:** all 14 requests are identical to the recording. A door with a
   signed-in credential sends it as the bearer while the public key stays the
   api key, which is what sign-in (B6) needs.
5. **Suite:** 34 green. tsc clean for ui/ and contrib/rebels-room/.

### G6 done: the room split into identity, economy and broadcast (2026-Sep-15)
contrib/rebels-room/src/room.ts went from 1,568 lines to 1,334. Three pieces were
moved out verbatim:
- **identity.ts** (55 lines): `whoJoins` (app address, guest id, or web-marked
  address), `mayCheat`, `mayCashOut`, `shipFor`, GUEST_SHIP and GUEST_CASH_OUT.
  This is where signed-in players go next.
- **economy.ts** (77 lines): `bankRun` (report a run to the ledger, putting it
  back if the ledger fails), `requestCashOut` and `readPurse`, over a typed
  ledger binding.
- **broadcast.ts** (194 lines): `stateMessages` builds each seat's state message
  (rows, view ranges, stay-in-view memory). The room only sends them, and the
  half-second gauges stay in the room.

The room keeps the simulation, seats and the message handlers, and asks identity
whether a guest may cheat or cash out.

**Proof:**
- the recording is still byte-identical (39 messages)
- room 205 (6 new direct identity tests)
- wire budgets 25, cockpit 105
- tsc clean for contrib/rebels-room/ and ui/
- **Suite:** 34 green.

### G7, step a: controls as a PILOT (2026-Sep-15)
- **Found:** the flight model already reads a "stick" record (throttle, strafe,
  lift, roll, aim, fire, boost, guard), not keys. The tangle was the ~500 lines
  in rebelsController.ts turning key, mouse and wheel events into that record
  plus commands, woven through the controller's own state.
- **The pilot** (`Pilot` in platform.ts) is everything a pair of hands can ask of
  the ship:
  - read the pilot's state
  - set the held controls
  - press or release a trigger
  - move or centre the reticle
  - let go of everything
  - pick a weapon, use a held item, toggle the rear view or camera, zoom
  - restart sound, report a gesture, report focus or pointer-lock changes
  - pass a possible cheat key
  The input contract is now `attach(canvas, pilot)`.
- **platform/desktopInput.ts** is now the whole keyboard-and-mouse module. It has
  the key map, the typing guard, pointer movement (locked and unlocked), the
  buttons, the Alt-wheel zoom, blur and focus, all moved from the controller with
  the same events, targets and options. It drives the game only through the
  pilot.
- **The controller** builds the pilot from its existing functions. Its key and
  mouse handlers are gone: 2,807 lines to 2,622.
- **Tests:**
  - cockpit 113. The existing 105 drive keys, clicks and pointer movement through
    the new path unchanged.
  - 8 new checks fly a ship with NO keyboard or mouse. A stand-in input
    receives the pilot; pulling the throttle back slows the ship (8.0 to -2.8),
    holding the trigger fires, the reticle moves and centres, choosing a weapon
    does what its key does, and detaching hands the input back. This is what a
    phone's touch module will do.
- **Suite:** 34 green. tsc clean.
- **For the build agent (B5):** a phone door plugs a touch module into
  `input.attach(canvas, pilot)`. The touch controls themselves are G9.

### G7, step b: one frame in named steps (2026-Sep-15)
The per-frame function `runFrame` was 940 lines. It is now 20: a coordinator
calling eleven named steps in the same order, each the original code moved
verbatim.
- **frameApproach:** easing the map's view in before launch
- **frameDive:** the launch dive to the tower
- **frameFlight:** the flight model's step, flying into things, docking; returns
  the step's report
- **frameShipAndCamera:** the hull leaning into turns, the cockpit camera, the
  jolt, the listener
- **frameShield:** the mandala from inside, the red sphere from outside
- **frameSky:** the planets, and naming the one nearby
- **frameGuns:** main guns, mini gun and beam, forwards or through the rear
  window; returns the backwards aim
- **frameRoom:** drawing the server's fight: enemies, rounds, streaks, torpedoes,
  wreckage, beams, loot, gauges, wave, crew
- **frameTorpedo:** the stake bonus, and the torpedo launched, detonated or fired
  backwards
- **frameEvents:** hits, kills, pickups and refusals, and what each looks and
  sounds like
- **frameDrawAndGauges:** enemy hulls and the dragon, thrust and dock sounds,
  every draw call, the gauges

**How it was done:**
- Each step receives only the ship, camera, effects and scene it actually uses,
  under the same names, so its code did not change.
- The three values that cross between steps (the flight report, the backwards
  aim, whether the room is live) are passed explicitly.
- Checked that no step reassigns the objects it is handed.
- The error guard around the frame still covers every step.

**Not done yet, and deliberately:** moving these steps into files of their own.
They share a lot of the controller's state (score, the room, the sounds, the HUD),
so each would need a context object. That is worth doing one step at a time when
a step is next changed. The phone work does not need it: it needs the pilot (step
a) and the cockpit screen in pieces (G8).

**Suite:** 34 green, including cockpit 113. tsc clean.
