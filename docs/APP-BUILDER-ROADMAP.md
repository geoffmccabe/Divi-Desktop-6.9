# App Builder: what works, what is missing, and the order to do it in

Written 2026-Aug-24, after taking the whole thing apart and running it end to
end with a stand-in model so nothing real was spent.

---

## Part 1 — What I found, and fixed today

Five things were wrong. Three of them would have hit you on your first build.

### 1. Projects were thrown away

A build lived in memory, in a folder under the system temp directory. Closing
the wallet lost it; leaving it a few days meant the operating system cleared it
out. Somebody who spent points building an app would simply lose the app.

Now: a project is a folder on disk, saved after every message, with its files
**and its conversation**. Restart, come back next week, it is where you left it.
There is a list of your apps, you can name them, reopen them and delete them.
Proven by restarting the service mid-build and finding everything intact.

### 2. A new project started empty, which produced a broken first app

I ran the real loop with a stand-in model. Asked to "make a page showing my
balance" from an empty folder, it wrote a page that loads `sdk.js` — because
every example works that way — and there was no `sdk.js`. It also never wrote a
manifest. The result could not run and could not be published.

That was not the model being careless. It was us handing it a blank folder.

Now: every project starts with `sdk.js`, a manifest that already parses, and a
page that already works. The first request changes something working instead of
creating something from nothing.

### 3. The code checker made every app unpublishable

It scanned `sdk.js`, which names every wallet method because it *defines* them.
So it concluded every app used everything and flagged ten violations on an app
that did nothing. It also read example calls in code comments as real calls.

Now: the SDK is skipped — but **only if it is byte-for-byte the file we ship**.
A modified SDK is a hard stop, because that is exactly where a hostile app would
put code to intercept what the wallet sends back. Comments are no longer read as
calls, and the security rules still read the whole file so nothing hides in one.

A brand new project now reports "nothing to flag", and correctly flags a real
problem the moment one appears.

### 4. Two copies of the SDK, already waiting to drift

The two built-in apps each carried their own copy. They were identical today,
which is how this always looks right before they are not.

Now: one canonical file, compiled into the wallet and copied into every new
project, with a test that fails if the wallet stops using it.

### 5. Styling and capabilities were left to the model to guess

Your requirement was that a developer should not have to think about either.

Now: every build request carries the wallet's full theme — every colour, font
and shape variable, with one blunt rule that a hex colour is forbidden because
it looks right today and wrong on every other skin. And it carries an exact list
of what the wallet can do, written from the permission table itself, plus a
"do not call these" list so the model does not write code around things that do
not exist. A test reads the wallet's own token file and fails if a variable is
added without being described, so the two cannot drift.

### Points are charged, and I watched it happen

Two steps of a real build: 4,000 tokens in, 900 out, on Sonnet. **68 points**,
which is 34 a step. That is $0.017 of cost, doubled, exactly as intended. The
balance moved, the ledger recorded it, and both survived a restart.

### Your $20

**20,000 points**, granted the first time your account is seen. $20 at what we
charge is 20,000 points regardless of the DIVI price — points are dollars of
build time, so no exchange rate is involved.

At 34 points a step and a dozen steps a message, a substantial message costs
roughly 200–400 points. **$20 is somewhere around 50 to 100 real build messages**
— an estimate from one measured step, not a measurement of a real session. The
number that matters will come from your first proper build.

⚠ That opening credit is set in `contrib/app-builder/start.sh` and applies to
**every new account**. It must be deleted before anyone else can reach the
service, or each new arrival gets $20.

---

## Part 2 — To build your first app

```
sh contrib/app-builder/start.sh
```

Leave it running. Then, in the wallet:

1. **Settings → Value tab**: put a CoinMarketCap key in and check it says
   "Key saved". Without it DIVI has no price, so nothing can be billed and the
   builder refuses to start a project. There is no fallback price source, by
   your standing order.
2. **App Builder**: paste your Anthropic key when asked. Once per service start,
   kept in memory only.
3. Name an app, describe it, watch it get built.

---

## Part 3 — What is still missing

Honest list, roughly in the order it hurts.

