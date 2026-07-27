# Divi Community Apps — scope for review

**Status: proposal, not approved. Nothing built yet.**

Lets outside developers build small apps for Divi Desktop 6.9 by chatting with
Claude inside the wallet, pay for the AI in DIVI, and publish the result to a new
**Community Apps** panel where other users can browse, buy, and run them.

This document is the plan Geoff approves before any code is written. It is
deliberately blunt about what is safe, what is not, and what we do not know yet.

---

## 1. The three pieces

| Piece | What it is | Who touches it |
|---|---|---|
| **Runtime** | The sandbox inside DD69 that runs a community app, plus the Community Apps browse panel | Every DD69 user |
| **Builder** | A chat panel where a developer describes an app and Claude writes it, with live preview | Developers who opt in |
| **Gates** | Prompt scanner, code scanner, publish review, plus an admin panel to tune all three | Geoff only |

They can ship in that order. The runtime is useful on its own (we can write the
first two apps ourselves), the builder is useless without the runtime, and the
gates are mandatory before anyone outside the team touches the builder.

---

## 2. Security model — read this first

The honest engineering position: **prompt filtering is not the security boundary.**
Anyone determined enough will eventually talk a language model into writing
something we did not intend. What actually protects users is that a community app
physically cannot reach anything dangerous, no matter what its code says.

So the design has one hard rule and three soft layers.

### The hard rule: capability isolation

A community app is untrusted web code (HTML/CSS/JS) that runs in a sandboxed frame
with **no access to the wallet's internals**. It cannot call the wallet's Rust
commands directly. It talks to a **broker** in the host app over a message channel,
and the broker only exposes a small, fixed, permission-checked API.

Two facts about DD69 make this both easy and dangerous:

- `crates/app/tauri.conf.json` sets `withGlobalTauri: true` — every Rust command is
  reachable from JavaScript in the main window. This is exactly what must never be
  reachable from an app frame.
- The same file sets `"csp": null` — the app currently ships with **no content
  security policy at all**. That is fine today (we wrote all the code); it is not
  fine the moment we host someone else's. **Adding a real CSP is a prerequisite of
  this whole feature**, and it must be done and tested before anything else here.

Good news: `crates/app/capabilities/default.json` already scopes permissions to
`windows: ["main"]`. A second webview with a different label inherits nothing.
That gives us a verifiable second isolation option if the frame approach proves
weaker than expected.

### Never available to a community app, at any permission level

- Private keys, seed phrase, WIF export, wallet passphrase, unlock/lock
- Raw node RPC, or any ability to start/stop/configure the node
- Sending coins without an explicit, native, outside-the-frame confirmation
- The filesystem, the OS, other apps' data, or the user's real IP
- Our AI gateway token, the Arweave relay token, or any Divi service credential
- Anything that writes to our servers as us

### Available, if the app asks and the user agrees

Grouped into named permissions the user sees in plain English at install time:

- **Read balance** — spendable / staking totals only, no address list
- **Read addresses** — the user's own receive addresses
- **Read history** — transaction list
- **Read collectibles (NFDs)** — owned items, thumbnails, traits
- **Read tokens (DMT)** — token balances and metadata
- **Read network map** — peer/geo data we already show
- **Request payment** — app asks for X DIVI; the wallet, not the app, shows a
  native confirm dialog and performs the send. Per-app spend cap, daily cap, and
  a full audit log. The app never sees a key and never sees the outcome except
  "paid / not paid".
- **Store data** — a small, per-app, quota'd key-value store. Isolated per app.
- **Network** — an explicit allowlist of hosts, declared in the manifest, brokered
  through the host so we can log and revoke it. Default is no network.

### Three soft layers on top

1. **Prompt scanner** — checks what the developer types before it reaches Claude.
2. **Code gate** — checks what Claude wrote before it can run or be published.
3. **Publish review** — nothing appears in Community Apps until it is signed by us.

Each is described in section 5.

---

## 3. Piece 1 — the runtime and the Community Apps panel

### New left-sidebar item

One entry added to `ui/src/nav.ts` and one route in `ui/src/Shell.tsx`, matching
how every other panel is wired. New files live under `ui/src/apps/` so we do not
fight the other agents over `ui/src/index.css` and `crates/app/src/main.rs`.

### The browse grid

