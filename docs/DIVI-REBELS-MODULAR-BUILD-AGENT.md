# Divi Rebels modularization: the build and versions part

Written 2026-Sep-14 for the Claude Code build agent. The game-side half is
docs/DIVI-REBELS-MODULAR-GAME.md, owned by the game session. Read both before
starting: this document says what is yours, what is not, and in what order.

Geoff's direction: "I want to have the claude code build agent do most of this,
since it's so clearly related to building different versions. But when it comes
to the game itself, [the game session] can do it."

---

## 1. What exists today

**Divi Rebels** is an arcade space game flown over the real Divi node globe.
There are four versions, with ONE shared game core:

| Version | Status | How it is built and shipped |
|---|---|---|
| DD69 desktop app | live | Tauri wallet. The UI is built by ui/vite.config.ts into one inlined file. Installed on Geoff's Mac by scripts/install-local.sh, which bumps the version, builds, installs to /Applications/DD69.app and relaunches. |
| Web, divi.love/rebels | live | ui/vite.web.config.ts builds multi-file into ui/dist-web/rebels/. Served by the Cloudflare Worker contrib/rebels-web (routes divi.love/rebels* and www.divi.love/rebels*). |
| Mobile web | not built | Planned as a third door. The web version must NOT be reduced for phones. |
| Divi Lovenode | being built by another agent | /Users/geoffreymccabe/Divi-lovenode (public repo geoffmccabe/Divi-lovenode). A light-node staking wallet for Android and iOS: Tauri shell, React 18, Vite. Its plan includes a DD69-style UI and a network map. |

**Code:**
- Repo: /Users/geoffreymccabe/dd69-rebels, a git worktree of geoffmccabe/Divi-Desktop-6.9 (public) on branch feat/divi-rebels.
- A second worktree, /Users/geoffreymccabe/dd69-rebels-core on branch feat/rebels-web, is used by the game session.
- A third Claude session (the "gameplay session") also adds game features in /Users/geoffreymccabe/dd69-rebels.

**Architecture: one core, thin doors.** Read docs/DIVI-REBELS-ARCHITECTURE.md
first; it lists every module and where it runs.
- The game core only talks to the outside world through a door.
  - The contract is ui/src/wallet/rebels/platform/platform.ts.
  - The registry is platform/current.ts.
- The app door is ui/src/wallet/rebels/platform/app/. The web door is ui/src/web-rebels/.
- scripts/check-rebels-boundary.mjs bundles the core and the web page and FAILS if any wallet or Tauri-bridge file ends up inside. Its known-ties list must stay empty.
- The multiplayer server (contrib/rebels-room, Cloudflare Durable Objects) is shared by every version. It imports the game's simulation files from ui/src/wallet/rebels/ by relative path.

**More background:**
- docs/DIVI-REBELS-SHARED-CORE-PLAN.md
- docs/DIVI-REBELS-REFACTOR-STAGE-A.md
- docs/DIVI-REBELS-WEB-PLAN.md
- docs/DIVI-REBELS-WEB-STAGE-B.md
- docs/DIVI-REBELS-NETWORK-PLAN.md

---

## 2. Rules (read these twice)

**Ownership. The most important rule, because three agents work in this repo.**

