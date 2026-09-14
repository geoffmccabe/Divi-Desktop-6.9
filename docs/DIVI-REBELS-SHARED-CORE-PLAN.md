# Divi Rebels: One Core, Three Doors

Written 2026-Sep-13. Status: PLAN, nothing built.

Geoff: "the first thing is to just get it on there but keep the mobile version
in mind. I don't want to dumb-down the web version so that it works on mobile.
I'd rather have a separate version for mobile after we get the web version
done. Ideally it can be done in a way that takes as much from the current app
version, if possible, with only a handful of different modules that are web
specific? ... We can refactor the app version a bit first, if that helps to
make it more modular."

Companion to docs/DIVI-REBELS-WEB-PLAN.md, which covers sign-in, the Scanner
hangar, DIVI cash-out and the greenlight. This document covers HOW the code is
split so the app, the web and later phones share one game.

## The idea

- **The core** is the game itself: flying, combat, enemies, items, the globe,
  the cockpit screens, sound, the connection to the room. Written once and used
  by every version.
- **A door** is the thin layer that fits the core to one place:
  - the desktop app
  - divi.love/rebels on a computer
  - later, a phone version
- A door answers a short list of questions for the core, and nothing else.

The web version is the FULL game. Nothing is reduced for phones. Phones get
their own door later, which reuses the web door's pieces and adds its own
controls, detail level and screen layout.

## What is shared already (checked in the code)

- The game is 71 files, about 26,000 lines, in
  /Users/geoffreymccabe/dd69-rebels/ui/src/wallet/rebels/. None of them call
  into the desktop app directly.
- The core is ALREADY shared by two programs. The multiplayer server
  (/Users/geoffreymccabe/dd69-rebels/contrib/rebels-room/src/room.ts) runs the
  same simulation files the game does: combat, flight, the world, weapons,
  items, drops, wingmen and view ranges.
- The seam with the app is thin. The Node Map screen
  (/Users/geoffreymccabe/dd69-rebels/ui/src/wallet/NetworkMap.tsx) touches the
  game in about 16 lines: it creates the game, hands the globe its towers, and
  shows the cockpit screens on top.
- The globe (GlobeMap.tsx) is plain web 3D, used only by the Node Map and the
  game.
- The theme system that gives Rebels its colours is plain web code.

## What is tied to the app today

This is the complete list. Each becomes a question the door answers.

| # | What | Where it is tied today |
|---|---|---|
| 1 | Where the towers are, and where I launch from | The Node Map asks the local node for its peers and looks up their locations through the app |
| 2 | Who I am, and how I prove it to the room | The player's name comes from the node identity the wallet saved; the room knows the player by internet address |
| 3 | What DIVI is worth | Asked through the app (CoinMarketCap); used by the points panel and the weapon and item stores |
| 4 | Wallet actions | The points panel checks a DIVI address and lists the wallet's own addresses through the app; buying points sends DIVI from the wallet |
| 5 | The screen that hosts the game | The Node Map screen |
| 6 | Controls and detail level | The game listens to the keyboard and mouse itself; detail limits such as how many node links to draw are fixed numbers inside the globe |

Items 1 to 5 differ between the app and the web. Item 6 is the same for the app
and the web, and differs for phones later.

## The contract: the questions a door answers

One small file defines what a door must provide. The core asks the door, never
the wallet.

1. **Towers and home.** The list of node towers to draw, and the tower this
   player launches from.
2. **Identity.** The player's account, display name, and the credential that
   proves them to the room.
3. **DIVI price.** CoinMarketCap only, in every door. Standing order: no
   CoinMarketCap answer means no price.
4. **Money.**
   - Where DIVI can be cashed out to.
   - Whether an address is valid.
   - Whether this door can pay for points with DIVI; the web says "not here yet".
5. **Input.** The thing that turns a person's hands into the game's control
   actions. The game already has one table of actions (RebelsControls.tsx), so
   an input is simply "something that presses those actions".
6. **Detail.** A small set of numbers the globe and effects read: node links,
   planet detail, particle counts, frame target.
7. **Layout.** Where the cockpit screens sit. The app and the web share one
   layout; phones get their own later.

Questions 5 to 7 are the phone seams. They are built now with ONE answer each,
which is exactly today's behaviour. The phone version then adds its own
answers without touching the core.

## A guard against drift

A test that fails the build if any core file reaches into the wallet, the
app's bridge, or any door. It works like the existing tests, which read the
source and check it.

- It starts by listing today's reach-outs as known exceptions.
- Every refactor step removes some.
- The refactor is finished when the list is empty.

After that the core cannot quietly grow a new tie to one door. That is the same
kind of drift that once let the two help screens fall out of step.

## Where the files go

**Recommendation: do NOT move the 71 game files now.** Three reasons:
1. The multiplayer server imports those files by their paths.
2. Another session is actively editing them right now (uncommitted changes
   to the cockpit, a new "mandala" feature).
3. A mass move rewrites the history of every file for no change in behaviour.

A rename into a tidier folder can be one clean step later, when nobody is
mid-change.

New folders, all small:
- /Users/geoffreymccabe/dd69-rebels/ui/src/wallet/rebels/platform/: the
  contract and the shared game component that both doors mount.
