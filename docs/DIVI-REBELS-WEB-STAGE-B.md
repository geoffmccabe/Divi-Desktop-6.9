# Divi Rebels on the Web, Stage B: the web door

Started 2026-Sep-13. Parent plans: docs/DIVI-REBELS-WEB-PLAN.md and
docs/DIVI-REBELS-SHARED-CORE-PLAN.md.

Geoff, changing the order: "It doesn't need to start with the Auth part, or you
can build it but not require it... make a button to just get in and start
playing if needed. Go ahead and start now."

## The revised order

1. **B1: play as a guest.** The web door, the room learning web guests, the
   page, and the Worker that serves it. Deployed to a workers.dev address for
   Geoff to try BEFORE anything is attached to divi.love.
2. **B2: sign in, offered not required.** LW-SSO, a Rebels session, `sso:`
   accounts, the guest's banked DIVI moving into the signed-in account, and
   cash-out with the farm guards. Needs Geoff's greenlight (SSO admin panel and
   Vercel) to complete a login on divi.love. localhost is always allowed, so
   it can be built and tested first.
3. **B3: divi.love/rebels.** The Worker attached to that path. Geoff says go
   first, because it is his public site.
4. **B4: the Scanner tower in the app**, so app players see where web players
   launch.
5. **B5: launch checks.** Load time, sound in Chrome and Safari, a mixed session
   through DFlow, a content security policy for the page, and a trial farm.

## Decisions taken in B1

- **A guest is "Pilot" and four digits.** Picked once and kept in the browser.
  It is the name others see and the key its saved rows use until sign-in.
- **The room gives a web guest its own ledger account**, `web:` plus its
  internet address, so a guest and an app player behind the same router never
  share a balance.
  - A guest's DIVI is banked exactly like anyone's.
  - Every purse a guest receives says "Sign in to cash out DIVI earned on the
    web. It stays banked to you until you do." and offers no amount to cash out.
  - A cash-out request from a guest is not passed to the ledger.
- **The "web" marker is taken on the client's word.** A lie only hurts the liar,
  because claiming "web" gives up cashing out. A client that hides the marker is
  back where every client is today (an address account). B2 is what closes that,
  with signed-in sessions.
- **The DIVI price** on the web is the same row the app uses: the newest good
  close in the Divi project's CoinMarketCap-fed `divi_price` table. A browser may
  read it directly (checked: the project answers divi.love with CORS allowed).
- **DIVI addresses are checked in the page** the way the node checks them: base58,
  prefix 30 or 13 (divi-core chainparams.cpp), double SHA-256 checksum.
- **The node list** comes through our own Worker (`/rebels/api/nodes`), because the
  Scanner's RPC does not allow other sites to read its answers (checked: a
  preflight gets 405 and a plain POST has no CORS header). It is cached for five
  minutes, and a failed read is not cached.
- **The Scanner is home.** The 24 most recently seen nodes are drawn as its peers
  and the rest as the wider network. With no list, the game opens from London
  alone.
- **Buying points with DIVI stays in the app** for now, since sending DIVI needs a
  wallet. The button says so.

## Log

### B1 code (2026-Sep-13), branch feat/rebels-web in /Users/geoffreymccabe/dd69-rebels-core
- **Contract:** `joinFields` may return `door: "web"`. The room client and the
  cockpit pass it on, and the app sends none.
- **Room** (contrib/rebels-room): `JoinIn.door`, `Seat.guest`, the `web:`
  account, guest purses and guest claims. New room tests (179 in all):
  - app and guest on one address stay apart
  - a guest's run is banked to the guest's account
  - no ledger request for a guest
  - the guest is told on joining and on asking
  - the app player in the same house still cashes out
- **Web door** (ui/src/web-rebels/): diviAddress.ts, webNodes.ts, webPrice.ts,
  pilot.ts, webDoor.ts, main.tsx (the real page), web.css. 30 tests in
  scripts/run-rebels-web-tests.sh.
- **Cockpit test** (103 in all): a game behind the web door joins the real
  in-process room as its guest name, and the room marks it a web guest.
- **Worker** (contrib/rebels-web): serves the build under /rebels/, the node list,
  redirects to /rebels/, 404 elsewhere, cache headers. 15 tests in
  scripts/run-rebels-web-worker-tests.sh.