Thumbnails at **3:2 aspect ratio**, as specified. Each card supports:

- a single WebP image
- a slideshow of WebP images (cross-fade, pauses off-screen)
- a video under 20 MB (MP4 or WebM, muted, loops, autoplay only when visible)
- a YouTube link

**YouTube — decided: embedded player.** Geoff's call. Embedding means loading
Google's player into the same window that shows a balance, so it ships with three
mitigations rather than as a plain embed:

- privacy-enhanced `youtube-nocookie.com` embed rather than the standard one
- click-to-load — the grid shows a still frame; nothing from Google is fetched
  until the user actually clicks play, so browsing the store contacts nobody
- the player lives in its own sandboxed frame, and the CSP exception is written
  narrowly for YouTube's hosts only, not opened generally

Residual risk after that: Google can see that a DD69 user watched a given video.
It cannot see the wallet, and it has no path to it. Accepted.

Media is hosted on Cloudflare R2 or Supabase Storage, **not Arweave**. Arweave is
permanent, and a store needs the ability to take content down.

### Running an app

Click a card, the app opens in the main panel. Under the hood it is a sandboxed
frame with a locked-down policy, loading a signed bundle. The bundle is verified
against our signing key before it renders — DD69 will refuse to run anything we
did not sign, which also gives us instant revocation.

**Immersive mode (required).** An app must be able to take over the whole DD69
window when it needs the room: the left sidebar collapses to a thin strip or off
the edge, the header panel collapses upward, and the app fills the space. A
manifest field declares whether the app wants immersive by default or on demand,
and an always-present escape control returns the user to the wallet. The chrome
animates rather than snapping, matching how the admin drawer already behaves.

This is a layout question, not an isolation one — the app is still the same
sandboxed frame with the same brokered API, just sized to the window. Worth being
explicit about, because it is the reason the app runs as a frame inside the main
window rather than as its own separate operating-system window: a separate window
could not "take over DD69", it would just be a second window floating next to it.

### Deliverables

- New `ui/src/apps/` module: browse grid, media card, app host frame, permission
  prompt, per-app storage, the broker
- A published **app manifest** format (name, version, permissions, media, price)
- CSP added to `crates/app/tauri.conf.json` and verified against the existing app
- Bundle signature verification in Rust
- Two first-party demo apps written by us, to prove the surface is actually usable

---

## 4. Piece 2 — the Builder

### How it works from the developer's side

A new panel: chat on the left, live preview on the right, a model dropdown, a
DIVI credit balance, and a running token meter. They describe what they want,
Claude writes the files, the preview reloads, they iterate. When happy, they hit
Publish, which sends it to review.

### Where the AI actually runs

**Not on the user's machine.** The API key cannot live in a desktop app — the same
reason the existing `ui/src/admin/panels/AiPanel.tsx` already warns about — and we
are not running an autonomous code-writing agent on a machine that holds someone's
wallet and node.

**Decided: our own sandbox, with the model swappable.** Geoff's requirement is
Anthropic first, other models later without a rewrite. That requirement is what
picks the architecture, and it reverses my initial recommendation:

- Anthropic's **Managed Agents** would have been faster to stand up — Anthropic
  hosts the container *and* runs the agent loop, with isolation and token metering
  included. But the loop and the sandbox come as one package, and the loop is
  Anthropic-specific. Adding Grok or a self-hosted model later would mean building
  an entirely separate path, not swapping an adapter. That is the opposite of plug
  and play.
- So: **we run the container, and the model is one call behind an adapter.** The
  agent loop (read files, write files, run the build, look at the result, iterate)
  is ours. Each model call goes through the **existing DD69 AI Gateway** at
  `ai.divi.love`, which is already provider-pluggable by design — Claude and any
  OpenAI-shaped provider, including self-hosted models, are a JSON entry plus a
  key with no code change. Adding a model to the builder's dropdown becomes the
  same one-line operation it already is for the wallet's agent.

Cost of that choice, stated plainly: we own the container hardening, scaling, and
the usage plumbing that Managed Agents would have handed us. It is a slower Phase 2.
It is the right trade given the requirement.

**One honest caveat on "plug and play."** The plumbing genuinely becomes
model-agnostic. The *results* will not be equal. Agentic code writing leans hard on
tool-calling reliability and long-context behaviour, and models differ a lot there.
Expect to keep a short list of models we have actually tested for building, rather
than exposing every provider in the gateway.

