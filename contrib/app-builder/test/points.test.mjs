import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TIERS, priceTier, priceCatalogue, pointsForCostUsd, POINTS_PER_USD, MARKUP, PointsError,
} from "../src/points.mjs";
import { Accounts, AccountError } from "../src/accounts.mjs";
import { Orders, OrderError, STATE } from "../src/orders.mjs";
import { amountPaidTo, verifyPayment, findPayment, toSatoshis, parseConf, ChainError } from "../src/chain.mjs";
import { DiviPrice, readSlugQuote, PriceError } from "../src/price.mjs";

// ---------------------------------------------------------------- pricing

test("a point is a fixed amount of money, not a fixed amount of usage", () => {
  // $1 of our cost -> $2 charged -> 2000 points.
  assert.equal(pointsForCostUsd(1), MARKUP * POINTS_PER_USD);
  assert.equal(pointsForCostUsd(0.05), 100);
});

test("a fraction of a point always rounds towards us, never away", () => {
  // Rounding down would let a long session of tiny steps run free.
  assert.equal(pointsForCostUsd(0.0000001), 1);
});

test("bulk tiers give the discount they claim", () => {
  const [starter, builder, studio] = priceCatalogue(500);
  assert.equal(starter.points, 1000);
  assert.equal(starter.usd, 1);
  // Ten times the points for eight times the money.
  assert.equal(builder.points, starter.points * 10);
  assert.equal(builder.usd, 8);
  // And a point genuinely gets cheaper as the bundle grows.
  assert.ok(builder.diviPerPoint < starter.diviPerPoint);
  assert.ok(studio.diviPerPoint < builder.diviPerPoint);
});

test("tiers are data, so a new one needs no code change", () => {
  const extra = [...TIERS, { id: "whale", name: "Whale", points: 1e6, discountPercent: 50, blurb: "" }];
  const priced = priceCatalogue(500, extra);
  assert.equal(priced.length, 4);
  assert.equal(priced[3].usd, 500);
});

test("nothing can be priced without an admin-set DIVI rate", () => {
  assert.throws(() => priceTier(TIERS[0], 0), PointsError);
  assert.throws(() => priceTier(TIERS[0], undefined), PointsError);
});

// ---------------------------------------------------------------- the ledger

test("a balance starts at nothing and only a recorded credit moves it", async () => {
  const a = new Accounts();
  assert.equal(a.balance("someone"), 0);
  await a.credit("someone", 500, { reason: "test" });
  assert.equal(a.balance("someone"), 500);
});

test("a balance can never go negative", async () => {
  const a = new Accounts();
  await a.credit("someone", 100, { reason: "test" });
  await assert.rejects(() => a.debit("someone", 101), AccountError);
  assert.equal(a.balance("someone"), 100);
});

test("two spends at once cannot both take the same points", async () => {
  // The classic double-spend: read the balance, both see enough, both write.
  const a = new Accounts();
  await a.credit("someone", 100, { reason: "test" });
  const results = await Promise.allSettled([
    a.debit("someone", 60, { reason: "one" }),
    a.debit("someone", 60, { reason: "two" }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, "exactly one of the two may succeed");
  assert.equal(a.balance("someone"), 40);
});

test("accounts cannot see or spend each other's points", async () => {
  const a = new Accounts();
  await a.credit("alice", 100, { reason: "test" });
  assert.equal(a.balance("bob"), 0);
  await assert.rejects(() => a.debit("bob", 1), AccountError);
});

test("the ledger survives a restart and the balance is replayed from it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dd69-ledger-"));
  const file = path.join(dir, "ledger.jsonl");

  const first = await new Accounts({ file }).load();
  await first.credit("someone", 1000, { reason: "purchase" });
  await first.debit("someone", 250, { reason: "app builder" });

  const second = await new Accounts({ file }).load();
  assert.equal(second.balance("someone"), 750);
  // And the history is the audit trail, not just the number.
  const lines = second.history("someone", 10);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, "spend");
  assert.equal(lines[1].kind, "purchase");
});