The GAME SESSIONS own, and you do NOT edit, except during your Task B2 freeze:
- the game: ui/src/wallet/rebels/** (after B2, wherever it moved to), except
  the doors named below
- the multiplayer server: contrib/rebels-room/**
- ui/src/index.css Rebels rules and ui/src/wallet/rebels/orbit.css (the game
  session is moving the game's styles out of the wallet stylesheet)

YOU own:
- repo layout, package and path configuration, tsconfig and Vite configs
- the test runner and CI
- the globe split (Task B3), coordinated as described there
- the version doors and their pages: ui/src/web-rebels/**, the mobile web door
  (new), the Lovenode door (new)
- the web host Worker contrib/rebels-web/**
- build and deploy scripts for the versions
- the LW-SSO sign-in flow for the web door (Task B6); the server-side check of a
  signed-in session is the game session's

SHARED, changed only by agreement:
- ui/src/wallet/rebels/platform/platform.ts, the door contract
- Additive changes only. Say what you need and why, and the game session or
  Geoff agrees before it lands.

**Git:**
- Work in your own worktree on your own branch, cut from the latest feat/divi-rebels.
- NEVER `git add -A`, never `git stash` bare, and never revert or overwrite
  anyone's uncommitted work. Check `git status` in /Users/geoffreymccabe/dd69-rebels
  before merging into it.
- Before merging OUT: merge feat/divi-rebels INTO your branch, run the full
  suite, then fast-forward feat/divi-rebels only when that folder is clean.
- Commit messages end with the attribution lines your harness gives you.

**Quality gates, every time you push:**
- The FULL test suite: every scripts/run-*tests.sh (31 today, including the
  boundary guard). Never a filtered subset: a filtered pass once hid a race.
- `npx tsc --noEmit` in ui/.
- No behaviour change unless the task says so.

**Live systems:**
- The game is LIVE. App players and web players share the same rooms.
- Do NOT deploy contrib/rebels-room (the game session owns it).
- Deploying contrib/rebels-web is yours, but ask Geoff before changing anything
  about the divi.love routes.
- divi.love's landing page is a separate hand-uploaded Cloudflare Pages project
  ("divilove") with no source on disk. A backup is at
  /Users/geoffreymccabe/divi-love-site-backup/. Never upload over it.
- Wrangler here needs Node 22+: run it with /opt/homebrew/bin/node, e.g.
  `/opt/homebrew/bin/node contrib/rebels-room/node_modules/wrangler/bin/wrangler.js`.

**Security and dependencies:** follow /Users/geoffreymccabe/.claude/CLAUDE.md.
- Scan build config and entry files before local builds.
- Prefer NO new dependencies. Verify any you truly need on the registry first.

**Talking to Geoff:** follow his CLAUDE.md.
- He is not a coder: plain English, no code in chat, full file paths.
- Calibrated confidence: say what you verified versus what you expect.
- End each reply with `Live: <url> (vX.Y.Z)`.

---

## 3. Your tasks, in order

### B1. One test command, and CI
- One script (scripts/run-all-tests.sh) that runs every scripts/run-*tests.sh
  and the TypeScript check, prints one line per suite plus a total, and exits
  non-zero on any failure.
- Timing checks are sensitive to machine load; do not loosen them (see the
  "fastest of six batches" approach in rebelsFlock.test.ts).
- A GitHub Actions workflow running it on pushes to feat/divi-rebels and on pull
  requests. Keep it separate from the existing .github/workflows/build-apps.yml.
- Mind the repo's quirk: ui/node_modules is tracked as a symlink. In CI install
  with `npm ci --ignore-scripts` in ui/ and contrib/rebels-room/.
- **Done when:** the one command is green locally, CI is green on GitHub, and the
  game session has been told the command exists.

### B2. Move the game into its own package (needs a FREEZE)
- **Why:** the game, the globe and the shared message code live inside the
  wallet's folder (ui/src/wallet/rebels/). Nothing outside DD69 can use them
  without copying, and the server reaches into the wallet's folder by path. A
  package makes "the game has no wallet inside it" part of the structure and
  lets DD69, the web build, the server and later Lovenode use one copy.
- **What:** a top-level packages/divi-rebels/ holding:
  - the game core: all of ui/src/wallet/rebels/ except platform/app/
  - its assets
  - ui/src/supabaseProject.ts
  - the globe files: ui/src/wallet/GlobeMap.tsx, towerLights.ts, globeDetail.ts,
    earthTiles.ts, globeBorders.ts, activityPulse.ts
  - the shared sound bus ui/src/sound.ts, or a clear seam to it
- The app door stays in the app (ui/). The web door stays with the web page.
- **How:**
  - A PURE MOVE: `git mv` plus path updates, no behaviour change.
  - Prefer a path alias (for example `@divi/rebels`) wired into both Vite
    configs, tsconfig, the esbuild test runners and the room's wrangler alias,
    over new tooling. npm workspaces are acceptable if they keep ui/'s install
    working.
  - Point the room server's imports at the package.
  - Point the boundary guard at the package entry.
- **FREEZE:** before starting, ask Geoff to pause the game session and the
  gameplay session. Merge in their last commits, do the move, merge out, and
  tell Geoff it is done. Keep the freeze short: move first, tidy later.
- **Done when:**
  - the full suite and tsc are green, and the guard reports no ties
  - the app installs via scripts/install-local.sh and plays identically (Geoff checks)
  - the web build deploys identically: divi.love/rebels loads and connects
  - the room's own tests pass. If the room's bundle changed, ask the game session
    to redeploy it.

### B3. Split the globe from the wallet's map extras
- **Why:** ui/src/wallet/GlobeMap.tsx (about 1,300 lines) mixes three things:
  - the Earth, towers and network links (wanted by every version, and by
    Lovenode's planned network map)
  - the flight hook the game uses (the GlobeFlight interface)
  - wallet-only extras: the stake-winner decoration and the activity-pulse
    ripple, about 32 references
  It also imports the game's DFlow recorder, so the wallet's map depends on the
  game.
- **What:** a Divi globe module that draws Earth, towers and links, with the
  wallet extras as optional add-on layers the Node Map passes in. Replace the
  DFlow import with a timing hook the game supplies.
- **Constraints:**
  - The GlobeFlight interface stays EXACTLY as it is: the game depends on it.
  - The gameplay session edits GlobeMap for performance, so do this straight
    after B2 while the freeze is still on, or agree a window with Geoff.
  - The detail seam (platform().detail: peer links, network links, pixel ratio)
    stays.
- **Done when:**
  - The Node Map in the app looks and behaves the same: towers, links, the winner
    coin and the pulse ripple.
  - The game is identical in the app and on the web.
  - The globe, earth and orbit tests pass.
  - A new test builds the globe with no wallet add-ons.

### B4. Build and deploy scripts for the versions
- One documented script to build and deploy the web version: the Vite web build,
  then the Worker deploy with /opt/homebrew/bin/node, then a check that
  divi.love/rebels/ answers and /rebels/api/nodes returns nodes.
- One shared version number for app and web (both already read
  crates/app/tauri.conf.json). Show it somewhere unobtrusive on the web page if
  Geoff agrees.
- **Done when:** a fresh deploy from the script matches today's site.

### B5. The mobile web door (skeleton; the game session builds the touch controls)
- **Why:** phones get their own door and layout on the same core; the web version
  is not reduced.
- **What you build:**
  - a mobile entry, or phone detection on divi.love/rebels, behind a test flag
    (`?mobile=1`) until Geoff approves it publicly
  - an installable web app manifest, since iPhone Safari only allows true full
    screen via "Add to Home Screen"
  - a "turn your phone sideways" card
  - a phone detail profile in the mobile door (fewer links, lighter planet,
    capped textures)
- **What you do NOT build:** touch controls and the phone cockpit layout. Those
  are the game session's (G7 to G9) and depend on its controller split. Leave a
  clear place for them and use desktop input until then.
- **Done when:** ?mobile=1 loads the game on a phone in landscape with the phone
  profile, and nothing changes for desktop web visitors.
- **Already built by the game session (2026-Sep-15), ready to plug in:**
  `createTouchInput()` and `PhoneHud` from ui/src/wallet/rebels/platform/coreEntry.ts.
  A temporary `?phone=1` switch in ui/src/web-rebels/main.tsx and an `input`
  option on `createWebDoor` show them today. Replace that switch with your phone
  detection and door (keep passing the touch input to the door and to PhoneHud),
  then remove the `?phone=1` lines.
- **Changed in your area on 2026-Sep-16 (small, say if you would rather own it):**
  ui/vite.web.config.ts had `publicDir: false`; it now points at
  ui/web-rebels/public so the web app manifest and home screen icon are built.
  ui/web-rebels/index.html gained the apple/manifest meta tags. Both are for
  "Add to Home Screen", which is the only way an iPhone gives the game the whole
  screen; your B5 manifest work can replace them.

### B6. LW-SSO sign-in for the web door (offered, never required)
- **Background:** docs/DIVI-REBELS-WEB-PLAN.md (the greenlight section) and the
  LW-SSO repo /Users/geoffreymccabe/sso (Next.js on Vercel, sso.lightningworks.io).
- **The flow:**
  - Send the player to `/login?app=divi-rebels&redirect=<return URL>`.
  - Tokens come back in the URL hash.
  - The Worker verifies the token with `POST /api/verify` and issues a Rebels
    session.
  - The web door then reports a signed-in identity.
- **Geoff's greenlight first:**
  - `https://*.divi.love` in the SSO admin panel (app slug divi-rebels)
  - the same added to the Vercel variables ALLOWED_REDIRECT_ORIGINS and
    NEXT_PUBLIC_ALLOWED_REDIRECT_ORIGINS, then a redeploy
  - localhost is always allowed, so you can build and test before that
- **Known SSO bugs to fix in /Users/geoffreymccabe/sso:** new email sign-ups are
  not sent back to the site, and /forgot-password does not exist.
- **Carrying a guest's things into their account:** a guest's progress is in
  IndexedDB and filed under `guest:<id>` (ui/src/web-rebels/pilot.ts,
  webStore.ts). The server-side merge of a guest's banked DIVI into the signed-in
  account is the game session's; agree the handover with it.
- **Done when:** a guest can sign in with Google or email and keep everything,
  and playing without signing in still works exactly as today.

### B7. Lovenode: how it shares, and its door
- **First, a short plan for Geoff and the Lovenode agent** (repo
  /Users/geoffreymccabe/Divi-lovenode; read its docs/FOR-OTHER-AGENTS.md):
  - How Lovenode consumes packages/divi-rebels: a git submodule, a published
    package, or a vendored copy with a sync script. Both repos are public.
  - What Lovenode gets first. Recommendation: the globe and network map, then
    the game only if Geoff says yes.
  - The Lovenode door:
    - identity from the phone wallet's own address, which can sign
    - progress in IndexedDB in its webview
    - money through its Rust wallet commands (real sends, so buying points and
      cash-out can work)
    - the phone detail profile
    - touch input, once the game session has it
- Do NOT edit the Lovenode repo's staking, keystore or relay code. Its agent owns
  those.
- **Done when:** Geoff and the Lovenode agent have agreed the plan. Any prototype
  lives on a Lovenode branch that its agent reviews.

---

## 4. How this fits with the game session's work

| Step | Build agent | Game session |
|---|---|---|
| 1 | B1 test command + CI | planning only |
| 2 | B2 package move, then B3 globe split (FREEZE) | paused |
| 3 | B4 deploy scripts, B7 Lovenode plan | G1 message codec, G2 cheats module, G3 change store, G4 styles out of the wallet |
| 4 | B6 sign-in (after Geoff's greenlight) | G5 account module, G6 server identity split (needed by sign-in) |
| 5 | B5 mobile door skeleton | G7 controller split into actions, G8 cockpit screen pieces |
| 6 | B7 Lovenode door | G9 touch controls and phone layout (plugs into B5), G10 combat split (later) |

At the end of each task, report to Geoff what changed, what you verified, and
what is waiting on whom. Update this document's task with a short "Done" note.