- /Users/geoffreymccabe/dd69-rebels/ui/src/wallet/rebels/platform/app/: the app
  door. Code moved out of the core and the Node Map, not new behaviour.
- /Users/geoffreymccabe/dd69-rebels/ui/src/web-rebels/: the web door and its
  page.
- /Users/geoffreymccabe/dd69-rebels/contrib/rebels-web/: the small Cloudflare
  Worker behind divi.love/rebels.
- Later: /Users/geoffreymccabe/dd69-rebels/ui/src/mobile-rebels/: the phone
  door.

## The app door (extracted, same behaviour)

1. **Towers and home:** the Node Map's peers, locations and your node, as today.
2. **Identity:** your node identity and the address-based room account, as today.
3. **DIVI price:** through the app, as today.
4. **Money:** address check, your wallet's addresses, buy points with DIVI, as
   today.
5. **Host:** the Node Map keeps all its own map features and mounts the shared
   game component instead of wiring the game by hand.

## The web door: the handful of web modules

1. **The page:** starts the theme and mounts the shared game component with the
   web door.
2. **Sign-in:** the LW-SSO round trip, the Rebels session, signing out.
3. **Towers and home:** the Scanner's node list from our Worker, with the
   Scanner hangar in London as home.
4. **Identity:** the SSO account, display name, and room credential.
5. **DIVI price:** from our Worker, which asks CoinMarketCap.
6. **Money:** cash-out to DiviGo or a checked address. Buying points with DIVI
   answers "not here yet".

Plus the Worker, on the server side: it serves the web build, turns an SSO
token into a Rebels session, and caches the node list and the price.

Everything else the web version runs is the core.

## The server stays one server

- One room for everyone.
- It accepts either door's credential when a player joins, keeps app and web
  accounts apart, and applies the cash-out guards.
- Detail in docs/DIVI-REBELS-WEB-PLAN.md, Phase 2.

## Two builds from one source

- **The app build stays exactly as it is:** one file embedded in the app.
- **A second build config** for the web entry: normal multi-file output under
  /rebels/, so returning players load from cache.
- Both read the same version number, so the web and app always report the same
  version.

## Phone version (later, separate)

The phone door reuses the web door's sign-in, towers, identity, price and
money modules, and adds:
- a touch input module
- a phone detail setting
- a phone layout for the cockpit screens
- phone-only touches such as the landscape card and "Add to Home Screen"

The core and the web version do not change for it.

## Order of work

### Stage A: refactor the app, no visible change

Every step: all 24 test suites green, the multiplayer server's tests green, and
the app still playing identically.

- **A0. Start clean.** Wait for the other session's in-progress work to be
  committed, then do the refactor in its own worktree off the latest commit,
  so neither session overwrites the other.
- **A1. The contract and the guard test,** with today's reach-outs listed.
- **A2. Identity and the room credential** behind the contract.
- **A3. DIVI price and wallet actions** behind the contract (points panel,
  stores, buying points).
- **A4. Towers and home** behind the contract, and the shared game component.
  The Node Map now mounts it.
- **A5. The input, detail and layout seams,** each with today's behaviour
  exactly.
- **A6. The second build config** for the web entry (a blank page that mounts
  the game with a stand-in door, to prove the split).

**Stage A is done when:**
- The guard's exception list is empty.
- A DFlow capture before and after shows the same frame time, within normal
  variation.
- Geoff plays the app and notices nothing different.

It ships as an ordinary app version.

### Stage B: the web door

Following docs/DIVI-REBELS-WEB-PLAN.md:
1. Greenlight and SSO fixes.
2. The room learns SSO players, with the cash-out guards.
3. The six web modules.
4. The Worker on divi.love/rebels.
5. The Scanner hangar on both globes.
6. Launch checks: first-visit load time, sound in Chrome and Safari, and a mixed
   session of app and web players read through DFlow.

### Stage C: the phone door, later

Touch input, phone detail setting, phone layout. Reuses Stage B's modules.

## Risks, and how each is handled

- **App players are live.** Stage A changes no behaviour, runs the full suites
  at every step, and ships before any web work touches the server.
- **Another session is editing the same files.** Separate worktree, and Stage A
  starts only from a committed tree.
- **The server shares the simulation files by path.** Files stay where they
  are; the server's tests run at every step.
- **The Node Map's own map features.** Only the lines that host the game change.
  The map is checked by eye in the app after A4.
- **A hidden tie found late.** The guard test is there to surface exactly this.

## Confidence

- **Stage A, no visible change: about 80%.** The cockpit tests boot the real
  server and read what the game actually draws, which catches most slips. The
  rest is checked by playing.
- **The web door staying at about six modules plus the Worker: about 75%.**
  The known ties are listed above. The uncertainty is small ties that only show
  once the web page runs outside the app, such as a stray use of something the
  wallet stores.

## Decisions for Geoff

1. Leave the game's files where they are for now, rather than a big move?
   Recommendation: yes.
2. Ship Stage A as its own app release before any web work? Recommendation: yes.
3. The phone version, later: the same divi.love/rebels address sending phones to
   the phone door, or its own address? Can wait until Stage C.

Still open from the web plan:
- the cash-out guard numbers
- asking DiviGo about paying rewards straight into DiviGo balances
- Discord on the login page
- cheats on the web
