# Divi Rebels on the Web: divi.love/rebels

Written 2026-Sep-13. Status: PLAN, nothing built.

Geoff's brief: "make a plan to build this at /rebels and they should log in
using lw-sso auth system... Users who don't have a node can log in with Google
or with email. They will launch from the Scanner node, which is in the UK for
now. It's important that this works with Multiplayer along with the app-based
game too." And: "We should be greenlighting all of scan.divi.love and divi.love
too while we're doing this."

## The shape of it in one paragraph

ONE game, TWO front doors. The desktop app keeps its door. A second door opens
at https://divi.love/rebels, built from the SAME game files (not a copy), so a
fix to the game lands in both. Web players sign in through LW-SSO with Google
or email, launch from the Scanner node tower in London, and fly in the SAME
sky ("earth" room) as app players. The room server learns to tell the two kinds
of player apart: app players stay exactly as they are today, web players are
identified by their verified LW-SSO account.

## What the research found (facts, with where they came from)

### divi.love today
- Cloudflare Pages project `divilove`, uploaded by hand (no Git), last changed
  about a month ago. Domains: divi.love, www.divi.love. It is ONE exported page
  and every unknown path (including /rebels) shows that same page.
- ⚠ **No source for that page exists on this Mac.** A new upload to `divilove`
  REPLACES the whole site, so this plan never uploads to it. See Hosting.
- scan.divi.love is a separate Pages project `divilovescan`, source at
  /Users/geoffreymccabe/Divilovescan.

### LW-SSO (/Users/geoffreymccabe/sso, live at https://sso.lightningworks.io, on Vercel)
- Not OAuth. The site sends the player to
  `https://sso.lightningworks.io/login?app=<slug>&redirect=<full return URL>`.
  After login the player comes back to the return URL with their session token
  in the part of the address after `#` (never sent to any server by the browser).
- The site proves the token is real by sending it to
  `POST https://sso.lightningworks.io/api/verify`, which answers with the
  player's permanent user id, email, username, display name, role and avatar.
  Open to any website (CORS `*`), no rate limit.
- The token is a normal one-hour Supabase session token from the SSO's own
  project. Best practice (what the Anamaya site does): verify it ONCE, then
  give the player our own longer Rebels session.
- Login methods that WORK today: Google, email + password, Discord.
  Apple and X are shown as "coming soon". There is no magic-link email login
  and no DIVI address login.
- **The greenlight lives in TWO places**, and they do different jobs:
  1. The SSO admin panel, per app ("Allowed Redirect Origins"). Saved straight
     to the database, works instantly, no redeploy.
  2. Vercel environment variables `ALLOWED_REDIRECT_ORIGINS` and
     `NEXT_PUBLIC_ALLOWED_REDIRECT_ORIGINS`. These cover EVERY app and a few
     SSO endpoints that only read the Vercel list. The `NEXT_PUBLIC_` one is
     baked in when the site is built, so it needs a REDEPLOY after editing.
  - Only the site ADDRESS is checked, never the path, so `/rebels` needs nothing
    of its own.
  - `https://*.divi.love` covers divi.love, www.divi.love, scan.divi.love and any
    future subdomain in ONE line.
- **Two SSO bugs that hit email players** (files in /Users/geoffreymccabe/sso):
  - "Create one" goes to a bare sign-up page that forgets where the player came
    from, so a NEW email player is not sent back to Rebels
    (src/app/signup/page.tsx).
  - "Forgot password" links to a page that does not exist.
  Google players are unaffected. Both must be fixed before launch.

### The game
- None of the game's own files call into the desktop app. The pieces that do are
  around it: the wallet's network map that hosts the globe, the DIVI price, the
  buy-points-with-DIVI panel and wallet address checks.
- The globe (towers, links, planet) is web-ready. The TOWER LIST is not: in the
  app it comes from the player's own node's peers.
- 3D models and music load from assets.dreadroot.com, which allows any site.
- The room server (Cloudflare Worker `divi-rebels-room`) accepts a connection
  from any website today, with no origin check.
