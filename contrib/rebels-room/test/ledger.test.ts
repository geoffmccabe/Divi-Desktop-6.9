// The ledger, and specifically the ways it could be made to pay twice.
//
// Every test here is about money leaving. The happy path is one line of it; the
// rest is what happens when a claim is repeated, raced, abandoned, or arrives
// from somewhere it should not have been able to arrive from.
//
// Run: sh scripts/run-rebels-ledger-tests.sh

import { RebelsLedger, MIN_CLAIM, ADDRESS } from "../src/ledger";

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
      async delete(k: string) { return map.delete(k); },
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
  /* ---------------------------------------------------- cashing out ----
     The player's half (over the binding) and London's half (with the secret),
     in the order they happen. */
  const GOOD = "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt";
  const GET_INTERNAL = (path: string) => new Request(`https://ledger/${path}`);
  {
    ok("the treasury address passes the shape check", ADDRESS.test(GOOD));
    ok("a short one does not", !ADDRESS.test("D8tjq"));
    ok("a zero in it does not (base58 has no zero)", !ADDRESS.test("D0tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt"));
    ok("an ethereum one does not", !ADDRESS.test("0x1234567890abcdef1234567890abcdef12345678"));
  }
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "c1", name: "Claimer", kills: 1500, divi: 150 }));

    /* Reading and asking are BINDING-ONLY, like credit. */
    const outsideRead = await led.fetch(get("purse?node=c1"));
    ok("a purse cannot be read off the internet, even with the secret", outsideRead.status === 404, `${outsideRead.status}`);
    const outsideAsk = await led.fetch(post("request", { node: "c1", to: GOOD }));
    ok("nor a cash-out requested from there", outsideAsk.status === 404, `${outsideAsk.status}`);

    const purse = await j(await led.fetch(GET_INTERNAL("purse?node=c1")));
    ok("a room can read the purse", purse.divi === 150 && purse.claimable === 150 && purse.pending === null,
       JSON.stringify(purse));

    const bad = await j(await led.fetch(internal("request", { node: "c1", to: "not-an-address" })));
    ok("a bad address is refused with a reason", typeof bad.why === "string" && bad.pending === null, `${bad.why}`);

    const asked = await j(await led.fetch(internal("request", { node: "c1", to: GOOD })));
    ok("a good one is written down", !asked.why && (asked.pending as any)?.to === GOOD
       && (asked.pending as any)?.amount === 150, JSON.stringify(asked));
    const again = await j(await led.fetch(internal("request", { node: "c1", to: GOOD })));
    ok("a second one waits for the first", typeof again.why === "string", `${again.why}`);

    /* London's round. */
    const noAuth = await led.fetch(get("pending", {}));
    ok("the pending list needs the secret", noAuth.status === 401, `${noAuth.status}`);
    const pending = await j(await led.fetch(get("pending")));
    const rows = pending.rows as any[];
    ok("London sees it", rows.length === 1 && rows[0].node === "c1" && rows[0].to === GOOD && rows[0].amount === 150,
       JSON.stringify(rows));

    const res = await j(await led.fetch(post("reserve", { node: "c1", ref: "r-1" })));
    ok("reserving hands London the claimed address", res.ok === true && res.to === GOOD && res.amount === 150,
       JSON.stringify(res));
    const mid = await j(await led.fetch(GET_INTERNAL("purse?node=c1")));
    ok("mid-send the purse still shows the money, as pending", mid.divi === 150
       && (mid.pending as any)?.amount === 150 && mid.claimable === 0, JSON.stringify(mid));
    const pend2 = await j(await led.fetch(get("pending")));
    ok("and it is not offered to London twice", (pend2.rows as any[]).length === 0);

    const conf = await j(await led.fetch(post("confirm", { node: "c1", ref: "r-1", txid: "tx-abc" })));
    ok("confirming pays it", conf.ok === true && conf.paid === 150, JSON.stringify(conf));
    const after = await j(await led.fetch(GET_INTERNAL("purse?node=c1")));
    ok("the request is closed and the receipt is there", after.pending === null
       && (after.last as any)?.txid === "tx-abc" && (after.last as any)?.amount === 150
       && (after.last as any)?.to === GOOD && after.divi === 0 && after.paid === 150,
       JSON.stringify(after));
  }
  {
    /* A send that FAILS: released, and the request survives for next round. */
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "c2", divi: 200, kills: 2000 }));
    await led.fetch(internal("request", { node: "c2", to: GOOD }));
    const res = await j(await led.fetch(post("reserve", { node: "c2", ref: "r-2" })));
    ok("reserved", res.ok === true);
    await led.fetch(post("release", { node: "c2", ref: "r-2" }));
    const p = await j(await led.fetch(GET_INTERNAL("purse?node=c2")));
    ok("released: the balance is back and the request still waits",
       p.divi === 200 && p.claimable === 200 && (p.pending as any)?.to === GOOD, JSON.stringify(p));
    const rows = (await j(await led.fetch(get("pending")))).rows as any[];
    ok("so London finds it again", rows.length === 1);

    /* A send London will NEVER make: dropped with a reason. */
    const res2 = await j(await led.fetch(post("reserve", { node: "c2", ref: "r-3" })));
    await led.fetch(post("release", { node: "c2", ref: res2.ref, drop: "the node says that address is not valid" }));
    const p2 = await j(await led.fetch(GET_INTERNAL("purse?node=c2")));
    ok("dropped: balance back, request gone, reason shown", p2.divi === 200 && p2.pending === null
       && String((p2.last as any)?.error).includes("not valid"), JSON.stringify(p2));
  }
  {
    /* Rejected before anything was reserved (the address failed London's check). */
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "c3", divi: 120, kills: 1200 }));
    await led.fetch(internal("request", { node: "c3", to: GOOD }));
    const rj = await j(await led.fetch(post("reject", { node: "c3", why: "not a valid address" })));
    ok("rejecting drops the request", rj.ok === true);
    const p = await j(await led.fetch(GET_INTERNAL("purse?node=c3")));
    ok("with the money untouched and the reason shown", p.divi === 120 && p.pending === null
       && (p.last as any)?.error === "not a valid address", JSON.stringify(p));
    const rj2 = await j(await led.fetch(post("reject", { node: "c3", why: "again" })));
    ok("rejecting nothing is nothing", rj2.ok === false);
  }
  {
    /* Under the minimum: asked, refused, nothing written. */
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "c4", divi: MIN_CLAIM - 1, kills: 990 }));
    const r = await j(await led.fetch(internal("request", { node: "c4", to: GOOD })));
    ok("under the minimum is refused", String(r.why).includes(`${MIN_CLAIM}`) && r.pending === null, `${r.why}`);
    const rows = (await j(await led.fetch(get("pending")))).rows as any[];
    ok("and London never hears of it", rows.length === 0);
  }

  /* ------------------------------------------------ flock kills and gems */
  {
    const { led } = newLedger();
    await led.fetch(internal("credit", { node: "g1", flocks: 2, gems: [1, 0, 3, 0, 0, 0, 0] }));
    await led.fetch(internal("credit", { node: "g1", flocks: 1, gems: [0, 1, 0, 0, 0, 0, 1] }));
    const p = await j(await led.fetch(GET_INTERNAL("purse?node=g1")));
    ok("flock kills add up on the account", p.flocks === 3, `${p.flocks}`);
    ok("gems add up per tier", JSON.stringify(p.gems) === "[1,1,3,0,0,0,1]", JSON.stringify(p.gems));
    const q = await j(await led.fetch(GET_INTERNAL("purse?node=nobody")));
    ok("a new account has none", q.flocks === 0 && JSON.stringify(q.gems) === "[0,0,0,0,0,0,0]");

    /* Dropped items, by key. The room's count; the client keeps its own. */
    await led.fetch(internal("credit", { node: "g1", items: { hull2: 1, recharge: 3 } }));
    await led.fetch(internal("credit", { node: "g1", items: { hull2: 2, ["x".repeat(40)]: 1, drone1: -5 } }));
    const pi = await j(await led.fetch(GET_INTERNAL("purse?node=g1"))) as any;
    ok("items add up per key", pi.items?.hull2 === 3 && pi.items?.recharge === 3, JSON.stringify(pi.items));
    ok("a silly key is dropped and a negative count is nothing", Object.keys(pi.items).length === 3 && pi.items.drone1 === 0, JSON.stringify(pi.items));
    ok("a new account holds nothing", JSON.stringify(q.items) === "{}", JSON.stringify(q.items));
  }

  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