### The sandbox itself

One throwaway container per build session, holding nothing but that developer's
project folder:

- No Divi node, no wallet, no keys, no access to our infrastructure
- Network egress denied by default, with a small documentation allowlist
- One session cannot see another session's files
- Torn down at the end; nothing persists except the project we deliberately keep
- Every model call's token counts recorded as they happen — the number billing
  runs on

### What Claude is allowed to do in there

Write files into one project folder. That's essentially it. No shell escapes to
our systems, no network beyond a documentation allowlist, no ability to touch
another project. Even a fully jailbroken prompt produces, at worst, a bad app —
which then has to get past the code gate and the review queue.

### Models and cost

Current Anthropic list prices, per million tokens:

| Model | Input | Output | Use |
|---|---|---|---|
| Claude Opus 5 | $5 | $25 | "Hard mode" — complex apps, premium tier |
| Claude Sonnet 5 | $3 (intro $2 to 2026-Aug-31) | $15 (intro $10) | Default builder model |
| Claude Haiku 4.5 | $1 | $5 | Prompt scanner, cheap classification |

Prompt caching cuts the repeated part of every request to about a tenth of list
price, which matters a lot here because every turn re-sends the same system prompt
and project context. Building the prompt so it caches properly is the single
biggest lever on our margin.

---

## 5. Piece 3 — the gates, and the admin panel

### Layer 1: prompt scanner (input)

Every developer message is checked before it reaches the builder:

- Fast rule pass — editable patterns for known jailbreak shapes ("ignore previous
  instructions", "you are now", encoded payloads, prompts about our infrastructure,
  keys, node internals, or other users)
- Classifier pass — a cheap Haiku call that judges intent, not keywords, and
  returns allow / flag / block with a reason
- Account state — strike count, rate limit, cooling-off after repeated blocks

Every decision is logged with the prompt, verdict, reason, and cost.

### Layer 2: code gate (output)

Before a build can be previewed, and again, harder, before it can be published:

- Structural scan of the generated JavaScript — no `eval`, no dynamic imports, no
  attempts to reach the wallet bridge, no obfuscated or minified blobs, no network
  calls to hosts outside the declared manifest, no oversized bundles
- Permission reconciliation — the code may not use any capability the manifest did
  not declare and the user did not approve
- Reviewer pass — a second model reads the diff adversarially and answers "is this
  app trying to do something it did not tell the user about?"
- Publish-only: human eyes. Curated launch, opened up later once we trust the gate.

### Layer 3: the admin panel (yours)

Added to `ui/src/admin/registry.tsx`, alongside Style / Value / AI / Payouts / Chain.

- **Rules** — edit the prompt-scanner patterns and thresholds live; edit the
  code-gate rules; toggle individual checks on and off
- **Decision log** — every scan, its verdict, the prompt, the cost, sortable and
  filterable. This is how you actually learn what real attackers try.
- **Replay** — re-run the whole historical log against your edited rules and see
  what changes before you save. Turns rule tuning from guesswork into measurement.
- **Review queue** — pending publishes, with the diff, the manifest, the requested
  permissions, and the reviewer model's opinion. Approve, reject, or ban.
- **Kill switch** — revoke a published app or an entire developer account. Because
  bundles are signed and DD69 checks the signature, revocation is immediate for
  every user, not just new installs.

---

## 6. Money

### Developers pay for tokens (2x markup)

**Prepaid credits only.** Anthropic bills us as tokens are spent; a runaway agent
loop could burn real money in minutes. So:

1. Developer sends DIVI to a builder-credit address
2. Confirmed deposit becomes a credit balance
3. Before each turn, we reserve an estimated cost; if the balance cannot cover it,
   the turn is refused with a clear message
4. After the turn, the real token counts come back on the usage event, we charge
   twice our cost, and refund the unused reservation
5. Hard ceilings: per turn, per session, per day

**The DIVI/USD rate must be a number you set in the admin panel, not a live feed.**
The wallet's own honesty rules already record that price aggregators disagree by
about 4.5x on DIVI because they track different illiquid venues. Billing off that
would be indefensible. A fixed, visible, admin-set rate with a change log is the
only defensible option, and we should show developers the rate before they spend.