- Today a player's account in the room is their INTERNET ADDRESS, and their
  items, ship and scores in Supabase are keyed by a NAME that anyone could type.
  That is tolerable inside the app. On the open web it is not.

### The Scanner node
- 109.228.38.104, London (IONOS). It is also the treasury and payout node.
- It is NOT a fixed tower on anyone's globe today. App players only see it if
  their node happens to be peered with it.
- The Scanner's explorer already has a list of up to 400 located nodes
  (`scan_known` on https://scan.divi.love/api/rpc), but it does not allow other
  websites to read it, so the web game will fetch it from our own server side.

## What Geoff needs to do: the greenlight

Do both steps. The first makes Rebels work; the second is the Vercel side that
covers divi.love and scan.divi.love for every app.

**Step 1: the SSO admin panel (instant)**
1. Open https://sso.lightningworks.io/admin and go to the Apps tab.
2. Click New App.
3. Name: `Divi Rebels`
4. Slug: `divi-rebels`
5. In "Allowed Redirect Origins", copy/paste this one line:

   https://*.divi.love

6. Save.

**Step 2: Vercel (needs a redeploy)**
1. Open the SSO project in Vercel, then Settings, then Environment Variables.
2. Edit `ALLOWED_REDIRECT_ORIGINS` (Production). ADD to the END of what is
   already there, do not replace it. Copy/paste:

   ,https://*.divi.love

3. Edit `NEXT_PUBLIC_ALLOWED_REDIRECT_ORIGINS` the same way, adding the same text.
4. Go to Deployments, open the latest production deployment, choose Redeploy.
   Without the redeploy the second variable does not take effect.

Nothing else on Google's side changes: Google sends players back to the SSO
itself, not to divi.love.

## Hosting: where /rebels lives

A small Cloudflare Worker, `divi-rebels-web`, attached to the address
`divi.love/rebels*` only. Cloudflare sends /rebels traffic to the Worker and
everything else still goes to the existing landing page, which is never
touched. The Worker:
- serves the web build of the game (files under /rebels/),
- verifies the SSO token and hands out the Rebels session (`/rebels/api/session`),
- fetches and caches the Scanner's node list (`/rebels/api/nodes`).

Before any route is added, the live landing page is downloaded and kept as a
backup, since no other copy exists.

## Identity: how app and web players share one sky

| | App player (unchanged) | Web player (new) |
|---|---|---|
| Proves who they are with | their internet address, as today | a verified LW-SSO account |
| Room account | the address, exactly as today | `sso:` followed by their permanent SSO user id |
| Name shown to others | node name | SSO display name |
| Launches from | their own node tower | the Scanner node tower, London |
| Room | "earth" | "earth", the same one |

- App accounts are left EXACTLY as they are, so no existing player's balance,
  items or scores move. An internet address can never begin with `sso:`, so the
  two can never collide, even when a web player and an app player share a house.
- The SSO token is checked once, when the web player joins, never on every
  message.
- Web players' items, ship and scores are written by OUR server after it knows
  who they are, never directly by the browser. (The app's own looser writes are
  a known gap, logged in DIVI-REBELS-CASHOUT.md, and are out of scope here.)
- SSO accounts carry a `role`. The test cheats become ADMIN ONLY for web players
  instead of open to everyone.

### The Scanner tower must be on BOTH globes
If app players cannot see the Scanner tower, web players appear to launch from
empty space. So the Scanner node becomes a permanent "public hangar" tower on
every globe, app and web, at a fixed London position. This is an app release
too.

### Tower lists will differ slightly at first
App players see their own node's peers; web players see the Scanner's list.
That only changes the scenery: enemies, other ships, shots, loot and the Scanner
hangar are shared, because the server decides those. A later step can give both
the Scanner list.

## The look: matching Divi Rebels

The web page does NOT copy colours by hand. It loads the SAME stylesheets
(orbit.css and the Rebels part of the wallet stylesheet) and the SAME theme
values, so the cockpit, launch card, help keyboard and panels are identical to
the app and stay identical when either changes.

The new pieces (sign-in card, "play on a computer" notice, loading screen) are
built from the Rebels palette:

| Role | Colour |
|---|---|
| Space background | #07060e |
| Cockpit text, borders, glow | #b093ec (lavender) |
| Main buttons, title | #b447eb (Divi purple) |
| Your node, score | #ffd147 (gold) |
| Coastlines | #56e1c5 |
| Points | #7fe3a0 |
| Warnings | #ff5c5c |

Style: uppercase monospace text with wide letter spacing, thin 1px lavender
borders, frosted blurred panels over the dark space background, small rounded
corners, soft purple glow, and the red panda badge above "DIVI REBELS".

The SSO login page itself can wear these colours: the app row has a theme
setting and the login address accepts colour overrides, so the step from
divi.love to the SSO and back does not feel like leaving the game.

## What web players can and cannot do at launch

Can:
- fly, fight, waves, dragons, loot, items and inventory
- see and fight alongside app players in the same sky
- scores on the same leaderboard, marked as web players
- earn and spend POINTS

Cannot (proposed, needs Geoff's decision below):
- earn or cash out DIVI
- buy anything with DIVI (that needs a wallet)
- play on a phone (keyboard and mouse only; phones get a friendly notice)

The pitch on every screen where a web player hits a limit: get the app, run a
node, earn DIVI.

## Phases

Each phase ends with the full test suite green and the app still working for
app players.

**Phase 0: safety and greenlight.** Back up the live landing page. Geoff does
the two greenlight steps above. Create the `divi-rebels` app row with the Rebels
theme.

**Phase 1: SSO fixes for email players** (repo /Users/geoffreymccabe/sso, deploys
through Vercel). Sign-up keeps the return trip to the site the player came from;
build the missing forgot-password page.

**Phase 2: the room learns two kinds of player** (repo
/Users/geoffreymccabe/dd69-rebels, contrib/rebels-room).
- Joining with a verified SSO session gives an `sso:` account.
- Such a player spawns at the Scanner hangar, carries their SSO display name,
  and does not need a node.
- DIVI crediting and cash-out are refused for `sso:` accounts (per the decision
  below).
- Cheats are admin-only for them.
- The room only accepts connections from the app and from divi.love.
- New tests: an app seat and a web seat in the same room see each other's ships,
  shots and enemies; two players on one internet address keep separate
  accounts; a web seat cannot cash out; an app seat behaves exactly as before.
- Deployed only after the app is re-tested against it, because app players are
  live on this server.

**Phase 3: the web front door** (same repo, ui).
- A second build entry that mounts the SAME game and globe with a small web host
  in place of the wallet's network map.
- Towers come from the Scanner's list; home is the Scanner hangar.
- A sign-in card, session handling, and the points and weapon stores with the
  DIVI parts hidden.
- A normal multi-file build under /rebels/ so returning players load from cache.

**Phase 4: hosting.** The `divi-rebels-web` Worker on `divi.love/rebels*`:
serves the build, verifies sessions, caches the node list. The landing page is
checked afterwards to confirm it is untouched.

**Phase 5: the Scanner hangar in the app.** Permanent London tower on the app's
globe so app players see where web players launch. App version bump and install.

**Phase 6: launch hardening.**
- Load time on a first visit, and on a slower laptop.
- Sound in Chrome and Safari.
- The phone notice.
- A mixed soak: several web players and the app together for half an hour,
  read through DFlow.
- Remaining network plan phases if the player count grows, since a public page
  brings more players than the app does.

## Decisions Geoff needs to make

1. **DIVI for web players?** Recommendation: not at launch. Email accounts are
   free to make in bulk, and DIVI is real money. Points and scores yes. DIVI is
   the reason to get the app.
2. **Keep web and app progress separate at first?** Recommendation: yes. Later a
   player can link their SSO account inside the app so both doors share one
   inventory.
3. **Discord** also appears on the SSO login page. Keep it, or show only Google
   and email for Rebels?
4. **Cheats on the web:** admins only (recommended), or off entirely?

## Later, not in this plan
- Linking an app node account to an SSO account.
- Phone and touch controls.
- DIVI address sign-in for node owners on the web.
- Moving the room onto a divi.love address instead of workers.dev.
