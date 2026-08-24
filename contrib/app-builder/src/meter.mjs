// What a build session costs us, and what the developer is charged for it.
//
// Charging is in POINTS, bought with DIVI up front (see points.mjs and
// orders.mjs). That is deliberate: the developer's balance is a number we hold,
// not a number they tell us, and a model price change moves the number of points
// a turn costs rather than quietly revaluing everyone's balance.
//
// Four things this file is careful about, because each is a way to lose money:
//
//   1. It bills from the token counts the API actually reports, never from an
//      estimate. Estimates drift, and drift in our favour is indistinguishable
//      from overcharging.
//   2. It works out the WORST the next step could cost before making the call,
//      and refuses to start if the balance cannot cover that. A hold based on a
//      guess is not a control: a runaway step can outrun a guess by a hundred
//      times, and that is exactly what an audit of the earlier version found.
//   3. The ceiling it works out is also passed to the model as a hard output
//      limit, so the worst case is a real limit rather than a hope.
//   4. Points come out of the shared ledger, which refuses to go negative and
//      records every movement.

import { pointsForCostUsd, POINTS_PER_USD, MARKUP } from "./points.mjs";

/** Anthropic list prices, US dollars per million tokens. */
export const PRICES = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    // Introductory rate, and it ends. After that the standard rate applies, so
    // the date is encoded rather than the discount being quietly permanent.
    intro: { input: 2, output: 10, until: "2026-08-31" },
  },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads are about a tenth of input; writes carry a premium. */
export const CACHE_MULTIPLIER = { read: 0.1, write: 1.25 };

/** Ceiling on one step's output. Also what makes the worst case a real bound. */
export const MAX_OUTPUT_TOKENS = 8000;

export const REJECTED_BUILD_SHARE = 0.5;

export { POINTS_PER_USD, MARKUP };

export class BillingError extends Error {}

/** Models a session may use. Anything else is refused BEFORE the call is made. */
export function isPricedModel(model) {
  return Object.prototype.hasOwnProperty.call(PRICES, model);
}

export function ratesFor(model, onDate = new Date()) {
  const p = PRICES[model];
  if (!p) throw new BillingError(`no price is configured for ${model}`);
  if (p.intro && onDate <= new Date(`${p.intro.until}T23:59:59Z`)) {
    return { input: p.intro.input, output: p.intro.output, intro: true };
  }
  return { input: p.input, output: p.output, intro: false };
}

/**
 * Our cost in US dollars for one API response.
 * `usage` is the API's own usage object.
 */
export function costUsd(model, usage, onDate = new Date()) {
  const r = ratesFor(model, onDate);
  const inTok = num(usage?.input_tokens);
  const outTok = num(usage?.output_tokens);
  const cacheRead = num(usage?.cache_read_input_tokens);
  const cacheWrite = num(usage?.cache_creation_input_tokens);

  const perToken = (tokens, rate) => (tokens / 1_000_000) * rate;
  return (
    perToken(inTok, r.input) +
    perToken(outTok, r.output) +
    perToken(cacheRead, r.input * CACHE_MULTIPLIER.read) +
    perToken(cacheWrite, r.input * CACHE_MULTIPLIER.write)
  );
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Points charged for one response. Half price when the code gate rejected it. */
export function pointsFor(model, usage, { rejected = false, onDate = new Date() } = {}) {
  const usd = costUsd(model, usage, onDate);
  return { usd, points: pointsForCostUsd(usd * (rejected ? REJECTED_BUILD_SHARE : 1)) };
}

/**
 * A rough token count for text we are about to send.
 *
 * Deliberately pessimistic: about three characters per token rather than the
 * usual four. An estimate that runs low would let a step start that the balance
 * cannot actually cover, so it errs the safe way.
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 3);
}

export function messagesSize(messages) {
  let chars = 0;
  const walk = (v) => {
    if (typeof v === "string") chars += v.length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(messages);
  return estimateTokens("x".repeat(chars));
}

/**
 * The most one step could possibly cost, in points, before it is made.
 * This is the number that gets held, and the output limit that gets sent.
 */
export function worstCasePoints({ model, inputTokens, maxOutputTokens = MAX_OUTPUT_TOKENS, onDate = new Date() }) {
  const r = ratesFor(model, onDate);
  const usd = (inputTokens / 1_000_000) * r.input + (maxOutputTokens / 1_000_000) * r.output;
  return pointsForCostUsd(usd);
}

/**
 * A session's running account, backed by the shared points ledger.
 *
 * The balance is read from the ledger every time. Nothing here can invent
 * credit, and nothing outside can declare it.
 */
export class SessionMeter {
  /**
   * @param {{accounts: object, account: string,
   *          maxTurnPoints?: number, maxSessionPoints?: number}} cfg
   */
  constructor(cfg) {
    if (!cfg?.accounts) throw new BillingError("a points ledger is required");
    this.accounts = cfg.accounts;
    this.account = cfg.account;
    this.maxTurnPoints = cfg.maxTurnPoints ?? 4_000;
    this.maxSessionPoints = cfg.maxSessionPoints ?? 40_000;
    this.spent = 0;
    this.reserved = 0;
    this.shortfall = 0;
    this.turns = [];
  }

  get balance() {
    return this.accounts.balance(this.account);
  }

  get available() {
    return this.balance - this.reserved;
  }

  /**
   * Hold points for a step that is about to run. Throws rather than letting a
   * step start that the developer cannot pay for.
   */
  reserve(points) {
    const hold = Math.max(1, Math.ceil(Number(points) || 0));
    if (hold > this.maxTurnPoints) {
      throw new BillingError(
        `a single step could cost up to ${hold.toLocaleString()} points, above the ${this.maxTurnPoints.toLocaleString()} limit. Try a shorter request.`,
      );
    }
    if (this.spent + hold > this.maxSessionPoints) {
      throw new BillingError(`this session has reached its ${this.maxSessionPoints.toLocaleString()} point limit`);
    }
    if (hold > this.available) {
      throw new BillingError(
        `not enough points: this step could need ${hold.toLocaleString()} and ${this.available.toLocaleString()} are available`,
      );
    }
    this.reserved += hold;
    return { hold };
  }

  release(hold) {
    this.reserved = Math.max(0, this.reserved - (Number(hold) || 0));
  }

  /**
   * Settle a completed step against what it actually used, taking the points
   * out of the ledger.
   */
  async settle({ hold, model, usage, rejected = false, onDate = new Date() }) {
    const { usd, points } = pointsFor(model, usage, { rejected, onDate });
    this.release(hold);

    // The hold was computed as a ceiling, so this should not bite. If it ever
    // does, the shortfall is recorded rather than throwing away the record of
    // work we already paid for.
    const affordable = Math.max(0, this.balance);
    const charge = Math.min(points, affordable);
    const short = points - charge;
    if (short > 0) this.shortfall += short;

    if (charge > 0) {
      await this.accounts.debit(this.account, charge, {
        reason: "app builder",
        model,
        usd,
        rejected,
        ...(short > 0 ? { unbilled: short } : {}),
      });
    }

    this.spent += charge;
    this.turns.push({ model, usd, points: charge, rejected, at: onDate.toISOString() });
    return { usd, points: charge, unbilled: short };
  }

  summary() {
    return {
      balancePoints: this.balance,
      spentPoints: this.spent,
      reservedPoints: this.reserved,
      turns: this.turns.length,
      costUsd: round(this.turns.reduce((n, t) => n + t.usd, 0), 6),
      ...(this.shortfall ? { unbilledPoints: this.shortfall } : {}),
    };
  }
}

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