test("every movement records what it was for", async () => {
  const a = new Accounts();
  await a.credit("someone", 100, { reason: "points purchase", txid: "abc" });
  const [line] = a.history("someone", 1);
  assert.equal(line.detail.txid, "abc");
  assert.equal(line.balanceAfter, 100);
});

// ---------------------------------------------------------------- buying

const TREASURY = "DTreasuryAddressForTests1111111111";

/** A fixed DIVI price, so tests never touch the network. */
function fixedPrice(usdPerDivi = 0.002) {
  const p = new DiviPrice({ apiKey: "test-key" });
  p.usd = usdPerDivi;
  p.at = Date.now();
  return p;
}

/** A chain that has recorded exactly these payments to the address. */
function fakeChain(payments = [], tip = 1000) {
  return {
    async call(method) {
      if (method === "getblockcount") return tip;
      if (method === "getaddressdeltas") return payments;
      throw new ChainError(`unexpected call ${method}`);
    },
  };
}

const paid = (divi, height) => ({ txid: "f".repeat(64), satoshis: toSatoshis(divi), height });

test("buying is refused, clearly, when it cannot be done safely", async () => {
  const accounts = new Accounts();
  const noAddress = new Orders({ accounts, treasuryAddress: null, price: fixedPrice(), node: fakeChain() });
  assert.match(noAddress.unavailable(), /address/);

  // No CoinMarketCap key means no price, and no price means no selling. It
  // never falls back to another source: the obvious one reads about 4.5x low.
  const noKey = new Orders({
    accounts, treasuryAddress: TREASURY, price: new DiviPrice(), node: fakeChain(),
  });
  assert.match(noKey.unavailable(), /CoinMarketCap/);

  const noNode = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: null });
  assert.match(noNode.unavailable(), /chain/);
  await assert.rejects(() => noNode.create({ account: "a", tierId: "starter" }), OrderError);
});

test("an order fixes the price before payment, and marks itself uniquely", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(0.002), node: fakeChain() });
  const one = await orders.create({ account: "alice", tierId: "builder" });
  const two = await orders.create({ account: "bob", tierId: "builder" });

  assert.equal(one.points, 10_000);
  // $8 at $0.002 a DIVI = 4000 DIVI.
  assert.equal(one.listDivi, 4000);
  // A tiny unique marker makes the payment self-identifying, so one buyer
  // cannot claim another's payment without having to prove who they are.
  assert.ok(one.amountDivi > one.listDivi);
  assert.ok(one.amountDivi - one.listDivi < 0.0001);
  assert.notEqual(one.amountDivi, two.amountDivi);
  // The rate used is recorded, so a past order can always be explained.
  assert.equal(one.diviPerUsd, 500);
});

test("a payment is found by address and exact amount, not by what the buyer says", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const order = await orders.create({ account: "alice", tierId: "starter" });

  orders.node = fakeChain([paid(order.amountDivi, 995)], 1000);
  // No transaction id supplied at all: the amount identifies the order.
  const done = await orders.claim(order.id);
  assert.equal(done.state, STATE.PAID);
  assert.equal(accounts.balance("alice"), 1000);
});

test("points appear only once the payment is settled", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const order = await orders.create({ account: "alice", tierId: "builder" });

  // In a block, but only one deep.
  orders.node = fakeChain([paid(order.amountDivi, 1000)], 1000);
  const pending = await orders.claim(order.id);
  assert.equal(pending.state, STATE.AWAITING_CONFIRMATIONS);
  assert.equal(accounts.balance("alice"), 0, "nothing is credited on one confirmation");

  orders.node = fakeChain([paid(order.amountDivi, 1000)], 1001);
  const done = await orders.claim(order.id);
  assert.equal(done.state, STATE.PAID);
  assert.equal(accounts.balance("alice"), 10_000);
});

