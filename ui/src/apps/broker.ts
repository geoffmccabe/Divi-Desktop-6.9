// The broker: the ONLY channel between a community app and the wallet.
//
// A community app runs in a sandboxed frame with no same-origin privileges, so
// it cannot reach `window.__TAURI__`, cannot read the wallet's DOM, and cannot
// call a Tauri command. Everything it wants goes through one postMessage channel
// that lands here, and every request passes five checks before anything happens:
//
//   1. Is the sender actually the frame we launched? (window identity, not origin)
//   2. Is the method in the permission catalogue at all?
//   3. Did this app declare it AND did the user grant it?
//   4. Is it inside the rate limit for that method?
//   5. Only then: run it, and log what happened.
//
// A sandboxed frame's origin is the opaque string "null", so origin checking is
// useless here by design. Identity comes from comparing the source window
// reference against the frame we created, which cannot be spoofed by content.
//
// See docs/COMMUNITY-APPS-MANIFEST.md section 4.

import {
  walletBalance, walletAddresses, listTransactions, recentBlocks,
  networkPeers, stakingWallets, lotteryInfo, nodeStatusSafe,
  validateAddress, addressBalance, addressQr, mempoolSnapshot, poeVerify,
  hraResolve, hraReverse, hraMarket, hraQuote,
  diviPriceSafe, paymentProgress, currentTheme,
} from "./hostApi";
import { permission, type PermissionKey } from "./permissions";
import type { AppManifest } from "./manifest";
import { appStorage } from "./storage";

const PROTOCOL = "divi.app.v1";

interface RequestMessage {
  proto: typeof PROTOCOL;
  id: number;
  method: string;
  params?: unknown;
}

export interface BrokerLogEntry {
  at: number;
  appId: string;
  method: string;
  outcome: "ok" | "denied" | "error";
  reason?: string;
}

/** Per-method ceiling, calls per minute. Deliberately low. */
const RATE_LIMITS: Record<string, number> = {
  "balance.read": 60,
  "addresses.read": 30,
  "history.read": 30,
  "staking.read": 30,
  "collectibles.read": 30,
  "tokens.read": 30,
  "network.read": 20,
  "chain.read": 60,
  "price.read": 30,
  "names.read": 30,
  "lookup.read": 40,
  "mempool.read": 20,
  "poe.verify": 20,
  storage: 120,
  "payment.request": 6,
  "clipboard.write": 20,
  notify: 10,
};

type Handler = (params: unknown, ctx: HostContext) => Promise<unknown>;

export interface HostContext {
  manifest: AppManifest;
  /** Raised by the wallet, outside the frame. Resolves true only if the user approved. */
  confirmPayment: (amount: number, reason: string) => Promise<boolean>;
  notify: (text: string) => void;
}