The token meter should be visible in the builder at all times, in DIVI, updating
per turn. No surprise bills.

**Rejected builds are charged at half.** Geoff's call, and the right balance: if
the code gate rejects what the model produced, the tokens were still spent, so the
developer pays 50% of the normal charge. Honest mistakes are cheap; deliberately
probing the gate over and over is not free. The builder must say this up front,
before the first turn, not in a footnote.

### Developers charge users

Two models, both routed through the same permission-gated payment flow:

- **Buy to own** — one-time DIVI purchase, unlocks the app permanently
- **Pay inside the app** — the app requests a payment, the wallet confirms it

Revenue splits to the creator's address minus a platform fee, using the treasury
and fee infrastructure already built for the NFD marketplace. Entitlements are
verified server-side and signed, never trusted from the app's own claim.

---

## 7. Phases

Each phase ends in something testable. Nothing after Phase 1 can start before the
CSP work is done and verified.

| Phase | What lands | Gate to move on |
|---|---|---|
| **0** | CSP added and the existing wallet verified unbroken; manifest + permission catalogue written down | Wallet works identically with CSP on |
| **1** | Community Apps panel, sandboxed app host, immersive mode, broker with read-only permissions, two demo apps by us | A demo app runs full-window and provably cannot reach the wallet bridge |
| **2** | Build containers, our agent loop, model adapter through the AI gateway, builder panel with live preview. Internal only, free, no publish | We can build a working app by chat, and switching the model is a config change |
| **3** | Prompt scanner, code gate, admin panel with rules + log + replay | Adversarial test set: our own jailbreak attempts get blocked and logged |
| **4** | DIVI credits, metering, 2x markup, caps, admin rate control | A paid build session bills correctly to the token |
| **5** | Publish flow, signing, review queue, media upload (3:2 WebP / slideshow / video / link), revocation | An outside developer can ship an app end to end |
| **6** | Paid apps, in-app payments, creator payouts | Money moves both directions correctly |
| **7** | Deeper integrations: DMT, NFD, map as richer permissioned APIs | — |

---

## 8. Decisions

### Made (2026-Jul-26)

1. **Build host** — our own sandbox containers, with the model behind an adapter
   routed through the existing pluggable AI gateway. Anthropic first; other models
   are a config entry, not a rewrite. This replaced the Managed Agents
   recommendation; reasoning in section 4.
2. **App runtime** — sandboxed frame inside the main window, with an immersive
   mode that collapses the sidebar and header so an app can use the whole window.
3. **YouTube** — embedded player, with nocookie, click-to-load, and a narrow CSP
   exception. Section 3.
4. **Rejected builds** — developer pays half. Section 6.

5. **Identity = sign with your Divi address.** No login, no password, no LW-SSO
   dependency. The wallet signs a challenge with an address the user controls;
   that address *is* the developer account, the credit balance, the app-ownership
   record, and the payout destination. The NFD work already proved Divi's
   `signmessage` is deterministic and safe to build on. **This takes LW-SSO off
   the critical path entirely** — the single biggest schedule win in this plan.
6. **Build containers run on Cloudflare.** Geoff's existing account
   (`de32ea1587de2e94e24fab49a21d436c`, geoff@lightningworks.io) already holds
   `containers` and `cloudchamber` write scopes, so we can provision the sandbox
   with no new vendor, no new machine, and nothing for Geoff to set up. Nothing
   runs on his laptop, and nothing goes near `109.228.38.104` (which runs `divid`,
   the scan proxy and the AI gateway).
7. **Styling: nothing hard-coded, ever.** Every colour, font, radius, blur and
   glow in the new panels comes from `ui/src/theme/tokens.ts`, and every icon from
   `ui/src/icons.ts` through `ui/src/Icon.tsx`. New surfaces get their own token
   group so they appear in the Style editor and can be reskinned and sold like the
   rest. No inline hex, no literal font names, no bespoke SVG in components.

### Still open

8. **Launch posture** — curated (we approve every app by hand at first) or open
   with automated gating from day one? Recommendation: curated, same as the NFD
   marketplace plan. Can be decided as late as Phase 5.
9. **The DIVI/USD billing rate** — the number itself, and how often you revise it.
   Needed before Phase 4, not before.