test("a payment that is not there yet credits nothing and says nothing happened", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const order = await orders.create({ account: "alice", tierId: "starter" });
  const still = await orders.claim(order.id, "a".repeat(64));
  assert.equal(still.state, STATE.AWAITING_PAYMENT);
  assert.equal(accounts.balance("alice"), 0);
});

test("paying the wrong amount buys nothing", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const order = await orders.create({ account: "alice", tierId: "builder" });
  // Right address, wrong amount: it is not this order's payment.
  orders.node = fakeChain([paid(order.amountDivi - 1, 990)], 1000);
  const still = await orders.claim(order.id);
  assert.equal(still.state, STATE.AWAITING_PAYMENT);
  assert.equal(accounts.balance("alice"), 0);
});

test("one payment cannot buy two bundles", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const first = await orders.create({ account: "alice", tierId: "starter" });
  const second = await orders.create({ account: "alice", tierId: "starter" });

  // Both orders see the same single payment, which matches the first exactly.
  orders.node = fakeChain([paid(first.amountDivi, 990)], 1000);
  await orders.claim(first.id);
  // The second cannot match on amount, so it simply stays unpaid.
  const still = await orders.claim(second.id);
  assert.equal(still.state, STATE.AWAITING_PAYMENT);
  assert.equal(accounts.balance("alice"), 1000, "credited once, not twice");
});

test("claiming the same order twice does not credit twice", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain() });
  const order = await orders.create({ account: "alice", tierId: "starter" });
  orders.node = fakeChain([paid(order.amountDivi, 990)], 1000);
  await orders.claim(order.id);
  await orders.claim(order.id);
  assert.equal(accounts.balance("alice"), 1000);
});

test("an expired order cannot be paid late at the old price", async () => {
  const accounts = new Accounts();
  let now = 1_000_000;
  const orders = new Orders({
    accounts, treasuryAddress: TREASURY, price: fixedPrice(), node: fakeChain(), now: () => now,
  });
  const order = await orders.create({ account: "alice", tierId: "starter" });
  now += 3 * 60 * 60 * 1000;
  orders.node = fakeChain([paid(order.amountDivi, 990)], 1000);
  await assert.rejects(() => orders.claim(order.id), /expired/);
});

// ---------------------------------------------------------------- the price

test("DIVI is priced from CoinMarketCap, read positionally not by name", () => {
  // The reply is keyed by numeric coin id, so data["DIVI"] finds nothing. This
  // has silently returned no price before.
  assert.equal(readSlugQuote({ data: { 3441: { quote: { USD: { price: 0.00133 } } } } }), 0.00133);
  assert.equal(readSlugQuote({ data: { DIVI: {} } }), 0);
  assert.equal(readSlugQuote({ data: {} }), 0);
  // More than one coin back means the query was not pinned to our slug.
  assert.equal(readSlugQuote({ data: { 1: { quote: { USD: { price: 1 } } }, 2: {} } }), 0);
});

test("no CoinMarketCap key means no price at all, never another source", async () => {
  const p = new DiviPrice();
  assert.equal(p.configured, false);
  await assert.rejects(() => p.usdPerDivi(), PriceError);
});

