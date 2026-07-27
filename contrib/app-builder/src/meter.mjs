// What a build session costs us, and what the developer is charged for it.
//
// The rule Geoff set: developers pay twice what the tokens cost us, in DIVI, and
// a build the code gate rejects is charged at half.
//
// Three things this file is careful about, because each is a way to lose money
// or lose trust:
//
//   1. It bills from the token counts the API actually reports, never from an
//      estimate. Estimates drift, and drift in our favour is indistinguishable
//      from overcharging.
//   2. Credit is RESERVED before a turn and settled after. A runaway agent loop
//      can spend real money in minutes, so "check the balance afterwards" is not
//      good enough.
//   3. The DIVI price is a number an admin sets, never a live feed. Aggregators
//      disagree by roughly 4.5x on DIVI because they track different illiquid
//      venues, so billing off a feed would be indefensible.

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

export const MARKUP = 2;
export const REJECTED_BUILD_SHARE = 0.5;

export class BillingError extends Error {}

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

  const perToken = (millions, rate) => (millions / 1_000_000) * rate;
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

/**
 * What the developer pays, in DIVI.
 * @param {number} usd our cost
 * @param {number} diviPerUsd admin-set rate: how many DIVI to one dollar
 * @param {{rejected?: boolean}} opts
 */
export function chargeDivi(usd, diviPerUsd, opts = {}) {
  if (!(diviPerUsd > 0)) throw new BillingError("the DIVI rate has not been set");
  const share = opts.rejected ? REJECTED_BUILD_SHARE : 1;
  return usd * MARKUP * share * diviPerUsd;
}

/**
 * A session's running account.
 *
 * Reserve before a turn, settle after. If the turn dies mid-flight the
 * reservation is released, so a crash cannot silently consume a balance.
 */
export class SessionMeter {
  /**
   * @param {{balanceDivi: number, diviPerUsd: number,
   *          maxTurnDivi?: number, maxSessionDivi?: number}} cfg
   */
  constructor(cfg) {
    if (!(cfg.balanceDivi >= 0)) throw new BillingError("balance is required");
    this.balance = cfg.balanceDivi;
    this.diviPerUsd = cfg.diviPerUsd;
    this.maxTurnDivi = cfg.maxTurnDivi ?? 400;
    this.maxSessionDivi = cfg.maxSessionDivi ?? 4000;
    this.spent = 0;
    this.reserved = 0;
    this.turns = [];
  }

  get available() {
    return this.balance - this.reserved;
  }

  /**
   * Hold credit for a turn that is about to run. Throws rather than letting a
   * turn start that the developer cannot pay for.
   */
  reserve(estimateDivi) {
    const hold = Math.max(1, Number(estimateDivi) || 0);
    if (hold > this.maxTurnDivi) {
      throw new BillingError(`a single turn may not exceed ${this.maxTurnDivi} DIVI`);
    }
    if (this.spent + hold > this.maxSessionDivi) {
      throw new BillingError(`this session has reached its ${this.maxSessionDivi} DIVI limit`);
    }
    if (hold > this.available) {
      throw new BillingError(
        `not enough credit: this turn needs about ${hold.toFixed(2)} DIVI and ${this.available.toFixed(2)} is available`,
      );
    }
    this.reserved += hold;
    return { hold };
  }

  /** Release a reservation without charging (the turn failed before spending). */
  release(hold) {
    this.reserved = Math.max(0, this.reserved - (Number(hold) || 0));
  }

  /**
   * Settle a completed turn against what it actually used.
   * @returns {{usd:number, divi:number, refunded:number}}
   */
  settle({ hold, model, usage, rejected = false, onDate = new Date() }) {
    const usd = costUsd(model, usage, onDate);
    const divi = chargeDivi(usd, this.diviPerUsd, { rejected });

    this.release(hold);
    this.balance -= divi;
    this.spent += divi;
    this.turns.push({ model, usd, divi, rejected, at: onDate.toISOString() });

    return { usd, divi, refunded: Math.max(0, (Number(hold) || 0) - divi) };
  }

  summary() {
    return {
      balanceDivi: round(this.balance),
      spentDivi: round(this.spent),
      reservedDivi: round(this.reserved),
      turns: this.turns.length,
      costUsd: round(this.turns.reduce((n, t) => n + t.usd, 0), 6),
    };
  }
}

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
