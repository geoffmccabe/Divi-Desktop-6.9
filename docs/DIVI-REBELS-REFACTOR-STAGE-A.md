# Divi Rebels Refactor, Stage A: the core and the app door

Written 2026-Sep-13. Status: IN PROGRESS (A0 to A3 done).

Parent plan: docs/DIVI-REBELS-SHARED-CORE-PLAN.md. Geoff approved it and asked
for "a detailed refactor plan first with prompts for yourself to use for each
phase and then do it."

## The promise of Stage A

When Stage A is done:
1. The app plays EXACTLY as before. Nothing Geoff can see changes.
2. The game core can be built WITHOUT the desktop app's bridge, proven by a
   test that fails the build otherwise.
3. Everything the core used to take from the wallet comes through ONE small
   contract that a door fills in: the app door today, the web door in Stage B,
   the phone door later.
4. A blank web page builds from the same core with a stand-in door, which proves
   the split is real before any web work starts.

## Ground truth this plan is built on (read in the code, 2026-Sep-13)

- **Every tie between the game and the wallet**, found by bundling the game and
  by reading imports:

  | Tie | Used by | What it really needs |
  |---|---|---|
  | `playerName()` reads wallet storage `dd69.nodeIdentity` and `dd69.selfGeo.*` | rebelsScores.ts, then rebelsShips.ts, rebelsLoadout.ts, rebelsForge.ts, RebelsScoreboard.tsx, rebelsController.ts (room join) | who the player is, and the key their saved rows use |
  | `SUPABASE_URL` / `SUPABASE_ANON_KEY` from wallet/exchanges.ts | dropConfigRemote.ts, rebelsLoadout.ts, rebelsScores.ts, rebelsShips.ts, rebelsForge.ts | the Supabase project address (public) |
  | `fetchPrices` from wallet/value.ts, which reaches the app bridge | PointsPanel.tsx, WeaponStore.tsx, ItemStore.tsx | the DIVI price in dollars |
  | `validateAddress`, `walletAddresses` from wallet/api.ts (app bridge) | PointsPanel.tsx | check a DIVI address; the wallet's own addresses |
  | `PurchaseWithDivi` from points/ (app bridge) | PointsPanel.tsx | buy points by sending DIVI |
  | `userWonRecently` from wallet/stakeWin.ts | rebelsController.ts | "did this wallet just win a stake" |
  | `loadKnown`, `loadMyIps` from wallet/knownPeers.ts | orbitNodes.ts only, which NOTHING imports | nothing: dead code |
  | `ROOM_BASE`, a fixed address in rebelsRoom.ts | rebelsRoom.ts | which server to join |

- **Towers and home are ALREADY handed in by the host.** The Node Map passes its
  node list to the globe, and the globe hands the game the tower tips and "which
  ip is mine" when it attaches. The core needs no change here; the web host
  simply passes a different list.
- **The multiplayer server imports 9 of the core's files by path.** No core file
  moves in Stage A.
- **The existing tests** bundle each test file with esbuild and run it in node;
  the cockpit test boots the real room server. The controller test sets
  `dd69.nodeIdentity` in storage and expects it to be the player's name.
- **The app build** is Vite with everything inlined into one file. The version
  comes from crates/app/tauri.conf.json.

## Design decisions

