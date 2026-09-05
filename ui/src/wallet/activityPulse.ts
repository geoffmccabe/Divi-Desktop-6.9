// "The node is querying the network" — a 4-second there-and-back ripple that
// helps users VISUALISE how a query propagates. Not literally accurate timing;
// it's a human-understandable picture:
//   A (0–1s): your node → peers            (outbound)
//   B (1–2s): peers → the non-peer network (outbound)
//   C (2–3s): non-peers → peers            (the answer returning)
//   D (3–4s): peers → your node            (the answer returning)
// As a pulse arrives at a node it shows a gold "?" (being queried), which fades
// as the answer leaves. A full node really does relay to all its peers, which
// relay onward — so lighting them all is honest in spirit.

let start = 0; // performance.now() when the ripple began
const TOTAL_MS = 4000;

// ── The map-animation module ───────────────────────────────────────────────
// A single source of truth for "what the network map should be animating right
// now". ANY feature — built-in (PoE, Send, staking) OR a user-built app — calls
// `pulse(spec)` to trigger a ripple in its own colour, for its own duration,
// optionally with an icon shown on the map. Both maps (flat + globe) READ the
// current state via the getters below and render it. This keeps the data flow
// one-directional and modular: producers call pulse(); consumers read getters.
//
// A spec is fully self-describing, so it is NOT limited to a fixed enum — a user
// app supplies its own {hsl, durationMs, icon, label}. Built-in features look up
// a named PRESET for convenience.
export interface MapPulseSpec {
  /** Colour as an HSL triple, e.g. "200 90% 62%". */
  hsl: string;
  /** How long the map keeps re-rippling (ms). */
  durationMs: number;
  /** Optional glyph/emoji shown at the node while active (e.g. "🔗"). */
  icon?: string;
  /** Optional short label (e.g. "Proof of Existence"), for a future map caption. */
  label?: string;
  /** Where it came from, for debugging/future filtering. */
  kind?: string;
}

// Named presets for built-in features. Unknown names fall back to "generic", so
// a user app that passes only {hsl,...} still works.
const PRESETS: Record<string, MapPulseSpec> = {
  generic: { hsl: "45 100% 55%", durationMs: 4000, kind: "generic" }, // gold (original)
  staking: { hsl: "45 100% 55%", durationMs: 4000, icon: "⚡", label: "Staking", kind: "staking" },
  poe: { hsl: "200 90% 62%", durationMs: 14000, icon: "🔗", label: "Proof of Existence", kind: "poe" },
  send: { hsl: "150 80% 52%", durationMs: 14000, icon: "💸", label: "Send", kind: "send" },
};

let current: MapPulseSpec = PRESETS.generic;
let activeUntil = 0; // performance.now() until which the maps keep re-rippling

/** Options for triggering a pulse: a preset `type`, and/or any explicit fields
 *  that override it. A user app typically passes {hsl, durationMs, icon, label}. */
export interface PulseOpts {
  type?: string; // a preset key ("poe" | "send" | "staking" | "generic") or omitted
  hsl?: string;
  durationMs?: number;
  icon?: string;
  label?: string;
}

/** Trigger the map animation. Resolves a preset by `type`, then applies any
 *  explicit overrides. This is the ONE entry point every feature/app uses. */
export function pulse(opts: PulseOpts = {}): void {
  const base = PRESETS[opts.type ?? "generic"] ?? PRESETS.generic;
  current = {
    hsl: opts.hsl ?? base.hsl,
    durationMs: opts.durationMs ?? base.durationMs,
    icon: opts.icon ?? base.icon,
    label: opts.label ?? base.label,
    kind: opts.type ?? base.kind ?? "custom",
  };
  start = performance.now();
  activeUntil = start + current.durationMs;
}

/** Backward-compatible: the old parameterless trigger = a generic gold ripple. */
export function pulseActivity(): void {
  pulse();
}

/** The full spec of the current/most-recent pulse (colour, icon, label, kind). */
export function pulseSpec(): MapPulseSpec {
  return current;
}
/** Active pulse colour as an HSL triple "H S% L%", for both maps to tint with. */
export function pulseHsl(): string {
  return current.hsl;
}
/** Icon to show at the node while a pulse is active, if the trigger set one. */
export function pulseIcon(): string | undefined {
  return current.icon;
}
/** performance.now() until which a pulse should keep re-rippling. */
export function pulseActiveUntil(): number {
  return activeUntil;
}

export interface Pulse {
  active: boolean;
  a: number; // self → peers      (0..1)
  b: number; // peers → non-peers (0..1)
  c: number; // non-peers → peers (0..1, return)
  d: number; // peers → self      (0..1, return)
  peerQ: number; // "?" opacity over peer nodes (0..1)
  nonPeerQ: number; // "?" opacity over non-peer nodes (0..1)
}

const seg = (t: number, lo: number, hi: number) => Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
// Trapezoid window: 0 outside [lo,hi], ramping in/out at the edges.
const win = (t: number, lo: number, hi: number, edge = 0.05) => {
  if (t <= lo || t >= hi) return 0;
  return Math.min(1, Math.min(t - lo, hi - t) / edge);
};

// ── Independent per-ping model (flat map) ──────────────────────────────────
// Instead of one synchronised 4-stage wave, each peer gets its OWN ping: it
// leaves at a jittered time and runs four legs (home→peer, peer→net, net→peer,
// peer→home), each leg independently jittered ±0.2s — so the map shows lots of
// little round-trips at different times, not four group flashes.

export function pulseTrigger(): number {
  return start;
}

export interface Leg {
  t0: number;
  t1: number;
}

const jit = () => Math.random() * 400 - 200; // ±200ms
const LEG_MS = 900;

/** Four legs for one ping, starting near `base`, each leg independently jittered. */
export function makeLegs(base: number): Leg[] {
  let t = base + jit();
  const legs: Leg[] = [];
  for (let i = 0; i < 4; i++) {
    const t1 = t + LEG_MS + jit();
    legs.push({ t0: t, t1 });
    t = t1;
  }
  return legs;
}

/** Progress 0..1 along a leg at `now`, or -1 if the leg isn't currently running. */
export function legU(leg: Leg, now = performance.now()): number {
  if (now < leg.t0 || now > leg.t1) return -1;
  return (now - leg.t0) / (leg.t1 - leg.t0);
}

/** "?" opacity: on while `now` is between two times, fading at the edges. */
export function holdOp(fromT: number, toT: number, now = performance.now(), edge = 150): number {
  if (now <= fromT || now >= toT) return 0;
  return Math.min(1, Math.min(now - fromT, toT - now) / edge);
}

export function pingDone(legs: Leg[], now = performance.now()): boolean {
  return legs.length === 0 || now > legs[3].t1;
}

export function pulseProgress(now = performance.now()): Pulse {
  const el = now - start;
  if (start === 0 || el < 0 || el > TOTAL_MS) {
    return { active: false, a: 0, b: 0, c: 0, d: 0, peerQ: 0, nonPeerQ: 0 };
  }
  const t = el / TOTAL_MS;
  return {
    active: true,
    a: seg(t, 0, 0.25),
    b: seg(t, 0.25, 0.5),
    c: seg(t, 0.5, 0.75),
    d: seg(t, 0.75, 1),
    // peers hold the query from when it arrives (~end A) until the answer leaves (~start D)
    peerQ: win(t, 0.22, 0.82, 0.06),
    // non-peers hold it from ~end B until the answer passes back (~end C)
    nonPeerQ: win(t, 0.47, 0.74, 0.05),
  };
}
