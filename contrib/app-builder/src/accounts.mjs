// Who has how many points, and why.
//
// This file exists because of a specific hole found in the audit: the balance
// used to arrive in the request, so anyone could declare themselves rich. The
// balance now lives here and nowhere else. Nothing outside this file may set it.
//
// Three rules it enforces:
//
//   1. THE LEDGER IS THE TRUTH. Every movement is an appended line, and the
//      balance is replayed from those lines rather than stored as a number that
//      could drift away from them. That is also what lets us settle a dispute
//      and reconcile against the real Anthropic invoice.
//   2. SPENDING IS ONE OPERATION. Check-then-write lets two requests read the
//      same balance and both succeed. Every change goes through one queue, so
//      that cannot happen.
//   3. NOTHING GOES NEGATIVE. A spend that does not fit is refused, not
//      allowed through and reconciled later.
//
// Zero dependencies, and written to a plain file: this handles money, and every
// package added here is another thing that has to be trusted.

import { promises as fs } from "node:fs";
import path from "node:path";

export class AccountError extends Error {}

/** Movements a ledger line can record. Anything else is a bug, not a new feature. */
export const KIND = {
  PURCHASE: "purchase",
  SPEND: "spend",
  REFUND: "refund",
  ADJUST: "adjust",
};

export class Accounts {
  /** @param {{file?: string}} [opts] where the ledger is kept; omit for memory only (tests) */
  constructor(opts = {}) {
    this.file = opts.file ?? null;
    this.lines = [];
    this.balances = new Map();
    // Every mutation joins this chain, so two requests can never interleave
    // between reading a balance and writing the result.
    this.queue = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    let raw;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return this; // no ledger yet is simply an empty one
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        this.apply(JSON.parse(line));
      } catch {
        // A single corrupt line must not silently drop every line after it.
        // It is left in the file and reported rather than discarded.
        this.corrupt = (this.corrupt ?? 0) + 1;
      }
    }
    return this;
  }

  /** Replay one line into memory. Never called from outside; use the methods below. */
  apply(entry) {
    const before = this.balances.get(entry.account) ?? 0;
    const after = before + entry.points;
    if (after < 0) throw new AccountError("ledger line would make a balance negative");
    this.balances.set(entry.account, after);
    this.lines.push(entry);
    return after;
  }

  balance(account) {
    return this.balances.get(this.key(account)) ?? 0;
  }

  key(account) {
    const a = String(account ?? "").trim();
    if (!a) throw new AccountError("an account is required");
    if (a.length > 96) throw new AccountError("that account name is too long");
    return a;
  }

  /** Serialise a change behind the queue so nothing interleaves. */
  run(fn) {
    const next = this.queue.then(fn, fn);
    // Failures must not poison the chain for everyone behind this caller.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async record({ account, kind, points, detail = {}, at = Date.now() }) {
    const acct = this.key(account);
    if (!Object.values(KIND).includes(kind)) throw new AccountError(`unknown movement "${kind}"`);
    const delta = Number(points);
    if (!Number.isInteger(delta) || delta === 0) {
      throw new AccountError("points must be a whole number, and not zero");
    }
    return this.run(async () => {
      const before = this.balances.get(acct) ?? 0;
      if (before + delta < 0) {
        throw new AccountError(
          `not enough points: this needs ${Math.abs(delta).toLocaleString()} and ${before.toLocaleString()} are available`,
        );
      }
      const entry = { at, account: acct, kind, points: delta, balanceAfter: before + delta, detail };
      const after = this.apply(entry);
      await this.persist(entry);
      return { balance: after, entry };
    });
  }

  /** Add points. `detail` should say what was paid and how it was verified. */
  credit(account, points, detail, kind = KIND.PURCHASE) {
    if (!(points > 0)) throw new AccountError("a credit must be positive");
    return this.record({ account, kind, points: Math.floor(points), detail });
  }

  /** Take points. Refused, not allowed to go negative, if the balance will not cover it. */
  debit(account, points, detail) {
    if (!(points > 0)) throw new AccountError("a charge must be positive");
    return this.record({ account, kind: KIND.SPEND, points: -Math.ceil(points), detail });
  }

  refund(account, points, detail) {
    if (!(points > 0)) throw new AccountError("a refund must be positive");
    return this.record({ account, kind: KIND.REFUND, points: Math.floor(points), detail });
  }

  /** Newest first, for the panel and for support questions. */
  history(account, limit = 50) {
    const acct = this.key(account);
    return this.lines.filter((l) => l.account === acct).slice(-limit).reverse();
  }

  /** Every line, for reconciling against a provider invoice. */
  all() {
    return this.lines.slice();
  }

  async persist(entry) {
    if (!this.file) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Append-only: a line already written is never rewritten, so a crash can
    // lose the newest line but can never corrupt the history behind it.
    await fs.appendFile(this.file, JSON.stringify(entry) + "\n", "utf8");
  }
}