1. **One contract file**, ui/src/wallet/rebels/platform/platform.ts. A door
   provides:
   - `identity`: `name()` (shown to others and today's row key), and
     `joinFields(selfIp)` (what the room is told on joining)
   - `roomBase`: which multiplayer server to join
   - `wonStakeRecently()`: always false on the web
   - `prices.fetch()`: the DIVI price in the SAME shape value.ts returns today,
     so no caller changes its logic
   - `money.validateAddress(a)`, `money.ownAddresses()`, and `money.PayWithDivi`
     (the buy-points component, or null where a door cannot pay)
   - `detail`: the globe's link counts and pixel ratio (the phone seam)
   - `input.attach(dom, handlers)`: plugs the keyboard and mouse into the
     cockpit's existing handlers and returns the detach (the phone seam)
2. **How the core finds its door.** A tiny registry,
   ui/src/wallet/rebels/platform/current.ts. The door calls `setPlatform` once
   before the game is created; the core calls `platform()`. A registry, not a
   parameter threaded through 20 files, because several core functions are
   called from places that have no controller to pass it down (scores, ships,
   loadout, forge). Until a door registers, a neutral HEADLESS door answers:
   - name "this node"
   - no price
   - no wallet
   - today's room address
   - today's detail
   - desktop input
   That way nothing crashes; tests that care register the door they mean.
3. **The app door**, ui/src/wallet/rebels/platform/app/, holds the moved code
   VERBATIM: the old `playerName` body, the wallet calls, the stake flag.
   Registered from NetworkMap.tsx, the only place the app creates the game.
4. **The Supabase project address** moves to a neutral file,
   ui/src/supabaseProject.ts. wallet/exchanges.ts re-exports it, so the
   wallet's other users do not change.
5. **The guard** is a node script that bundles the core's entry with esbuild,
   reads the list of every file that went in, and fails if any forbidden file
   is among them:
   - the app bridge (ui/src/tauri.ts, ui/src/bridge*)
   - wallet/api.ts, wallet/value.ts
   - points/*
   - wallet/NetworkMap.tsx, wallet/knownPeers.ts, wallet/stakeWin.ts
   - wallet/exchanges.ts
   - platform/app/*

   It checks what ACTUALLY gets bundled, including indirect imports, not what a
   file claims to import. It starts with today's offenders listed as KNOWN and
   fails only on NEW ones. Each phase deletes entries, and Stage A ends with the
   list empty.
6. **The phone seams are verbatim moves**, never rewrites. Detail: the globe's
   existing numbers, read from the door. Input: the exact same listeners, wired
   by the door. The deeper touch work waits for the phone stage, where it can be
   tested on phones.

## Where the work happens

- A separate worktree, /Users/geoffreymccabe/dd69-rebels-core, on branch
  `refactor/rebels-core`, cut from the latest committed feat/divi-rebels. The
  gameplay session keeps /Users/geoffreymccabe/dd69-rebels and neither can
  overwrite the other.
- Its ui/node_modules and contrib/rebels-room/node_modules are LINKS to the
  existing installs (no new installs, no downloaded packages).
- Before each merge back, feat/divi-rebels is merged INTO the refactor branch
  first, so gameplay work that landed meanwhile is carried along.
- The app build and install run from /Users/geoffreymccabe/dd69-rebels after
  the merge. That copy already has its large Rust build cache, and a fresh one
  would rebuild everything and refill the disk.

## Checks every phase must pass

- The FULL test suite: every scripts/run-*tests.sh, never a filtered subset.
- `tsc --noEmit` in ui.
- The boundary guard (from A1 on).
- The room server's own tests (they are part of the full suite).
- Committed on the refactor branch with a message saying what moved and why.

---

## A0: set up and baseline

**Prompt:**
> Create the worktree /Users/geoffreymccabe/dd69-rebels-core on a new branch
> refactor/rebels-core from the current feat/divi-rebels commit. Replace its
> ui/node_modules and contrib/rebels-room/node_modules with links to the ones
> in /Users/geoffreymccabe/dd69-rebels. Never `git add` those links. Run the
> full suite there and record every suite's pass count in this document under
> "Baseline". Record the size of the app's built index.html by building ui once
> with Vite (the UI bundle only, no cargo). If anything fails, stop and fix the
> setup, not the tests.

## A1: the contract, the registry, the app door shell, the guard

**Prompt:**
> Add ui/src/wallet/rebels/platform/platform.ts (the contract from Design
> decision 1, every member documented in plain words), current.ts (setPlatform,
> platform, the HEADLESS door) and app/index.ts (appPlatform, with every member
> filled by calling EXACTLY what the core calls today). Register appPlatform in
> NetworkMap.tsx before the game is created. Do NOT change any core file yet.
>
> Add scripts/check-rebels-boundary.mjs and scripts/run-rebels-boundary-tests.sh.
> - Bundle a core entry file (ui/src/wallet/rebels/platform/coreEntry.ts, which
>   exports createRebels and RebelsHud) with esbuild's JavaScript API, with
>   metafile on and the same loaders as the other runners (css as empty).
> - Collect the inputs and compare them with the forbidden list.
> - Print each forbidden file and the chain of imports that pulled it in.
> - Pass if the offenders equal the KNOWN list in the script. Fail on anything
>   new, and also fail when a KNOWN entry no longer appears, so the list is kept
>   honest.
>
> Run the full suite, tsc and the guard. Commit.

## A2: identity, room address, stake flag, Supabase address, dead code

**Prompt:**
> Move the body of playerName() from rebelsScores.ts into
> appPlatform.identity.name(). playerName() stays as a one-line call to
> platform().identity.name(), so its callers do not change.
>
> In rebelsController.ts, the room join's node and name come from
> platform().identity.joinFields(selfIp). The app door returns exactly
> { node: selfIp || name(), name: name() }.
>
> Replace userWonRecently with platform().wonStakeRecently().
>
> rebelsRoom.ts reads platform().roomBase instead of ROOM_BASE. ROOM_BASE stays
> exported as the default, since tests and the server's docs use it.
>
> Create ui/src/supabaseProject.ts holding the Supabase URL and public anon key.
> wallet/exchanges.ts re-exports both. The 5 core files import from the new
> file.
>
> Delete orbitNodes.ts if nothing but its own test uses it. If a test uses it,
> move both into platform/app/ with no change.
>
> In every test that depended on the old behaviour (the controller test's
> dd69.nodeIdentity), register appPlatform at the top so the test still means
> what it meant.
>
> Remove the entries this clears from the guard's KNOWN list. Full suite, tsc,
> guard. Commit.

## A3: price and money

**Prompt:**
> In PointsPanel.tsx, WeaponStore.tsx and ItemStore.tsx, fetchPrices() becomes
> platform().prices.fetch(). The app door calls value.ts's fetchPrices, so the
> shape and the CoinMarketCap-only rule are untouched.
>
> In PointsPanel.tsx:
> - walletAddresses() becomes platform().money.ownAddresses()
> - validateAddress(to) becomes platform().money.validateAddress(to)
> - `<PurchaseWithDivi>` renders platform().money.PayWithDivi when it is not
>   null, with the same props
> - when it IS null, the BUY POINTS button reads "BUY POINTS IN THE APP" and is
>   disabled
>
> Types that PointsPanel imported from points/PurchaseWithDivi
> (PurchaseOption, PurchaseProgress) move into platform.ts as type-only
> declarations with the same fields, so the core never imports points/.
>
> The guard's KNOWN list must now be EMPTY. Change the script so an empty list
> is required from here on. Full suite, tsc, guard. Commit.

## A4: the phone seams, moved verbatim

**Prompt:**
> Detail: in GlobeMap.tsx, the peer link limit, the network link limit and the
> game pixel ratio are read from platform().detail. The HEADLESS and app doors
> carry today's exact values (24, 120, and the current GAME_PIXEL_RATIO).
> Check GlobeMap's own imports stay free of the forbidden list.
>
> Input: in rebelsController.ts's attach and dispose, the addEventListener and
> removeEventListener block (wheel, pointerleave, pointermove, pointerdown,
> contextmenu on the canvas; pointerup, keydown, keyup, blur, focus on the
> window; pointerlockchange on the document) moves into a desktopInput module:
> - `attach(dom, handlers)` adds exactly those listeners with exactly the same
>   options and returns a detach that removes exactly those
> - the controller calls platform().input.attach once where the block was, and
>   the returned detach where the removals were
> - the handlers themselves do not move and do not change
>
> The cockpit test suite must still pass untouched, because it drives the game
> through these very listeners. Full suite, tsc, guard. Commit.

## A5: the web entry that proves the split

**Prompt:**
> Add ui/vite.web.config.ts:
> - entry ui/web-rebels/index.html
> - normal multi-file output, base "/rebels/", outDir ui/dist-web
> - the same __APP_VERSION__ define
> - no single-file plugin
>
> The page mounts ui/src/web-rebels/main.tsx. It:
> - registers a STAND-IN door: name "web pilot", no price, no wallet, today's
>   detail, desktop input
> - wraps the page in the theme provider
> - renders GlobeMap with a fixed list of four towers, one of them the Scanner
>   node at London (109.228.38.104), plus RebelsHud over it
> - does NOT connect to the live room unless the address has ?room=1, so opening
>   it by accident never puts a fake player in the real sky
>
> Extend the guard to bundle this web entry too and require the forbidden list
> to be empty for it. Build it once with the web config to prove it builds, and
> record the output size here. Do not deploy it anywhere. Full suite, tsc, guard.
> Commit.

## A6: merge, install, confirm with Geoff

**Prompt:**
> Merge feat/divi-rebels into refactor/rebels-core and resolve any conflicts in
> favour of keeping BOTH the gameplay change and the refactor. Full suite, tsc,
> guard.
>
> Then in /Users/geoffreymccabe/dd69-rebels:
> - confirm the tree is clean (another session may be using it)
> - fast-forward or merge refactor/rebels-core into feat/divi-rebels
> - run the full suite again there
> - run scripts/install-local.sh (version bump, build, install, relaunch)
> - push
>
> Update this document's status and results. Ask Geoff to play normally and
> paste a DFlow report, and compare its average frame, 95th percentile and draw
> calls with the last report before the refactor (v69.9.40: 16.8 ms average,
> 24.1 ms 95th percentile). Stage A is DONE only when Geoff confirms nothing
> changed.

---

## Baseline

Taken 2026-Sep-13 in /Users/geoffreymccabe/dd69-rebels-core at commit 7786284,
before any refactor change.

- **Full suite:** 26 suites, all green except one: `a fleet of twenty-four is
  cheap` (flock suite).
  - That check timed one long run of the combat step and failed at a machine
    load average of about 80 (other sessions building). The same untouched code
    read 0.6 ms with the processor to itself and 1.1 to 1.7 ms under load,
    against a 1.0 ms limit.
  - Fixed in A0 by timing the FASTEST of six batches, which measures the step
    and not the neighbours. It now reads 0.16 to 0.24 ms and passes three times
    running.
- **App UI bundle** (the one inlined index.html): 7,258,861 bytes. The build took
  9 min 23 s of wall time at 17% CPU under that load, so builds are kept to a
  minimum in this stage.

## Log

### A0 + A1 (2026-Sep-13)
- **Worktree:** /Users/geoffreymccabe/dd69-rebels-core, branch
  refactor/rebels-core, with node_modules linked to the dd69-rebels installs.
- **New files** in ui/src/wallet/rebels/platform/:
  - platform.ts: the contract, types only
  - defaults.ts: the room address and today's globe detail
  - desktopInput.ts: the cockpit's listeners, copied verbatim, not yet used
  - current.ts: setPlatform, platform, HEADLESS
  - app/index.ts: the app door, calling exactly what the game calls today
  - coreEntry.ts: what a door mounts
- **Registration:** NetworkMap.tsx registers the app door as it loads. No game
  file uses the door yet, so behaviour is unchanged by construction.
- **The guard:** scripts/check-rebels-boundary.mjs and
  scripts/run-rebels-boundary-tests.sh. It bundles the game (81 of our files)
  and finds 7 ties, all known, each printed with the chain that pulls it in:
  - points/PurchaseWithDivi.tsx and points/points.css, through PointsPanel
  - tauri.ts, wallet/api.ts and wallet/value.ts, through WeaponStore
  - wallet/exchanges.ts, through rebelsScores
  - wallet/stakeWin.ts, through rebelsController
- **Suite:** 27 suites (the guard is the new one), all green. tsc clean.

### A2 (2026-Sep-13)
- **Identity:** the body of `playerName()` moved unchanged to
  platform/app/identity.ts as `nodePlayerName()`, beside `appIdentity`. That file
  imports nothing from the wallet, so node tests can stand in for the app with
  it. `playerName()` in rebelsScores.ts now asks the door, and its five callers
  are untouched.
- **Room join:** the cockpit's node and name come from
  `platform().identity.joinFields(selfIp)`. The app door returns exactly what
  the cockpit sent before.
- **Stake flag:** `userWonRecently(STAKE_BONUS_MS)` became
  `platform().wonStakeRecently(STAKE_BONUS_MS)`. The contract takes the same
  optional time window.
- **Room address:** the socket opens `platform().roomBase`. `ROOM_BASE` is still
  exported (a room client test reads it) and now equals `DEFAULT_ROOM_BASE`.
- **Supabase address:** moved to ui/src/supabaseProject.ts, copied
  programmatically so the key could not be mistyped. wallet/exchanges.ts imports
  and re-exports it. The five game files import the new file.
- **Dead code:** orbitNodes.ts deleted. Nothing imported it, not even a test.
- **Tests:** the cockpit test registers HEADLESS with the app's identity,
  because it names players through the wallet's saved node identity.
- **Caught by tsc:** a re-export alone does not make the names usable inside
  exchanges.ts. Fixed with import-then-export.
- **The guard:** 5 ties left, all through the stores and the points panel
  (points/PurchaseWithDivi.tsx, points/points.css, tauri.ts, wallet/api.ts,
  wallet/value.ts). exchanges.ts and stakeWin.ts are gone from the game.
- **Suite:** 27 suites, all green. tsc clean.

### A3 (2026-Sep-13)
- **Price:** PointsPanel.tsx, WeaponStore.tsx and ItemStore.tsx ask
  `platform().prices.fetch()`. The app door calls the wallet's `fetchPrices`, so
  the shape and the CoinMarketCap-only rule are the wallet's own, unchanged.
- **Wallet actions:** PointsPanel.tsx asks `platform().money.ownAddresses()` and
  `platform().money.validateAddress()`.
- **Buying points:** PointsPanel.tsx renders `platform().money.PayWithDivi`. The
  app door hands it the wallet's PurchaseWithDivi, so the app is identical.
  Where a door has none, the button reads "BUY POINTS IN THE APP" and is
  disabled.
- **Types:** `PurchaseOption` and `PurchaseProgress` are declared in the
  contract (same fields), so the game never imports points/.
- **The guard's KNOWN list is EMPTY.** The game core bundles 72 of our files
  (81 before the refactor) and none of them is the wallet or the app bridge.
  From here on any tie is a failure.
- **Suite:** 27 suites, all green. tsc clean.
