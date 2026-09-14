// ── The shared map-animation renderer (v2) ─────────────────────────────────
//
// Draws the event queue from mapEvents.ts. Written ONCE and shared by every
// surface — flat map, globe, in-game world — so the three can never drift into
// telling the user three different stories about the same node.
//
// A surface supplies only two things: how to turn a lat/lon into a screen
// point, and where our own node is on screen. Everything else is identical.

import { activeMapEvents, CATALOG, triggerHsl, type MapEvent } from "./mapEvents";

export interface MapAnimSurface {
  /**
   * lat/lon → screen pixel, or null when the point is not currently visible
   * (behind the globe, outside a zoomed viewport). Null events are skipped.
   */
  project: (lat: number, lon: number) => [number, number] | null;
  /** Our own node on screen, the origin of every outbound arc. */
  self: [number, number] | null;
  /** Global opacity, so a surface can fade the whole layer in and out. */
  alpha?: number;
  /** Scales ring radii for surfaces drawn at a different zoom. */
  radiusScale?: number;
}

// Ceilings so a large probe wave stays legible and cheap. Beyond these the
// extra events still exist and still count; they simply aren't all drawn at
// the same instant.
const MAX_ARCS = 16;
const MAX_RINGS = 40;

/** Ease-out so an arc leaves fast and settles gently, like a real request. */
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

/**
 * A lifted quadratic curve from a to b. The lift grows with distance so short
 * hops stay flat and intercontinental ones bow visibly.
 */
function arcPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  u: number,
): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(140, dist * 0.28);
  // Control point: midway, pushed perpendicular to the line (always "upward"
  // on screen so arcs don't dive through the map).
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - lift;
  const v = 1 - u;
  return [v * v * ax + 2 * v * u * mx + u * u * bx, v * v * ay + 2 * v * u * my + u * u * by];
}

function drawArc(ctx: CanvasRenderingContext2D, e: MapEvent, s: MapAnimSurface, now: number) {
  if (!s.self) return;
  const p = s.project(e.lat, e.lon);
  if (!p) return;
  const spec = CATALOG[e.trigger];
  const u = Math.min(1, (now - e.startMs) / spec.durationMs);
  const head = easeOut(u);
  const hsl = triggerHsl(e.trigger);
  const a = (s.alpha ?? 1) * (u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15);
  const [ax, ay] = s.self;
  const [bx, by] = p;

  // The trail: the portion of the path already travelled, fading behind the
  // head so the eye follows the message rather than seeing a static line.
  const TAIL = 0.32;
  const from = Math.max(0, head - TAIL);
  const STEPS = 14;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < STEPS; i++) {
    const u0 = from + ((head - from) * i) / STEPS;
    const u1 = from + ((head - from) * (i + 1)) / STEPS;
    const [x0, y0] = arcPoint(ax, ay, bx, by, u0);
    const [x1, y1] = arcPoint(ax, ay, bx, by, u1);
    const k = i / STEPS; // 0 at the tail, 1 at the head
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = `hsla(${hsl}, ${a * 0.85 * k})`;
    ctx.lineWidth = 0.8 + 1.4 * k;
    ctx.stroke();
  }
  // The head itself, a small bright dot.
  const [hx, hy] = arcPoint(ax, ay, bx, by, head);
  ctx.beginPath();
  ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hsl}, ${a})`;
  ctx.fill();
  ctx.restore();
}

function drawRings(ctx: CanvasRenderingContext2D, e: MapEvent, s: MapAnimSurface, now: number) {
  const p = s.project(e.lat, e.lon);
  if (!p) return;
  const spec = CATALOG[e.trigger];
  const u = Math.min(1, (now - e.startMs) / spec.durationMs);
  const hsl = triggerHsl(e.trigger);
  const alpha = s.alpha ?? 1;
  const rs = s.radiusScale ?? 1;
  const [cx, cy] = p;

  ctx.save();
  for (let i = 0; i < spec.rings; i++) {
    // Each ring starts a third of the way behind the last, so they read as a
    // pulse spreading outward rather than one thick band.
    const ru = u - (i * 0.22) / 1;
    if (ru <= 0 || ru >= 1) continue;
    const r = (3 + easeOut(ru) * 24) * rs;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${hsl}, ${alpha * 0.75 * (1 - ru)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  // A solid centre dot that holds for the whole event, so the node's CURRENT
  // known state is readable even between ring pulses.
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6 * rs, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hsl}, ${alpha * (1 - u * 0.5)})`;
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the whole animation layer for this frame. Call once per frame, after
 * the map itself is drawn, with the transform already applied.
 */
export function drawMapAnim(ctx: CanvasRenderingContext2D, now: number, s: MapAnimSurface) {
  const events = activeMapEvents(now);
  if (!events.length) return;

  // Arcs underneath, rings on top, so a ring is never hidden by a line.
  let arcs = 0;
  for (const e of events) {
    if (!CATALOG[e.trigger].arc) continue;
    if (++arcs > MAX_ARCS) break;
    drawArc(ctx, e, s, now);
  }
  let rings = 0;
  for (const e of events) {
    if (CATALOG[e.trigger].rings === 0) continue;
    if (++rings > MAX_RINGS) break;
    drawRings(ctx, e, s, now);
  }
}

/** What the layer is currently animating, for a HUD or debug readout. */
export function mapAnimLoad(now: number) {
  const events = activeMapEvents(now);
  return {
    total: events.length,
    arcs: events.filter((e) => CATALOG[e.trigger].arc).length,
    rings: events.filter((e) => CATALOG[e.trigger].rings > 0).length,
  };
}
