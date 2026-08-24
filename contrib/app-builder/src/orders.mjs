// Buying points with DIVI.
//
// The flow, and why each step is there:
//
//   1. The buyer picks a bundle. We write down what they owe, to the satoshi,
//      BEFORE they pay. The price cannot move underneath them afterwards.
//   2. Each order gets a tiny unique amount added to it, a few ten-millionths
//      of a DIVI. That makes the payment self-identifying: two people buying
//      the same bundle at the same moment owe different amounts, so one cannot
//      claim the other's payment. It costs the buyer a rounding error and
//      removes the need to prove who they are just to top up.
//   3. The wallet sends normally, the user approving it like any other send.
//   4. We ask the NODE whether that payment happened. Not the wallet, not the
//      buyer: the node.
//   5. A transaction id can settle exactly one order, ever.

import { randomUUID, randomInt } from "node:crypto";

import { findTier, priceTier, round8 } from "./points.mjs";
import { verifyPayment } from "./chain.mjs";

export class OrderError extends Error {}

/** An unpaid order is forgotten after this, so the list cannot grow forever. */
export const ORDER_TTL_MS = 2 * 60 * 60 * 1000;

export const STATE = {
  AWAITING_PAYMENT: "awaiting_payment",
  AWAITING_CONFIRMATIONS: "awaiting_confirmations",
  PAID: "paid",
  EXPIRED: "expired",
};

export class Orders {
  /**
   * @param {{accounts: object, treasuryAddress: string|null, diviPerUsd: number,
   *          node: object|null, now?: () => number}} cfg
   */
  constructor(cfg) {
    this.accounts = cfg.accounts;
    this.treasuryAddress = cfg.treasuryAddress ?? null;
    this.diviPerUsd = cfg.diviPerUsd;
    this.node = cfg.node ?? null;
    this.now = cfg.now ?? (() => Date.now());
    this.orders = new Map();
    /** Transaction ids already used. A payment settles one order and no more. */
    this.spentTxids = new Set();
  }

  /**
   * Why buying is not possible right now, or null if it is.
   *
   * This says whether we are SET UP to sell, not whether the node is answering
   * this second. A node that is reindexing or stopped shows up when a payment
   * is checked: the order stays open with a message, and the points appear when
   * it can be confirmed. Nothing is lost, and nothing is credited on a guess.
   */
  unavailable() {
    if (!this.treasuryAddress) return "no address has been set to receive payments";
    if (!(this.diviPerUsd > 0)) return "the DIVI rate has not been set";
    if (!this.node) return "the Divi node's settings could not be found, so payments cannot be confirmed";
    return null;
  }

  create({ account, tierId }) {
    const why = this.unavailable();
    if (why) throw new OrderError(why);

    const tier = findTier(tierId);
    if (!tier) throw new OrderError("that bundle does not exist");

    const priced = priceTier(tier, this.diviPerUsd);
    // Up to 9999 satoshi of DIVI, so the exact amount is this order's fingerprint.
    const marker = randomInt(1, 10_000) / 1e8;
    const amountDivi = round8(priced.divi + marker);

    const order = {
      id: randomUUID(),
      account: String(account ?? "").trim(),
      tierId: tier.id,
      tierName: tier.name,
      points: tier.points,
      amountDivi,
      listDivi: priced.divi,
      discountPercent: priced.discountPercent,
      address: this.treasuryAddress,
      state: STATE.AWAITING_PAYMENT,
      createdAt: this.now(),
      expiresAt: this.now() + ORDER_TTL_MS,
      txid: null,
      confirmations: 0,
    };
    if (!order.account) throw new OrderError("an account is required");
    this.orders.set(order.id, order);
    return this.publicView(order);
  }

  get(id) {
    const order = this.orders.get(String(id ?? ""));
    if (!order) throw new OrderError("that purchase was not found");
    if (order.state === STATE.AWAITING_PAYMENT && this.now() > order.expiresAt) {
      order.state = STATE.EXPIRED;
    }
    return order;
  }

  /**
   * The wallet reports what it sent. We check it against the chain and, once it
   * is settled, credit the points.
   *
   * Safe to call repeatedly: an order already paid returns its result rather
   * than crediting twice.
   */
  async claim(id, txid) {
    const order = this.get(id);
    if (order.state === STATE.PAID) return this.publicView(order);
    if (order.state === STATE.EXPIRED) {
      throw new OrderError("this purchase expired before it was paid; start a new one");
    }
    if (!this.node) throw new OrderError("the Divi node cannot be reached to confirm payments");

    const tx = String(txid ?? "").trim().toLowerCase();
    // Claimed by another order already: refuse before touching any balance.
    if (this.spentTxids.has(tx) && order.txid !== tx) {
      throw new OrderError("that payment has already been used for another purchase");
    }

    const result = await verifyPayment(this.node, {
      txid: tx,
      address: order.address,
      amount: order.amountDivi,
    });

    order.txid = tx;
    order.confirmations = result.confirmations;

    if (!result.confirmed) {
      order.state = STATE.AWAITING_CONFIRMATIONS;
      return this.publicView(order);
    }

    // Reserve the transaction id before crediting, so two calls racing here
    // cannot both get past the check above.
    this.spentTxids.add(tx);
    try {
      const { balance } = await this.accounts.credit(order.account, order.points, {
        reason: "points purchase",
        tier: order.tierId,
        txid: tx,
        paidDivi: result.paid,
        confirmations: result.confirmations,
      });
      order.state = STATE.PAID;
      order.paidAt = this.now();
      order.balanceAfter = balance;
    } catch (e) {
      this.spentTxids.delete(tx);
      throw e;
    }
    return this.publicView(order);
  }

  /** Drop orders nobody paid for. Called on a timer by the server. */
  sweep() {
    const now = this.now();
    for (const [id, o] of this.orders) {
      const dead = o.state === STATE.PAID ? o.paidAt + ORDER_TTL_MS : o.expiresAt;
      if (now > dead + ORDER_TTL_MS) this.orders.delete(id);
      else if (o.state === STATE.AWAITING_PAYMENT && now > o.expiresAt) o.state = STATE.EXPIRED;
    }
  }

  publicView(o) {
    return {
      id: o.id,
      tierId: o.tierId,
      tierName: o.tierName,
      points: o.points,
      amountDivi: o.amountDivi,
      listDivi: o.listDivi,
      discountPercent: o.discountPercent,
      address: o.address,
      state: o.state,
      expiresAt: o.expiresAt,
      txid: o.txid,
      confirmations: o.confirmations,
      needsConfirmations: 2,
      balanceAfter: o.balanceAfter,
    };
  }
}