// Read handlers return only what the catalogue promises. Where the wallet's own
// shape carries more than the app is entitled to, it is narrowed here rather
// than passed through, so widening is a deliberate edit, not an accident.
const HANDLERS: Record<PermissionKey, Handler> = {
  "balance.read": async () => {
    const b = await walletBalance();
    if (!b) return null;
    return {
      spendable: b.spendable, staking: b.staking,
      pending: b.pending, immature: b.immature,
    };
  },
  "addresses.read": async () => {
    const list = await walletAddresses();
    return list.map((a) => ({ address: a.address, receives: a.receives, sends: a.sends }));
  },
  "history.read": async (params) => {
    const p = (params ?? {}) as { count?: number; from?: number };
    const count = clampInt(p.count, 1, 200, 50);
    const from = clampInt(p.from, 0, 100_000, 0);
    const txs = await listTransactions(count, from);
    if (!txs) return null;
    return txs.map((t) => ({
      txid: t.txid, amount: t.amount, kind: t.kind,
      time: t.time, confirmations: t.confirmations,
    }));
  },
  "staking.read": async () => ({
    wallets: await stakingWallets(),
    lottery: await lotteryInfo(),
  }),
  "collectibles.read": async () => {
    // Owned by the collectibles workstream, which lives on another branch.
    // Returning an explicit "not available" beats inventing a shape that later
    // has to change, and beats an empty list that reads as "you own nothing".
    throw new BrokerDenied("collectibles are not available in this build yet");
  },
  "tokens.read": async () => {
    // DMT is specified but the indexer does not exist. Same reasoning as above.
    throw new BrokerDenied("Divi Meta Tokens are not available in this build yet");
  },
  "network.read": async () => {
    const snap = await networkPeers();
    if (!snap) return null;
    return { peers: snap.peers.map((p) => ({ inbound: p.inbound, height: p.height })) };
  },
  "chain.read": async (params) => {
    const p = (params ?? {}) as { blocks?: number };
    const count = clampInt(p.blocks, 1, 20, 5);
    return { status: await nodeStatusSafe(), blocks: await recentBlocks(count) };
  },
  // ---- Things an app would otherwise have to build for itself ----
  //
  // Each of these is one call the developer does not have to write, and one
  // fewer place for an app to get a public fact wrong. They are grouped as
  // operations under one permission rather than a permission each, because an
  // app may only ask for eight and a long permission list makes people refuse
  // the whole thing.

  "price.read": async () => diviPriceSafe(),

  "names.read": async (params) => {
    const p = (params ?? {}) as { op?: string; name?: unknown; address?: unknown };
    switch (p.op) {
      case "resolve": {
        const name = text(p.name, 96);
        if (!name) throw new BrokerDenied("a name is required");
        return { address: await hraResolve(name) };
      }
      case "reverse": {
        const address = text(p.address, 96);
        if (!address) throw new BrokerDenied("an address is required");
        return { name: await hraReverse(address) };
      }
      case "market":
        return { listings: await hraMarket() };
      case "quote": {
        const name = text(p.name, 96);
        if (!name) throw new BrokerDenied("a name is required");
        return await hraQuote(name);
      }
      default:
        throw new BrokerDenied("names op must be resolve, reverse, market or quote");
    }
  },

  "lookup.read": async (params) => {
    const p = (params ?? {}) as { op?: string; address?: unknown; txid?: unknown };
    switch (p.op) {
      case "validate": {
        const address = text(p.address, 96);
        if (!address) throw new BrokerDenied("an address is required");
        return { valid: await validateAddress(address) };
      }
      case "balance": {
        const address = text(p.address, 96);
        if (!address) throw new BrokerDenied("an address is required");
        if (!(await validateAddress(address))) throw new BrokerDenied("that is not a Divi address");
        return await addressBalance(address);
      }
      case "qr": {
        const address = text(p.address, 96);
        if (!address) throw new BrokerDenied("an address is required");
        if (!(await validateAddress(address))) throw new BrokerDenied("that is not a Divi address");
        return { image: await addressQr(address) };
      }
      case "payment": {
        const txid = text(p.txid, 64);
        if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new BrokerDenied("that is not a transaction id");
        return await paymentProgress(txid);
      }
      default:
        throw new BrokerDenied("lookup op must be validate, balance, qr or payment");
    }
  },

  "mempool.read": async () => {
    const snap = await mempoolSnapshot([]);
    if (!snap) return null;
    // Narrowed: an app gets the size of the queue and the tip, not a decoded
    // list of everything strangers are doing right now.
    return { tip: snap.tip, waiting: snap.entries.length };
  },

  "poe.verify": async (params) => {
    const p = (params ?? {}) as { txid?: unknown; hash?: unknown };
    const txid = text(p.txid, 64);
    const hash = text(p.hash, 128);
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new BrokerDenied("that is not a transaction id");
    if (!/^[0-9a-fA-F]{16,128}$/.test(hash)) throw new BrokerDenied("that is not a fingerprint");
    return await poeVerify(txid, hash);
  },

  storage: async (params, ctx) => {
    const p = (params ?? {}) as { op?: string; key?: string; value?: unknown };
    return appStorage(ctx.manifest.id).handle(p);
  },
  "payment.request": async (params, ctx) => {
    const p = (params ?? {}) as { amount?: unknown; reason?: unknown };
    if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount <= 0) {
      throw new BrokerDenied("payment amount must be a positive number");
    }
    const reason = typeof p.reason === "string" ? p.reason.slice(0, 120) : "";
    // The wallet draws this, outside the frame. The app cannot click it.
    const approved = await ctx.confirmPayment(p.amount, reason);
    return { paid: approved };
  },
  network: async () => {
    // Brokered fetch is Block B follow-on work. Until it exists, saying so is
    // better than a silent failure the app author cannot diagnose.
    throw new BrokerDenied("brokered network access is not enabled yet");
  },
  "clipboard.write": async (params) => {
    const p = (params ?? {}) as { text?: unknown };
    const text = typeof p.text === "string" ? p.text.slice(0, 4096) : "";
    if (!text) throw new BrokerDenied("nothing to copy");
    await navigator.clipboard.writeText(text);
    return { copied: true };
  },
  notify: async (params, ctx) => {
    const p = (params ?? {}) as { text?: unknown };
    const text = typeof p.text === "string" ? p.text.slice(0, 200) : "";
    if (!text) throw new BrokerDenied("nothing to show");
    ctx.notify(text);
    return { shown: true };
  },
};