| Missing | Why it matters |
|---|---|
| **Live preview** | You cannot see what you are building. Every comparable tool shows the app running beside the chat, updating as it writes. This is the single biggest gap. |
| **Publishing** | A finished app cannot get into Community Apps. There is signing code and verification, but no path from "built" to "installed". |
| **The service does not start itself** | You have to run a command in a terminal. Fine for you today, impossible for anyone else. |
| **Payment does not move money** | An app can raise the confirmation and be told "paid" while nothing is sent. |
| **Only 10 things to hook into** | See Part 5. The wallet can do far more than apps can reach. |
| **No undo** | Nothing keeps versions. A bad instruction overwrites good work with no way back. |
| **No error feedback loop** | If the app throws, the model never hears about it. Other tools feed the error straight back. |
| **No templates** | Every app starts from the same blank page. A few starting points would save real money in tokens. |
| **Identity is taken at its word** | The account is your receiving address, unproven. Only acceptable while this listens on your machine alone. |

---

## Part 4 — The interface, next to comparable tools

What I looked at: Lovable, v0, Bolt, Replit Agent, Claude Artifacts. What they
all do that we do not:

1. **The app runs beside the chat.** Not a file list — the actual app. Missing.
2. **Errors go back to the model automatically.** When the preview throws, the
   tool feeds it back and offers to fix it. Missing.
3. **Every version is kept, and you can go back.** Missing, and the most
   frightening gap: right now one bad instruction can destroy an afternoon.
4. **Cost is shown before you commit**, not only after. We show what a step cost
   once it is spent. We should show what a message is likely to cost.
5. **Suggested next steps.** After a build they offer three things you might
   want next. Cheap to add, and it teaches people what is possible.
6. **A visible "publish" button** that is obvious from the first minute, so the
   goal is clear.

What we have that they mostly do not, and should keep:
- A real cost meter in a real currency, per step.
- A code check that explains itself in plain language.
- Styling that is simply correct without anyone thinking about it.
- Permissions stated up front, so a user knows what an app can see.

Smaller things worth doing: the file list should show a diff after each message
rather than just names; the chat should show which model is being used and let
you switch (Haiku for small edits would cut cost several fold); and a stopped
build should say what it cost before stopping.

---

## Part 5 — Things apps could hook into

The point of this list: a developer should never write code for something the
wallet already knows. Every item is a "nugget" — one call, no plumbing.

### Available today (10)

`divi.balance()` · `divi.addresses()` · `divi.history()` · `divi.staking()` ·
`divi.chain()` · `divi.network()` · `divi.storage` · `divi.requestPayment()` ·
`divi.copy()` · `divi.notify()`

### Already built in the wallet, needs only to be exposed — the cheap wins

| Call | What it gives | Already exists as |
|---|---|---|
| `divi.price()` | DIVI in USD and other currencies, from CoinMarketCap | `divi_prices` |
| `divi.names.resolve(name)` | "geoff.divi" → an address | `hra_resolve` |
| `divi.names.reverse(addr)` | an address → the name it publishes | `hra_reverse` |
| `divi.names.market()` | names for sale, and what a name would cost | `hra_market`, `hra_quote` |
| `divi.address.validate(a)` | is this a real Divi address | `validate_address` |
| `divi.address.balance(a)` | the balance of any public address | `address_balance` |
| `divi.address.qr(a)` | a QR code for an address | `address_qr` |
| `divi.tx.status(txid)` | is that payment confirmed yet | `tx_status` |
| `divi.lottery()` | lottery timing, the board, past winners | `lottery_info`, `lottery_board` |
| `divi.nodes()` | the node map: who is where, heights, pings | `list_nodes`, `geolocate_ips`, `ping_nodes` |
| `divi.mempool()` | what is waiting to confirm | `mempool_snapshot` |
| `divi.maturity()` | when staked coins become spendable | `coin_maturity` |
| `divi.poe.stamp(hash)` | put a fingerprint of a file on the chain | `poe_timestamp` |
| `divi.poe.verify(hash)` | prove when something existed | `poe_verify` |
| `divi.payreq.create()` | make a payment request others can pay | `payment_request_create` |
| `divi.payreq.inbox()` | requests sent to you | `payment_requests_inbox` |

Sixteen capabilities for roughly a line of plumbing each. This is the highest
value-per-hour work in the whole project.

### Built, but needs a confirmation step before an app can touch it

