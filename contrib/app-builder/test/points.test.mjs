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
import { amountPaidTo, verifyPayment, parseConf, ChainError } from "../src/chain.mjs";

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

/** A node that says whatever the test needs it to say. */
function fakeNode(tx) {
  return { async call() { if (!tx) throw new ChainError("not found"); return tx; } };
}

function paymentTx(amount, confirmations, address = TREASURY) {
  return { confirmations, details: [{ category: "receive", address, amount }] };
}

test("buying is refused, clearly, when it cannot be done safely", async () => {
  const accounts = new Accounts();
  const noAddress = new Orders({ accounts, treasuryAddress: null, diviPerUsd: 500, node: fakeNode() });
  assert.match(noAddress.unavailable(), /address/);
  const noRate = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 0, node: fakeNode() });
  assert.match(noRate.unavailable(), /rate/);
  // No node means no way to confirm a payment, so no selling. Failing closed
  // here costs a buyer a wait; failing open would let anyone mint points.
  const noNode = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: null });
  assert.match(noNode.unavailable(), /node/);
  assert.throws(() => noNode.create({ account: "a", tierId: "starter" }), OrderError);
});

test("an order fixes the price before payment, and marks itself uniquely", async () => {
  const accounts = new Accounts();
  const orders = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const one = orders.create({ account: "alice", tierId: "builder" });
  const two = orders.create({ account: "bob", tierId: "builder" });

  assert.equal(one.points, 10_000);
  assert.equal(one.listDivi, 4000);
  // A tiny unique marker makes the payment self-identifying, so one buyer
  // cannot claim another's payment without having to prove who they are.
  assert.ok(one.amountDivi > one.listDivi);
  assert.ok(one.amountDivi - one.listDivi < 0.0001);
  assert.notEqual(one.amountDivi, two.amountDivi);
});

test("points appear only once the node agrees the payment is settled", async () => {
  const accounts = new Accounts();
  const o = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const order = o.create({ account: "alice", tierId: "builder" });

  // Paid the right amount, but only one block deep.
  o.node = fakeNode(paymentTx(order.amountDivi, 1));
  const pending = await o.claim(order.id, "a".repeat(64));
  assert.equal(pending.state, STATE.AWAITING_CONFIRMATIONS);
  assert.equal(accounts.balance("alice"), 0, "nothing is credited on one confirmation");

  // Once it settles, the same claim goes through.
  o.node = fakeNode(paymentTx(order.amountDivi, 2));
  const done = await o.claim(order.id, "a".repeat(64));
  assert.equal(done.state, STATE.PAID);
  assert.equal(accounts.balance("alice"), 10_000);
});

test("a settled payment credits exactly what was bought", async () => {
  const accounts = new Accounts();
  const o = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const order = o.create({ account: "alice", tierId: "starter" });
  o.node = fakeNode(paymentTx(order.amountDivi, 6));
  const done = await o.claim(order.id, "b".repeat(64));
  assert.equal(done.state, STATE.PAID);
  assert.equal(accounts.balance("alice"), 1000);
  assert.equal(done.balanceAfter, 1000);
});

test("one payment cannot buy two bundles", async () => {
  const accounts = new Accounts();
  const o = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const first = o.create({ account: "alice", tierId: "starter" });
  const second = o.create({ account: "alice", tierId: "starter" });
  const txid = "c".repeat(64);

  o.node = fakeNode(paymentTx(Math.max(first.amountDivi, second.amountDivi), 6));
  await o.claim(first.id, txid);
  await assert.rejects(() => o.claim(second.id, txid), /already been used/);
  assert.equal(accounts.balance("alice"), 1000, "credited once, not twice");
});

test("claiming the same order twice does not credit twice", async () => {
  const accounts = new Accounts();
  const o = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const order = o.create({ account: "alice", tierId: "starter" });
  o.node = fakeNode(paymentTx(order.amountDivi, 6));
  const txid = "d".repeat(64);
  await o.claim(order.id, txid);
  await o.claim(order.id, txid);
  assert.equal(accounts.balance("alice"), 1000);
});

test("underpaying buys nothing", async () => {
  const accounts = new Accounts();
  const o = new Orders({ accounts, treasuryAddress: TREASURY, diviPerUsd: 500, node: fakeNode() });
  const order = o.create({ account: "alice", tierId: "builder" });
  o.node = fakeNode(paymentTx(order.amountDivi - 1, 6));
  await assert.rejects(() => o.claim(order.id, "e".repeat(64)), /needs/);
  assert.equal(accounts.balance("alice"), 0);
});

test("an expired order cannot be paid late at the old price", async () => {
  const accounts = new Accounts();
  let now = 1_000_000;
  const o = new Orders({
    accounts, treasuryAddress: TREASURY, diviPerUsd: 500,
    node: fakeNode(paymentTx(999999, 6)), now: () => now,
  });
  const order = o.create({ account: "alice", tierId: "starter" });
  now += 3 * 60 * 60 * 1000;
  await assert.rejects(() => o.claim(order.id, "f".repeat(64)), /expired/);
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
  await assert.rejects(
    () => verifyPayment(fakeNode(paymentTx(100, 9)), { txid: "not-a-txid", address: TREASURY, amount: 1 }),
    ChainError,
  );
});

test("a conflicting transaction is refused rather than waited on", async () => {
  const node = fakeNode(paymentTx(100, -1));
  await assert.rejects(
    () => verifyPayment(node, { txid: "a".repeat(64), address: TREASURY, amount: 1 }),
    /conflicts/,
  );
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