test("a CoinMarketCap failure keeps the last good price rather than inventing one", async () => {
  let calls = 0;
  let clock = 0;
  const p = new DiviPrice({
    apiKey: "k",
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return { ok: true, json: async () => ({ data: { 3441: { quote: { USD: { price: 0.002 } } } } }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  assert.equal(await p.usdPerDivi(), 0.002);
  clock += 60 * 60 * 1000; // stale
  assert.equal(await p.usdPerDivi(), 0.002, "the last good quote is kept");
  assert.match(p.status().error, /503/);
});

test("the rate is how many DIVI to a dollar", async () => {
  const p = fixedPrice(0.002);
  assert.equal(await p.diviPerUsd(), 500);
});

// ---------------------------------------------------------------- the chain

test("a payment is read from either shape the node returns", () => {
  const fromWallet = { details: [{ category: "receive", address: TREASURY, amount: 12.5 }] };
  assert.equal(amountPaidTo(fromWallet, TREASURY), 12.5);

  const raw = { vout: [{ value: 7.25, scriptPubKey: { addresses: [TREASURY] } }] };
  assert.equal(amountPaidTo(raw, TREASURY), 7.25);

  const newerRaw = { vout: [{ value: 3, scriptPubKey: { address: TREASURY } }] };
  assert.equal(amountPaidTo(newerRaw, TREASURY), 3);
});

test("money paid to somebody else does not count", () => {
  const tx = { details: [{ category: "receive", address: "DSomeoneElse", amount: 500 }] };
  assert.equal(amountPaidTo(tx, TREASURY), 0);
});

test("a made-up transaction id is refused before the node is even asked", async () => {
  const never = { async call() { throw new ChainError("should not be reached"); } };
  await assert.rejects(
    () => verifyPayment(never, { txid: "not-a-txid", address: TREASURY, amount: 1 }),
    ChainError,
  );
});

test("a conflicting transaction is refused rather than waited on", async () => {
  const node = {
    async call() {
      return { confirmations: -1, details: [{ category: "receive", address: TREASURY, amount: 100 }] };
    },
  };
  await assert.rejects(
    () => verifyPayment(node, { txid: "a".repeat(64), address: TREASURY, amount: 1 }),
    /conflicts/,
  );
});

test("only money coming IN counts as a payment", async () => {
  // An address spending again shows as a negative delta. Counting those would
  // let one payment look like several.
  const chain = {
    async call(method) {
      if (method === "getblockcount") return 1000;
      return [
        { txid: "a".repeat(64), satoshis: toSatoshis(5), height: 990 },
        { txid: "b".repeat(64), satoshis: -toSatoshis(5), height: 995 },
      ];
    },
  };
  const found = await findPayment(chain, { address: TREASURY, amountDivi: 5 });
  assert.equal(found.found, true);
  assert.equal(found.txid, "a".repeat(64));
  assert.equal(found.confirmations, 11);
});

test("the node's own config is read the same way the wallet reads it", () => {
  const conf = parseConf("# a note\nrpcuser = dd69\nrpcpassword=p=ssw0rd\nrpcport= 51473 \n");
  assert.equal(conf.rpcuser, "dd69");
  assert.equal(conf.rpcpassword, "p=ssw0rd");
  assert.equal(conf.rpcport, "51473");
});

// ---------------------------------------------------------------- the door

test("a request from an unknown web page is refused outright", async () => {
  const { createServer, loadConfig } = await import("../src/server.mjs");
  const config = loadConfig({ BUILDER_ROOT: path.join(os.tmpdir(), `dd69-cors-${Date.now()}`), DIVI_PER_USD: "100" });
  const server = createServer(config);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // The exact shape a hostile page uses: a "simple" request that needs no
  // permission from the browser, aimed at a service on your own machine.
  const attack = await fetch(`${base}/admin/screening`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://not-the-wallet.example" },
    body: JSON.stringify({ thresholds: { flag: 9999, block: 10000 } }),
  });
  assert.equal(attack.status, 403);

  // The wallet's own origin is answered, and told so, or the panel cannot read
  // the reply at all.
  const ok = await fetch(`${base}/health`, { headers: { origin: "tauri://localhost" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "tauri://localhost");

  server.close();
});

test("the node's own folder is looked at before the shared one", async () => {
  // DD69 runs its own node in its own folder. Reading the shared Divi Desktop
  // 2.0 folder first would mean using the credentials of a node that is not the
  // one actually running, and every payment check would fail for no visible
  // reason.
  const { datadirCandidates } = await import("../src/chain.mjs");
  const [first, second] = datadirCandidates();
  assert.match(first, /DD69/);
  assert.ok(!/DD69/.test(second), "the fallback must be the shared folder");
});
