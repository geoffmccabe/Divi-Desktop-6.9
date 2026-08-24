# Divi app builder

The service behind the Community Apps builder: a developer describes an app, a
model writes it, and the developer pays for the tokens in DIVI.

Scope and decisions: `docs/COMMUNITY-APPS-SCOPE.md`.
The contract the generated app must satisfy: `docs/COMMUNITY-APPS-MANIFEST.md`.

**Not ready for anyone outside the team.** The prompt scanner, the code gate and
container isolation do not exist yet, so it binds to loopback and stays there.

## Zero dependencies, on purpose

Node's own http server, fetch, crypto and test runner. Nothing from npm.

This service takes untrusted input and spends real money, so every package added
is another thing that has to be trusted for the lifetime of the product. Given
the postcss incident, the cost of writing a little more code is worth paying.

## Running it

```
DIVI_PER_USD=1000 DIVI_TREASURY_ADDRESS=D... ANTHROPIC_API_KEY=sk-ant-... node src/server.mjs
```

| Variable | Meaning |
|---|---|
| `DIVI_PER_USD` | **Required.** How many DIVI to one dollar. Admin-set, never a live feed. Without it, sessions are refused. |
| `DIVI_TREASURY_ADDRESS` | **Required to sell points.** The address buyers pay into. Points are only ever credited from payments to this address. |
| `BUILDER_LEDGER` | The append-only points ledger. Defaults to a file under `BUILDER_ROOT`. This is where balances live. |
| `DIVI_DATADIR` | Where `divi.conf` is, so payments can be checked with the node. Defaults to the platform location the wallet uses. |
| `BUILDER_ALLOWED_ORIGINS` | Extra origins allowed to call this, comma separated. The wallet's own origins are always allowed. |
| `ANTHROPIC_API_KEY` | Key for the default provider. |
| `BUILDER_MODEL` | Default `claude-sonnet-5`. `claude-opus-5` for harder work. |
| `BUILDER_PROVIDER` | `anthropic` or `openai`. |
| `BUILDER_BASE_URL` | For an OpenAI-shaped provider (Grok, or a self-hosted model). |
| `BUILDER_ROOT` | Where session projects live. |
| `PORT`, `HOST` | Default `8788` on `127.0.0.1`. |

Tests: `node --test test/`

### The door is not open

Every request carrying an origin we do not know is refused. A browser will send
a request to this machine even though it cannot read the reply, so without that
check any web page you happened to have open could create sessions, spend on the
model, or switch screening off.

## Why the DIVI rate is not a live feed

Price aggregators disagree by roughly 4.5x on DIVI because they track different
illiquid venues. Billing off a feed would mean a developer's cost changing several
fold based on which thin market moved. An admin sets the number, it is visible
before anyone spends, and changes are deliberate.

## Why this does not go through ai.divi.love

The wallet's AI gateway is a text proxy: messages in, a string out. That is right
for the wallet's chat agent, and it exists so a desktop app never holds a key.

An agent that writes files is nothing but tool calls, and the gateway's shape
cannot carry them. So the builder holds its own credentials, which is safe for the
same reason the gateway exists: this is a server, not a desktop app, so the key is
not extractable by users.

Model choice stays swappable regardless. `src/provider.mjs` normalises every
provider to one shape, and adding one is an adapter plus a key. If we later want
everything routed through the gateway, the gateway needs a pass-through endpoint
that preserves tool calls.

## How the money works

Developers buy **points** with DIVI up front, and steps are charged in points.
Full detail in `docs/POINTS-AND-BUYING.md`; the short version:

1. **The balance is ours.** It lives in an append-only ledger here and nowhere
   else. An earlier version took it from the request, which meant anyone could
   declare themselves rich.
2. **Work out the worst case first.** Before a step runs we price the most it
   could possibly cost, hold that, and refuse to start if the balance will not
   cover it. The same ceiling is sent to the model as a hard output limit, so it
   is a real bound rather than a guess.
3. **Refuse an unpriced model before the call**, not after. Calling first and
   failing to bill afterwards means we pay and the developer does not.
4. **Settle** against the token counts the API actually reports. Never an
   estimate: drift in our favour is indistinguishable from overcharging.
5. Ceilings per step and per session, on top of the balance.

Developers pay twice our cost. A build the code gate rejects is charged at half.

Sonnet's introductory rate has an expiry date encoded, so the discount cannot
quietly become permanent in our pricing after it ends.

## Why the tools are so few

`write_file`, `read_file`, `list_files`, `delete_file`. No shell, no network, no
path outside the project.

This is the actual security boundary. Prompt filtering is worth having and is
coming, but anyone determined enough will eventually talk a model into writing
something we did not intend. What contains that is the model having nothing
dangerous to reach: a jailbroken prompt produces a badly written app, which then
still has to pass the code gate and review.

A test asserts the tool list contains nothing matching shell, exec, bash, fetch,
http or network, so widening it is a deliberate act rather than a quiet one.

## What is missing

- Identity. Sessions are opaque ids; binding them to a Divi address signature is
  next.
- The prompt scanner and code gate.
- Container isolation. The workspace is path-safe but shares the host.
- A live preview endpoint.
- Real cost measurements. Nothing here has run against a paid model yet, so the
  price of a session is still unknown and must be measured before any price is
  set.