- The web build now writes into ui/dist-web/rebels/, so the Worker can hand the
  folder over as it is.
- **Suite:** 29 suites, all green. tsc clean. The guard finds no ties for either
  the core or the web page.

### B1 deployed (2026-Sep-13)
- **Merged:** feat/rebels-web fast-forwarded into feat/divi-rebels (the gameplay
  folder was clean) and pushed, so a later room deploy from either folder
  carries the guest handling.
- **Room Worker:** divi-rebels-room deployed with the guest change, version
  7f07c156. /health answers ok. App clients send no door marker, so they are
  unchanged.
- **Web Worker:** divi-rebels-web deployed, version 7f81219a, at
  https://divi-rebels-web.geoff-de3.workers.dev/rebels/. No route on divi.love.
  Checked live:
  - / redirects to /rebels/
  - the page is 200 with no-cache and nosniff
  - hashed files are cached for a year
  - /rebels/api/nodes returns 74 located nodes from the Scanner
- **Seen in headless Chrome on the live address:** the launch card reads
  "Launching from London, United Kingdom." and the button reads LAUNCH, which
  appears only once the room connection is up. So the page reached the real
  room as a guest.
- **Not yet seen:** flying, sound and the frame rate in a real browser. Geoff
  is the test for those.

### Multiplayer-ready for a public page (2026-Sep-13)
Geoff: "put this onto divi.love/rebels since it's already playable, but ONLY if
it's multi-layer-ready. if it isn't then do that and then add it to the
website." (Read as multiplayer-ready.)

**It was not.** Three problems, all fixed:
1. **One room, 24 places, and every open page took one.** Someone sitting on the
   launch card counts too. Twenty-four idle visitors on a public page would have
   locked everyone else out, app players included, and the locked-out pages
   retried forever, because a browser cannot read a refused websocket's status.
   - **Fixed with overflow rooms.** A full room accepts the socket just long
     enough to send `{t:"full", next}` and close. The client goes straight to the
     next room: earth, then earth-2 up to earth-16. Every ordinary reconnect
     starts from earth again, so the shared world refills as people leave.
2. **Any room name created a new Durable Object.** The router now accepts only
   earth, earth-2 to earth-16, and p1 to p14 (held for the planet shards).
3. **A background tab held its seat forever.** A tab hidden for three minutes now
   gives the seat back, and returning to it reconnects at once.

**Also before going public:** a web guest's DIVI is banked under a private
random id made in their browser (`guest:<id>`), not their internet address. So
it follows them between visits and connections, and nobody who launched on the
public page loses a balance when their address changes.
- The id and the pilot name live in IndexedDB (ui/src/web-rebels/webStore.ts)
  with a copy in localStorage.
- restoreGuest() puts back whichever copy survived, before the game joins the
  room.
- An id that fails the room's check falls back to the address account.
- An app player sending an id is still its address account.

**Tests:**
- room: 193 (overflow names, next room, guest ids)
- room client: 65 (full hop with no backoff, an odd `next` ignored, hidden tab
  released and reconnected)
- web door: 35 (guest id kept, IndexedDB restoring a cleared guest)
- Full suite: 29 green. tsc clean.

### LIVE at https://divi.love/rebels/ (2026-Sep-13)
- **Landing page backed up first:** /Users/geoffreymccabe/divi-love-site-backup/index-2026-09-13.html
  (161,287 bytes, self-contained, no relative assets).
- **Deployed:** the room (version 5b753dcf: overflow, room names, guest ids), and
  the web Worker (version b0e87541) with routes `divi.love/rebels*` and
  `www.divi.love/rebels*`. The worker's workers.dev address still answers.
- **Checked live:**
  - https://divi.love/ is byte-identical to the backup
  - an unrelated path (/about) is still the landing page
  - /rebels redirects to /rebels/, which is the game, on both divi.love and www
  - /rebels/api/nodes gives 74 nodes
  - an invented room name is 404
- **In Geoff's real Chrome:** the launch card read "Launching from London,
  United Kingdom." and LAUNCH came up. The connection took roughly 15 s while
  the globe built its towers, which is for B5 (load time).
- **Headless Chrome on this machine** (load average around 80) never finished
  building the globe within 45 s: the main thread was busy the whole time,
  shown by the 10 s "GLOBE NOT READY" timer never firing. That is not
  representative of a real browser, as the run above shows.
