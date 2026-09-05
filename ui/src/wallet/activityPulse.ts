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

// ── Typed map activity ─────────────────────────────────────────────────────
// Any feature (PoE, Send, staking…) can trigger a map animation in its own
// colour and for its own duration. The maps read `pulseHsl()` for the colour
// and `pulseActiveUntil()` to keep re-emitting ripples while a transaction is
// still "in flight", so a user who broadcasts on one panel and then switches to
// the map still sees it happening. Colour is an HSL triple "H S% L%".
export type PulseType = "generic" | "staking" | "poe" | "send";
const PULSE_STYLE: Record<PulseType, { hsl: string; durationMs: number }> = {
  generic: { hsl: "45 100% 55%", durationMs: 4000 }, // gold (the original ripple)
  staking: { hsl: "45 100% 55%", durationMs: 4000 }, // gold
  poe: { hsl: "200 90% 62%", durationMs: 14000 }, // light blue, lingers ~14s
  send: { hsl: "150 80% 52%", durationMs: 14000 }, // green, lingers ~14s
};

let currentHsl = PULSE_STYLE.generic.hsl;
let activeUntil = 0; // performance.now() until which the maps keep re-rippling

/** Trigger a typed map animation. Colour + duration come from the type unless
 *  overridden. */
export function pulse(opts: { type?: PulseType; hsl?: string; durationMs?: number } = {}): void {
  const style = PULSE_STYLE[opts.type ?? "generic"];
  currentHsl = opts.hsl ?? style.hsl;
  start = performance.now();
  activeUntil = start + (opts.durationMs ?? style.durationMs);
}

/** Backward-compatible: the old parameterless trigger = a generic gold ripple. */
export function pulseActivity(): void {
  pulse();
}

/** Active pulse colour as an HSL triple "H S% L%", for both maps to tint with. */
export function pulseHsl(): string {
  return currentHsl;
}

/** performance.now() until which a transaction pulse should keep re-rippling. */
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
