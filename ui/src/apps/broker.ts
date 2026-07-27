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