10. **The seed apps.** Geoff writes these when the time comes. Phase 1 therefore
    proves itself with a throwaway internal test harness instead (section 11), so
    the runtime is never blocked waiting on content.
11. **Media hosting needs one small action from Geoff.** The Cloudflare token
    currently has no `r2` scope, so object storage for app thumbnails and videos
    is not reachable yet. Either re-run `wrangler login` to add it, or we use the
    existing Supabase project's storage instead. Only needed by Phase 5.

---

## 9. Dependencies and known holes

- **No user accounts in DD69 yet.** Credits, entitlements, and per-developer rate
  limits all need identity. LW-SSO is specced but not wired into the wallet. This
  is on the critical path for Phase 4 onward.
- **The AI gateway is still single-shared-token.** `project_dd69_ai_gateway` notes
  it cannot ship to all users as-is. The builder needs per-user tokens — that is
  the same Phase 2 gateway work, and this feature depends on it.
- **DMT is specced, not implemented.** The token API surface can exist and be
  documented now, but it returns stub data until the DMT indexer lands.
- **NFD lives on `feat/nfd-collectibles`, not main.** Collectible-facing APIs need
  that branch merged first.
- **We own the container hardening.** That is the price of the plug-and-play model
  requirement — nobody hands us the isolation for free. It needs a dedicated
  machine, a locked-down image, egress rules, and a teardown that actually tears
  down. This is the largest single unknown in Phase 2 and the one most likely to
  slip.
- **Cost of a build session is genuinely unknown** until we run real ones. Agentic
  coding burns tokens fast. Phase 2 must produce real measurements before Phase 4
  sets prices.
- **Legal.** A store that takes money and hosts third-party code is a different
  animal from a wallet. Worth a look before launch, not before building.

---

## 10. Action plan — the first four work blocks

Written as work blocks rather than dates. Each ends in something Geoff can look at
or click, and each is safe to stop after.

### Block A — make the wallet safe to host other people's code

*Nothing else can start before this. Needs nothing from Geoff.*

1. Inventory what the current UI actually loads — every image, font, style and
   script origin — so the policy is written from evidence, not guesswork.
2. Add a content security policy to `crates/app/tauri.conf.json`, starting strict
   and relaxing only where the inventory proves it is needed.
3. Rebuild and walk the whole wallet: overview, send, receive, history, network
   map, collectibles, tokens, agent, address book, settings, admin drawer, sounds,
   skins. Anything the policy breaks gets fixed properly, not by widening the rule.
4. Add the narrow YouTube exception, and confirm it does not widen anything else.
5. Add a regression note so a future change cannot quietly drop the policy.

**Done when:** the wallet behaves identically with the policy on, and Geoff has
run his own normal session against the build without noticing a difference.

### Block A — STATUS: policy shipped, awaiting Geoff's normal-use pass

Shipped in commit `b8cae5a`. The policy now in `crates/app/tauri.conf.json`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:;
connect-src 'self' ipc: http://ipc.localhost https://nodes.divi.love;
frame-src 'none'; worker-src 'none'; object-src 'none';
base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

**What the inventory found:**

- The whole front end builds to **one 3.6 MB inline script** in a single HTML
  file (`vite-plugin-singlefile`). No external scripts, no CDN, no web fonts.
- No web workers, no WebAssembly. `worker-src 'none'` is therefore free.
- Images and media come from `data:` and `blob:` URIs only.
- The only network call made by the front end itself is to `nodes.divi.love`
  (the identity service, not yet deployed). Everything else — price, geolocation,
  the AI gateway, the explorer — is called from Rust or opened in the real
  browser, so it never touches the page's policy.

**Why an inline bundle still works under `script-src 'self'`:** Tauri hashes every
non-empty inline script at build time and injects the hash into the policy — but
only when a policy is configured, which it was not before. Verified by computing
the SHA-256 of the shipped script and matching it against the hash compiled into
the binary.

**Why `style-src` keeps `'unsafe-inline'`:** React style attributes and the theme
system both write inline styles, and hashes cannot cover style *attributes*. Tauri
is told not to modify `style-src`, because adding a nonce there would make the
browser ignore `'unsafe-inline'` and break every themed surface. Scripts — the
part that actually matters — stay strict.

