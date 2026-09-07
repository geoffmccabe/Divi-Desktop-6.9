// The ledger, and specifically the ways it could be made to pay twice.
//
// Every test here is about money leaving. The happy path is one line of it; the
// rest is what happens when a claim is repeated, raced, abandoned, or arrives
// from somewhere it should not have been able to arrive from.
//
// Run: sh scripts/run-rebels-ledger-tests.sh

import { RebelsLedger, MIN_CLAIM } from "../src/ledger";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const SECRET = "a-test-secret";

function newLedger() {
  const map = new Map<string, unknown>();
  const state = {
    storage: {
      async get(k: string) { return map.get(k); },
      async put(k: string, v: unknown) { map.set(k, v); },
      async list({ prefix }: { prefix: string }) {
        const m = new Map<string, unknown>();
        for (const [k, v] of map) if (k.startsWith(prefix)) m.set(k, v);
        return m;
      },
    },
  } as never;
  return { led: new RebelsLedger(state, { PAYOUT_SECRET: SECRET } as never), map };
}

const auth = { Authorization: `Bearer ${SECRET}` };
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`https://rebels.test/ledger/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`https://rebels.test/ledger/${path}`, { headers });
/* What a room's call looks like: over the binding, to a host that does not
   resolve anywhere. */
const internal = (path: string, body: unknown) =>
  new Request(`https://ledger/${path}`, { method: "POST", body: JSON.stringify(body) });

const j = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

async function main() {
  // 1. A room's credit lands; the same call off the internet does not.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n1", name: "Node One", kills: 500, divi: 50, score: 4000 }));
    const bal = await j(await led.fetch(get("balance?node=n1")));
    ok("a room can credit an account", bal.kills === 500 && bal.divi === 50, JSON.stringify(bal));

    /* THE HOLE: the same body, posted at the public hostname. */
    const outside = await led.fetch(
      new Request("https://divi-rebels-room.workers.dev/ledger/credit",
        { method: "POST", headers: auth, body: JSON.stringify({ node: "n1", divi: 999999 }) }),
    );
    ok("the same credit off the internet is refused", outside.status === 404, `${outside.status}`);
    const after = await j(await led.fetch(get("balance?node=n1")));
    ok("and the balance is untouched", after.divi === 50, `${after.divi}`);
  }

  // 2. Nothing under the minimum can be claimed, however long it sits there.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n2", divi: MIN_CLAIM - 1, kills: 990 }));
    const r = await j(await led.fetch(post("reserve", { node: "n2" })));
    ok("under the minimum is refused", r.ok === false && r.amount === 0, String(r.why));
    await led.fetch(internal("credit", { node: "n2", divi: 1 }));
    const r2 = await j(await led.fetch(post("reserve", { node: "n2" })));
    ok("and the very next DIVI unlocks it", r2.ok === true && r2.amount === MIN_CLAIM, `${r2.amount}`);
  }

  // 3. THE ONE THAT MATTERS: a claim cannot be taken twice.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n3", divi: 250 }));

    const first = await j(await led.fetch(post("reserve", { node: "n3", ref: "r1" })));
    ok("a claim reserves the whole balance", first.ok === true && first.amount === 250, `${first.amount}`);

    /* Asked again while the first is still in flight — the shape of both an
       impatient player double-clicking and a deliberate race. */
    const second = await j(await led.fetch(post("reserve", { node: "n3", ref: "r2" })));
    ok("a second claim while one is in flight is refused", second.ok === false, String(second.why));

    const bal = await j(await led.fetch(get("balance?node=n3")));
    ok("and the balance is already gone, before a coin has moved",
       bal.divi === 0 && bal.reserved === 250, JSON.stringify(bal));

    await led.fetch(post("confirm", { node: "n3", ref: "r1", txid: "abc" }));
    const done = await j(await led.fetch(get("balance?node=n3")));
    ok("confirming turns the hold into a payment", done.paid === 250 && done.divi === 0, JSON.stringify(done));

    /* Replaying the confirmation, which is what a retrying payout service does. */
    const replay = await j(await led.fetch(post("confirm", { node: "n3", ref: "r1", txid: "abc" })));
    ok("a replayed confirmation pays nothing more", replay.ok === false, String(replay.why));
    const after = await j(await led.fetch(get("balance?node=n3")));
    ok("and the total paid does not move", after.paid === 250, `${after.paid}`);
  }

  // 4. A send that fails gives the player their balance back.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n4", divi: 300 }));
    await led.fetch(post("reserve", { node: "n4", ref: "r9" }));
    const mid = await j(await led.fetch(get("balance?node=n4")));
    ok("the balance is held during the send", mid.divi === 0, `${mid.divi}`);

    await led.fetch(post("release", { node: "n4", ref: "r9" }));
    const back = await j(await led.fetch(get("balance?node=n4")));
    ok("a failed send returns it", back.divi === 300 && back.claimable === 300, JSON.stringify(back));
    ok("and nothing was recorded as paid", back.paid === 0, `${back.paid}`);

    /* Releasing twice must not conjure a second refund. */
    await led.fetch(post("release", { node: "n4", ref: "r9" }));
    const twice = await j(await led.fetch(get("balance?node=n4")));
    ok("releasing twice refunds once", twice.divi === 300, `${twice.divi}`);
  }

  // 5. Confirming a claim that was never reserved pays nothing.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n5", divi: 500 }));
    const r = await j(await led.fetch(post("confirm", { node: "n5", ref: "invented", txid: "x" })));
    ok("an invented claim reference is refused", r.ok === false, String(r.why));
    const bal = await j(await led.fetch(get("balance?node=n5")));
    ok("and nothing is marked paid", bal.paid === 0 && bal.divi === 500, JSON.stringify(bal));
  }

  // 6. Absurd credits are clamped rather than believed.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "n6", divi: 1e12, kills: 1e12, score: 1e12 }));
    const bal = await j(await led.fetch(get("balance?node=n6")));
    ok("a preposterous credit is clamped", (bal.divi as number) <= 100_000, `${bal.divi}`);
    await led.fetch(internal("credit", { node: "n6", divi: -5000 }));
    const neg = await j(await led.fetch(get("balance?node=n6")));
    ok("and a negative one cannot drain an account", neg.divi === bal.divi, `${neg.divi}`);
  }

  // 7. Every read needs the secret.
  {
    const { led } = newLedger();
    for (const path of ["balance?node=x", "top"]) {
      const r = await led.fetch(get(path, {}));
      ok(`${path} needs the secret`, r.status === 401, `${r.status}`);
    }
    const r = await led.fetch(post("reserve", { node: "x" }, {}));
    ok("and so does a claim", r.status === 401, `${r.status}`);
    const wrong = await led.fetch(get("top", { Authorization: "Bearer nearly-the-secret" }));
    ok("a wrong secret is refused", wrong.status === 401, `${wrong.status}`);
  }

  // 8. The table ranks by best single run, so one player cannot fill it.
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "a", name: "Alpha", score: 100 }));
    await led.fetch(internal("credit", { node: "a", name: "Alpha", score: 900 }));
    await led.fetch(internal("credit", { node: "b", name: "Beta", score: 500 }));
    const top = await j(await led.fetch(get("top")));
    const rows = top.rows as Array<{ name: string; best: number; games: number }>;
    ok("one row per node", rows.length === 2, `${rows.length} rows`);
    ok("ranked by the best single run", rows[0].name === "Alpha" && rows[0].best === 900,
       `${rows[0].name} ${rows[0].best}`);
    ok("with the games counted", rows[0].games === 2, `${rows[0].games}`);
  }

  console.log(out.join("\n"));
  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