| Call | What it gives | Care needed |
|---|---|---|
| `divi.send.request(to, amount, reason)` | a real send | The wallet draws the confirmation. This is what makes paid apps real. |
| `divi.sign(message)` | prove you own an address | Powerful: an app could log a user into a website with it. Per-request confirmation, and never silent. |
| `divi.escrow.*` | locked payments that release on a secret or refund on a timer | The HTLC path is proven. Trades, bets, "pay on delivery". |
| `divi.bearer.*` | a claimable DIVI voucher | Gift cards, giveaways, prizes. |

### Not built yet — do not promise these

- **Divi Meta Tokens.** The panel shows placeholder data; there is no index.
- **Divi Collectibles (NFDs).** The panel is a description, not a feature.
- **The DIVA EVM bridge.** Phase 1 exists on a branch, not in the wallet.
- **Governance.**

### Needs brokered internet, which is off for every app

- Calls to hosts an app declares, logged and rate limited.
- Divi Love Scan queries: rich address and block history.
- **The AI gateway.** `ai.divi.love` already proxies Claude and Grok. Letting an
  app call a model, paid for in the same points, would mean people building AI
  apps on Divi without holding a key. That is a product in itself.

---

## Part 6 — The same app in the browser, on divi.love

This works, and it is less effort than it sounds, because of a decision already
made: an app talks to its host through one message channel and nothing else. It
never touches the wallet directly.

So a page on divi.love can host the same app by answering the same messages.
What changes is only **what the host can answer**:

| | In DD69 | On divi.love |
|---|---|---|
| Price, chain, blocks, node map, names, mempool | Yes | Yes — from the London node's read-only lookup and CoinMarketCap |
| Balance, addresses, history, staking | Yes | Only if a wallet is connected |
| Payment, signing | Yes, with your confirmation | Only with a connected wallet |
| Storage | Yes | Yes, in the browser |

An app declares what it needs in its manifest, which already exists. The browser
host grants the public subset and refuses the rest with a clear message, and
`divi.host()` tells an app where it is running so it can adapt rather than break.

The prize: an app built in DD69 gets a public link anybody can open. That is how
people show each other what they made, and it is the cheapest marketing this
feature will ever have.

---

## Part 7 — The order to do it in

Each phase ends in something you can actually use.

### Phase 1 — Build the first app *(you, now)*
Add the two keys, run the start script, build something. What we learn: what a
real session costs, and where the model gets confused.

### Phase 2 — See what you are building
Live preview beside the chat, running the app from the project folder through
the same sandbox as a real community app — so what you see is what a user gets.
Runtime errors fed back to the model automatically. **Versions kept, with undo.**

*Done when: you can watch an app appear as it is written, and step back from a
bad instruction.*

### Phase 3 — Ship it
Package, sign, install, appear in Community Apps. The manifest, the signing and
the verification exist; the path between them does not. Also: the code check
must run and block before anything can be published, which it currently does not.

*Done when: an app you built is running in Community Apps like any other.*

### Phase 4 — The cheap wins
The sixteen capabilities in Part 5, and a handful of templates that use them.
Both directly reduce what a build costs, because the model stops writing code
for things we already have.

*Done when: "show me the DIVI price and my staking rewards" is a two-line app.*

### Phase 5 — Money that moves
Real sends behind the wallet's confirmation, so `requestPayment` stops being a
dialog that does nothing. Then buying an app, and charging inside one, with the
creator paid and a platform fee taken.

*Done when: someone can sell an app and be paid for it.*

### Phase 6 — The browser
The divi.love host, the public subset of capabilities, and a share link.

*Done when: an app you built opens for anybody with a link.*

### Phase 7 — Open the doors
Hosted build sandboxes rather than your laptop; identity proven by signing with
a Divi address, which also fixes the strike counter and the balance being taken
at its word; per-account rate limits; the review queue; and **turning off that
$20 opening credit**.

*Done when: a stranger can fund an account, build an app, get billed correctly,
and be stopped when they try something they should not.*

### Phase 8 — Apps that use AI
Brokered internet, then the AI gateway exposed to apps and paid in points.

---

## The two judgement calls I would want from you

1. **Preview before publishing, or publishing before preview?** I would do
   preview first — building blind is the thing most likely to make you give up
   on it, and it is also what makes the cost worth paying.
2. **How much of Part 5 before Phase 3?** Sixteen capabilities is maybe a day.
   Doing them early makes every app built afterwards cheaper and better, and
   makes the first published apps look far less thin.
