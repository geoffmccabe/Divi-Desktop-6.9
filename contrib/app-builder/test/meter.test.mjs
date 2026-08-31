import { test } from "node:test";
import assert from "node:assert/strict";

import {
  costUsd, pointsFor, ratesFor, SessionMeter, BillingError, MARKUP,
  isPricedModel, worstCasePoints, POINTS_PER_USD, MAX_OUTPUT_TOKENS,
} from "../src/meter.mjs";
import { Accounts } from "../src/accounts.mjs";

const BEFORE_INTRO_ENDS = new Date("2026-08-01T00:00:00Z");
const AFTER_INTRO_ENDS = new Date("2026-09-01T00:00:00Z");

/** A funded in-memory account, so no test writes to disk. */
async function funded(points, account = "tester") {
  const accounts = new Accounts();
  if (points > 0) await accounts.credit(account, points, { reason: "test" });
  return { accounts, account };
}

test("opus is priced at the published rate", () => {
  // 1M in, 1M out = $5 + $25.
  const usd = costUsd("claude-opus-5", { input_tokens: 1e6, output_tokens: 1e6 });
  assert.equal(round(usd), 30);
});

test("sonnet uses the introductory rate until it expires, then the standard one", () => {
  const usage = { input_tokens: 1e6, output_tokens: 1e6 };
  assert.equal(round(costUsd("claude-sonnet-5", usage, BEFORE_INTRO_ENDS)), 12); // 2 + 10
  assert.equal(round(costUsd("claude-sonnet-5", usage, AFTER_INTRO_ENDS)), 18); // 3 + 15
  assert.equal(ratesFor("claude-sonnet-5", BEFORE_INTRO_ENDS).intro, true);
  assert.equal(ratesFor("claude-sonnet-5", AFTER_INTRO_ENDS).intro, false);
});

test("cached tokens are far cheaper than fresh input", () => {
  const fresh = costUsd("claude-opus-5", { input_tokens: 1e6 });
  const cached = costUsd("claude-opus-5", { cache_read_input_tokens: 1e6 });
  assert.equal(round(cached), round(fresh * 0.1));
});

test("an unknown model refuses to bill rather than guessing", () => {
  assert.throws(() => costUsd("some-new-model", { input_tokens: 100 }), BillingError);
});

test("an unknown model is knowable BEFORE the call, not after", () => {
  // The audit's free-build hole: the call was made, then billing failed, so the
  // tokens came out of our pocket. The loop now asks this first.
  assert.equal(isPricedModel("claude-opus-5"), true);
  assert.equal(isPricedModel("claude-opus-4-1-20250805"), false);
});

test("missing or nonsense usage counts as zero, never negative", () => {
  assert.equal(costUsd("claude-opus-5", undefined), 0);
  assert.equal(costUsd("claude-opus-5", { input_tokens: -500 }), 0);
  assert.equal(costUsd("claude-opus-5", { input_tokens: "lots" }), 0);
});

test("the developer pays twice our cost, in points", () => {
  // $1 of cost -> $2 charged -> 2000 points at 1000 points per dollar.
  const { points } = pointsFor("claude-opus-5", { output_tokens: 40_000 }); // $1.00
  assert.equal(points, 1 * MARKUP * POINTS_PER_USD);
});

test("a rejected build is charged at half", () => {
  const full = pointsFor("claude-opus-5", { output_tokens: 40_000 }).points;
  const half = pointsFor("claude-opus-5", { output_tokens: 40_000 }, { rejected: true }).points;
  assert.equal(half, full / 2);
});

test("the worst case is priced from the output ceiling, not from hope", () => {
  // 8000 output tokens on opus is $0.20, doubled = $0.40 = 400 points, plus input.
  const points = worstCasePoints({ model: "claude-opus-5", inputTokens: 0, maxOutputTokens: MAX_OUTPUT_TOKENS });
  assert.equal(points, 400);
  // More input can only cost more.
  assert.ok(worstCasePoints({ model: "claude-opus-5", inputTokens: 1e6 }) > points);
});

test("a step cannot start without enough points", async () => {
  const m = new SessionMeter(await funded(10));
  assert.throws(() => m.reserve(50), BillingError);
});

test("reservations stop two steps spending the same points twice", async () => {
  const m = new SessionMeter(await funded(100));
  m.reserve(80);
  assert.equal(m.available, 20);
  assert.throws(() => m.reserve(40), BillingError);
});

test("a failed step releases its hold and costs nothing", async () => {
  const m = new SessionMeter(await funded(100));
  const { hold } = m.reserve(50);
  m.release(hold);
  assert.equal(m.available, 100);
  assert.equal(m.summary().spentPoints, 0);
});

test("settling charges actual usage and frees the rest of the hold", async () => {
  const m = new SessionMeter(await funded(1000));
  const { hold } = m.reserve(100);
  // 1000 output tokens on opus = $0.025 -> x2 -> $0.05 -> 50 points.
  const r = await m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 1000 } });
  assert.equal(r.points, 50);
  assert.equal(m.available, 950);
  assert.equal(m.balance, 950);
});

test("points actually leave the ledger, and it agrees with the meter", async () => {
  const { accounts, account } = await funded(1000);
  const m = new SessionMeter({ accounts, account });
  const { hold } = m.reserve(100);
  await m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 1000 } });
  assert.equal(accounts.balance(account), 950);
  const [line] = accounts.history(account, 1);
  assert.equal(line.kind, "spend");
  assert.equal(line.points, -50);
  assert.equal(line.balanceAfter, 950);
});

test("the per-step ceiling is enforced", async () => {
  const m = new SessionMeter({ ...(await funded(1e6)), maxTurnPoints: 100 });
  assert.throws(() => m.reserve(101), BillingError);
});

test("the per-session ceiling is enforced across steps", async () => {
  const m = new SessionMeter({ ...(await funded(1e6)), maxSessionPoints: 100 });
  const { hold } = m.reserve(60);
  await m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 1200 } }); // 60 points
  assert.throws(() => m.reserve(60), BillingError);
});

test("a balance can never be driven negative, however costly the step", async () => {
  const m = new SessionMeter(await funded(40));
  const { hold } = m.reserve(40);
  // Wildly more than the hold: the ledger must still refuse to go below zero.
  const r = await m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 1e6 } });
  assert.equal(m.balance, 0);
  assert.ok(r.unbilled > 0, "the shortfall is recorded rather than hidden");
});

function round(n, dp = 6) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