**Verified working with the policy on:** the 3D globe, live block stream, balances,
staking status, lottery countdown, price, peer and node counts, address list.

**Still to confirm, by Geoff using it normally:** send, receive and the QR code,
proof of existence, collectibles, tokens, governance, human-readable addresses,
address book, settings, the admin drawer and skins, and the agent panel's video.
These are expected to pass — they rely on `data:`/`blob:`, which the policy allows
— but expected is not verified.

**Deliberately deferred to Block B:** `frame-src` stays `'none'` until there is
something to frame. It gets exactly two entries later: the app sandbox, and
YouTube's nocookie host.

### Block B — the runtime and the store panel

*Needs nothing from Geoff except a look at the result.*

1. Write the app manifest format and the permission catalogue down as a document
   in the repo first, so the API is designed once rather than accreted.
2. Build the broker: the only channel between an app and the wallet. Read-only
   permissions to begin with — balance, addresses, history — with a hard deny on
   everything else and a log of every call.
3. Build the sandboxed host frame, immersive mode included: sidebar collapses,
   header collapses, escape control always visible, animated to match the existing
   admin drawer.
4. Build the Community Apps browse panel: 3:2 cards, still image, slideshow,
   video, click-to-load YouTube. New token group so all of it is skinnable.
5. Write a throwaway internal test harness app whose only job is to try to break
   out — reach the Tauri bridge, call an undeclared permission, read another app's
   storage, phone home to a host it never declared. All of it must fail, visibly.
6. Add bundle signature verification in Rust so DD69 refuses to run anything we
   did not sign.

**Done when:** the harness app runs full-window, every escape attempt fails, and
the panel is reskinnable from the Style editor.

### Block C — the builder

*Needs the Cloudflare account, which we already have.*

1. Stand up one sandbox container on Cloudflare and prove the basics: a session
   starts, writes files, builds, tears down, and cannot reach the network except
   where we allow it.
2. Build the agent loop — ours, not a vendor's — with the model call behind an
   adapter pointed at the existing `ai.divi.love` gateway. Claude first; adding
   another model must be a config entry, and we test that claim before calling the
   block done.
3. Wire the builder panel: chat, live preview, model dropdown, token meter. Styled
   from tokens like everything else.
4. Measure real sessions. Build three or four apps of genuinely different sizes
   and record what they actually cost. **This is the number Phase 4 pricing
   depends on, and we currently do not have it.**

**Done when:** we can build a working community app by chatting, and we know what
a session costs to within a sensible range.

### Block D — identity, gates and money

1. Address-signature login: challenge, signature, session. The wallet side is
   small because the signing already exists.
2. Prompt scanner and code gate, plus the admin panel with the rules editor,
   decision log and replay.
3. Build an adversarial test set — our own honest attempts to jailbreak it — and
   tune against that, not against imagination.
4. DIVI credits: deposit, reserve, charge at 2x, half-charge on gate rejection,
   refund the difference, hard caps, admin-set rate.

**Done when:** an outside developer can fund an account, build an app, get billed
correctly, and get stopped when they try something they should not.

### What Geoff does, and when

| When | What |
|---|---|
| Now | Say go |
| End of Block A | Use the build normally for a day; tell me if anything feels off |
| End of Block B | Look at the store panel and the immersive mode; redirect the look if it's wrong |
| End of Block C | Read the real cost numbers, then set the DIVI/USD rate |
| Before Block D ships | Decide curated vs open launch |
| Before Phase 5 | Either re-run `wrangler login` for storage access, or say use Supabase |
| Whenever | Write the seed apps |

---

## 11. What this touches in the repo

New, so no collision with the other agents:

- `ui/src/apps/` — runtime, browse grid, host frame, broker, permission UI
- `ui/src/builder/` — chat panel, preview, credit meter
- `ui/src/admin/panels/GatesPanel.tsx` — the tuning panel
- `crates/supervisor/src/appstore.rs` — signature verification, manifest parsing
- `contrib/app-builder/` — the server side: sessions, scanning, metering, review

Shared seams that need care (fetch and rebase before touching):

- `ui/src/nav.ts`, `ui/src/Shell.tsx` — one line each
- `ui/src/admin/registry.tsx` — one line
- `crates/app/src/main.rs` — command registrations
- `crates/app/tauri.conf.json` — the CSP change, which affects everything
