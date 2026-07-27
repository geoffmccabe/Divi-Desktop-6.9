import { test } from "node:test";
import assert from "node:assert/strict";

import {
  costUsd, chargeDivi, ratesFor, SessionMeter, BillingError, MARKUP,
} from "../src/meter.mjs";

const BEFORE_INTRO_ENDS = new Date("2026-08-01T00:00:00Z");
const AFTER_INTRO_ENDS = new Date("2026-09-01T00:00:00Z");

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

test("missing or nonsense usage counts as zero, never negative", () => {
  assert.equal(costUsd("claude-opus-5", undefined), 0);
  assert.equal(costUsd("claude-opus-5", { input_tokens: -500 }), 0);
  assert.equal(costUsd("claude-opus-5", { input_tokens: "lots" }), 0);
});

test("the developer pays twice our cost", () => {
  assert.equal(chargeDivi(1, 1000), 1 * MARKUP * 1000);
});

test("a rejected build is charged at half", () => {
  const full = chargeDivi(1, 1000);
  assert.equal(chargeDivi(1, 1000, { rejected: true }), full / 2);
});

test("billing refuses to run without a DIVI rate", () => {
  assert.throws(() => chargeDivi(1, 0), BillingError);
  assert.throws(() => chargeDivi(1, undefined), BillingError);
});

test("a turn cannot start without enough credit", () => {
  const m = new SessionMeter({ balanceDivi: 10, diviPerUsd: 1000 });
  assert.throws(() => m.reserve(50), BillingError);
});

test("reservations stop two turns spending the same credit twice", () => {
  const m = new SessionMeter({ balanceDivi: 100, diviPerUsd: 1000 });
  m.reserve(80);
  assert.equal(m.available, 20);
  assert.throws(() => m.reserve(40), BillingError);
});

test("a failed turn releases its hold and costs nothing", () => {
  const m = new SessionMeter({ balanceDivi: 100, diviPerUsd: 1000 });
  const { hold } = m.reserve(50);
  m.release(hold);
  assert.equal(m.available, 100);
  assert.equal(m.summary().spentDivi, 0);
});

test("settling charges actual usage and refunds the rest of the hold", () => {
  const m = new SessionMeter({ balanceDivi: 1000, diviPerUsd: 1000 });
  const { hold } = m.reserve(100);
  // 100k output tokens on opus = $2.50, doubled = $5, at 1000 DIVI/$ = 5000...
  // deliberately small numbers instead:
  const r = m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 1000 } });
  // 1000 output tokens = $0.025 -> x2 -> $0.05 -> 50 DIVI
  assert.equal(round(r.divi), 50);
  assert.equal(round(r.refunded), 50);
  assert.equal(m.available, 950);
});

test("the per-turn ceiling is enforced", () => {
  const m = new SessionMeter({ balanceDivi: 1e6, diviPerUsd: 1000, maxTurnDivi: 100 });
  assert.throws(() => m.reserve(101), BillingError);
});

test("the per-session ceiling is enforced across turns", () => {
  const m = new SessionMeter({ balanceDivi: 1e6, diviPerUsd: 1, maxSessionDivi: 100 });
  const { hold } = m.reserve(60);
  m.settle({ hold, model: "claude-opus-5", usage: { output_tokens: 2.4e6 } }); // $60 -> 120 DIVI
  assert.throws(() => m.reserve(60), BillingError);
});

function round(n, dp = 6) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