export class BrokerDenied extends Error {}

/** A trimmed, length-capped string, or "" if it was not one. */
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/**
 * Attach a broker to one running app frame. Returns a detach function; call it
 * when the app closes so a dead frame cannot keep a listener alive.
 */
export function attachBroker(opts: {
  frame: HTMLIFrameElement;
  manifest: AppManifest;
  granted: PermissionKey[];
  ctx: Omit<HostContext, "manifest">;
  onLog?: (entry: BrokerLogEntry) => void;
  /** The app crashed and said so. Sandboxed frames cannot be watched from here. */
  onAppError?: (message: string, where: string) => void;
}): () => void {
  const { frame, manifest, granted, onLog } = opts;
  const ctx: HostContext = { manifest, ...opts.ctx };
  const calls = new Map<string, number[]>();

  const log = (method: string, outcome: BrokerLogEntry["outcome"], reason?: string) => {
    onLog?.({ at: Date.now(), appId: manifest.id, method, outcome, reason });
  };

  const withinRate = (method: string): boolean => {
    const limit = RATE_LIMITS[method] ?? 10;
    const now = Date.now();
    const recent = (calls.get(method) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= limit) {
      calls.set(method, recent);
      return false;
    }
    recent.push(now);
    calls.set(method, recent);
    return true;
  };

  const onMessage = async (ev: MessageEvent) => {
    // Check 1: identity. Not origin, which is "null" for a sandboxed frame.
    if (!frame.contentWindow || ev.source !== frame.contentWindow) return;

    const data = ev.data as RequestMessage | undefined;
    if (!data || data.proto !== PROTOCOL || typeof data.id !== "number") return;

    const reply = (body: Record<string, unknown>) => {
      // Target origin "*" is correct and unavoidable here: the frame is sandboxed
      // into an opaque origin, so there is no origin string to name. This is safe
      // because the payload only ever goes to that one frame's window, and we
      // never put a secret in it.
      frame.contentWindow?.postMessage({ proto: PROTOCOL, id: data.id, ...body }, "*");
    };

    const method = String(data.method ?? "");

    // Two things need no permission, and both are deliberate.
    //
    // The wallet's own look is public styling information with nothing private
    // in it, and requiring a permission for it would mean an app either asks
    // for one more thing than it needs or silently fails to match the skin.
    //
    // An app reporting its own crash is the app talking about itself. Making
    // that permissioned would mean the apps most likely to be broken are the
    // ones least able to say so.
    if (method === "theme.read") {
      log(method, "ok");
      return reply({ ok: true, result: { vars: currentTheme() } });
    }
    if (method === "app.error") {
      const p = (data.params ?? {}) as { message?: unknown; where?: unknown };
      const text = typeof p.message === "string" ? p.message.slice(0, 300) : "something went wrong";
      const where = typeof p.where === "string" ? p.where.slice(0, 120) : "";
      log(method, "error", where ? `${text} (${where})` : text);
      opts.onAppError?.(text, where);
      return reply({ ok: true, result: { noted: true } });
    }

    // Check 2: is it a real method?
    const def = permission(method);
    if (!def) {
      log(method, "denied", "unknown method");
      return reply({ ok: false, error: "unknown method" });
    }

    // Check 3: declared in the manifest AND granted by the user.
    if (!manifest.permissions.includes(def.key) || !granted.includes(def.key)) {
      log(method, "denied", "permission not granted");
      return reply({ ok: false, error: `permission "${def.key}" was not granted` });
    }

    // Check 4: rate limit.
    if (!withinRate(method)) {
      log(method, "denied", "rate limit");
      return reply({ ok: false, error: "too many requests, slow down" });
    }

    // Check 5: run it.
    try {
      const result = await HANDLERS[def.key](data.params, ctx);
      log(method, "ok");
      reply({ ok: true, result });
    } catch (err) {
      const denied = err instanceof BrokerDenied;
      const msg = err instanceof Error ? err.message : "failed";
      log(method, denied ? "denied" : "error", msg);
      reply({ ok: false, error: msg });
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export const BROKER_PROTOCOL = PROTOCOL;
