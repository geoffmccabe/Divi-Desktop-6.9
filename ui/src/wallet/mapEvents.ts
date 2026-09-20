// ── The map animation catalog + event bus (v2) ─────────────────────────────
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//   Every act of communication the app performs is drawn on the map, and
//   nothing is drawn that isn't really happening.
//
// Producers (the peer poll, the prober, the price feed, the updater, a future
// Community App) call emitMap() when something ACTUALLY happens. Consumers
// (the flat map, the globe, the in-game world, the counters) read the queue
// and render it however suits their surface. One-directional: producers emit,
// consumers read. No consumer ever invents an event.
//
// Two visual grammars:
//   ARC   — a message travelling from our node to somewhere. Green = seeking.
//   RINGS — one second of concentric circles at a location, whose COLOUR is
//           what we now know about that place:
//             grey    we know the location, no answer yet
//             red     refused / timed out / answered negatively
//             gold    alive and talking to us
//             fuchsia now a real peer in our node's network
//             cyan    traffic OUTSIDE the Divi network (price, geo, updates)
//
// The colour ladder is sequential and honest: a node never turns gold unless
// the machine actually answered.

export type MapTriggerName =
  // ── Divi network traffic ──
  | "node.seek" // we are reaching out to this node      → green arc
  | "node.reached" // the request landed, awaiting an answer  → grey rings
  | "node.dead" // refused / timed out / negative         → red rings
  | "node.alive" // answered, it is up                     → gold rings
  | "node.peer" // promoted to a real peer of our node    → fuchsia rings
  | "node.lost" // was a peer, dropped                    → grey rings
  | "node.discovered" // an address we have never seen before  → grey rings
  // ── our own node ──
  | "self.ok" // an RPC round-trip succeeded            → gold rings
  | "self.fail" // an RPC round-trip failed or timed out  → red rings
  | "self.block" // the chain advanced                     → gold rings
  // ── outside the Divi network ──
  | "external.seek" // calling a web service                  → cyan arc
  | "external.ok" // it answered                            → cyan rings
  | "external.fail" // it did not                             → red rings
  // ── wallet activity ──
  | "tx.send" // a transaction was broadcast            → white arc
  | "stake.win"; // we won a stake                         → gold rings

export interface TriggerSpec {
  /** CSS custom property holding "h s% l%", when the theme defines one. */
  cssVar?: string;
  /** Literal "h s% l%" used when there is no theme variable. */
  fallback: string;
  /** Draw a travelling arc from our node to the event's location. */
  arc: boolean;
  /** Number of concentric rings (0 = no rings, arc only). */
  rings: number;
  /** How long the whole animation lasts. Geoff's spec: one second. */
  durationMs: number;
  /** Shown in the legend and on hover. Plain English, for real humans. */
  label: string;
}

const RING_MS = 1000; // "a single one-second set of concentric circles"
const ARC_MS = 900; // how long a message takes to visibly travel

export const CATALOG: Record<MapTriggerName, TriggerSpec> = {
  "node.seek": {
    cssVar: "--map-discovery-pulse",
    fallback: "145 80% 50%",
    arc: true,
    rings: 0,
    durationMs: ARC_MS,
    label: "Reaching out to this node",
  },
  "node.reached": {
    cssVar: "--map-offline",
    fallback: "215 14% 58%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "Waiting for an answer",
  },
  "node.dead": {
    cssVar: "--map-dead",
    fallback: "0 85% 58%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "No answer",
  },
  "node.alive": {
    cssVar: "--map-self",
    fallback: "45 93% 47%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "Alive and answering",
  },
  "node.peer": {
    cssVar: "--map-peer-link",
    fallback: "280 80% 60%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "Now a peer of your node",
  },
  "node.lost": {
    cssVar: "--map-offline",
    fallback: "215 14% 58%",
    arc: false,
    rings: 2,
    durationMs: RING_MS,
    label: "Peer disconnected",
  },
  "node.discovered": {
    cssVar: "--map-offline",
    fallback: "215 14% 58%",
    arc: false,
    rings: 2,
    durationMs: RING_MS,
    label: "New node discovered",
  },
  "self.ok": {
    cssVar: "--map-self",
    fallback: "45 93% 47%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "Your node answered",
  },
  "self.fail": {
    cssVar: "--map-dead",
    fallback: "0 85% 58%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "Your node did not answer",
  },
  "self.block": {
    cssVar: "--map-self",
    fallback: "45 93% 47%",
    arc: false,
    rings: 4,
    durationMs: 1400,
    label: "New block",
  },
  "external.seek": {
    cssVar: "--map-external",
    fallback: "185 90% 55%",
    arc: true,
    rings: 0,
    durationMs: ARC_MS,
    label: "Calling a service outside the Divi network",
  },
  "external.ok": {
    cssVar: "--map-external",
    fallback: "185 90% 55%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "The service answered",
  },
  "external.fail": {
    cssVar: "--map-dead",
    fallback: "0 85% 58%",
    arc: false,
    rings: 3,
    durationMs: RING_MS,
    label: "The service did not answer",
  },
  "tx.send": {
    fallback: "0 0% 100%",
    arc: true,
    rings: 0,
    durationMs: ARC_MS,
    label: "Broadcasting your transaction",
  },
  "stake.win": {
    cssVar: "--map-self",
    fallback: "45 93% 47%",
    arc: false,
    rings: 5,
    durationMs: 1800,
    label: "You won a stake",
  },
};

/** Resolve a trigger's colour to "h, s%, l%" usable inside hsla(). */
export function triggerHsl(t: MapTriggerName): string {
  const spec = CATALOG[t];
  let raw = "";
  if (spec.cssVar && typeof document !== "undefined") {
    raw = getComputedStyle(document.documentElement).getPropertyValue(spec.cssVar).trim();
  }
  const m = (raw || spec.fallback).match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  return m ? `${m[1]}, ${m[2]}%, ${m[3]}%` : "0, 0%, 100%";
}

// ── Where our own node is ──────────────────────────────────────────────────
// Events about ourselves (an RPC round-trip, a new block) arrive from code that
// has no idea where we are on the map. The map records our verified location
// here once it knows it, so those events can be placed without every producer
// having to carry a coordinate around.

let selfLoc: { lat: number; lon: number } | null = null;

export function setMapSelf(lat: number, lon: number) {
  selfLoc = { lat, lon };
}

/** Null until our own location has actually been resolved. */
export function mapSelf(): { lat: number; lon: number } | null {
  return selfLoc;
}

export interface MapEvent {
  id: number;
  trigger: MapTriggerName;
  /** Where it happens. Our own node's location for self.* events. */
  lat: number;
  lon: number;
  /** Which node, when there is one. Lets a surface de-duplicate or label. */
  ip?: string;
  /** Wall-clock (performance.now) moment the animation should START. */
  startMs: number;
  /** Free text shown on hover, overriding the catalog label. */
  label?: string;
}

// A hard ceiling so a 500-node probe wave can never flood the canvas or leak
// memory. Oldest finished events are dropped first.
const MAX_QUEUED = 600;

let seq = 0;
let queue: MapEvent[] = [];

type Listener = (e: MapEvent) => void;
const listeners = new Set<Listener>();

/**
 * Record that something really happened. `delayMs` staggers presentation only:
 * it never changes WHETHER an event is shown, just when it starts drawing, so
 * a simultaneous 90-node probe wave reads as a sweep instead of a flash.
 */
export function emitMap(
  trigger: MapTriggerName,
  at: { lat: number; lon: number; ip?: string; delayMs?: number; label?: string },
): MapEvent {
  const e: MapEvent = {
    id: ++seq,
    trigger,
    lat: at.lat,
    lon: at.lon,
    ip: at.ip,
    startMs: performance.now() + (at.delayMs ?? 0),
    label: at.label,
  };
  queue.push(e);
  if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
  for (const cb of [...listeners]) {
    try {
      cb(e);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
  return e;
}

/** Subscribe to every event as it is emitted (counters, sounds, logging). */
export function onMapEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The events a renderer should be drawing at `now`, oldest first, already
 * filtered to those whose animation window is open. Also prunes the queue.
 */
export function activeMapEvents(now: number): MapEvent[] {
  const out: MapEvent[] = [];
  let liveCount = 0;
  for (const e of queue) {
    const end = e.startMs + CATALOG[e.trigger].durationMs;
    if (now < e.startMs) {
      liveCount++; // still pending, keep it
      continue;
    }
    if (now <= end) {
      liveCount++;
      out.push(e);
    }
  }
  // Drop fully-finished events once there is a meaningful amount of dead weight.
  if (queue.length - liveCount > 120) {
    queue = queue.filter((e) => now <= e.startMs + CATALOG[e.trigger].durationMs);
  }
  return out;
}

/** Wipe everything. Used when the flag is switched off, or on node switch. */
export function clearMapEvents() {
  queue = [];
  confirmed.clear();
  peers.clear();
  notifyCounts();
}

// ── Honest counters ────────────────────────────────────────────────────────
// The bottom-left numbers are derived from the SAME events that drive the
// animations, which is what makes "every increment is real" structurally true
// rather than a promise. A number cannot move without an animation having
// fired, because they read the same source.

const confirmed = new Set<string>(); // nodes that actually answered us
const peers = new Set<string>(); // nodes currently peered with us
type CountCb = (c: { nodes: number; peers: number }) => void;
const countSubs = new Set<CountCb>();

function notifyCounts() {
  const c = { nodes: Math.max(onMap, confirmed.size), peers: peers.size };
  for (const cb of [...countSubs]) {
    try {
      cb(c);
    } catch {
      /* ignore */
    }
  }
}

export function onMapCounts(cb: CountCb): () => void {
  countSubs.add(cb);
  cb({ nodes: Math.max(onMap, confirmed.size), peers: peers.size });
  return () => {
    countSubs.delete(cb);
  };
}

/**
 * How many nodes the map is currently drawing.
 *
 * The count used to be "nodes that answered us this session", which is a real
 * number but not the one on screen: discovery returns many nodes that are
 * genuinely on the network and simply cannot be dialled from here, and every
 * one of them is drawn. So the map filled with dots while the counter fell,
 * which reads as the network shrinking.
 */
let onMap = 0;

export function setMapNodeCount(n: number) {
  if (n === onMap) return;
  onMap = n;
  notifyCounts();
}

export function mapCounts() {
  return { nodes: Math.max(onMap, confirmed.size), peers: peers.size };
}

// Keep the tallies in step with reality by watching our own event stream.
onMapEvent((e) => {
  if (!e.ip) return;
  let changed = false;
  if (e.trigger === "node.alive" || e.trigger === "node.peer") {
    if (!confirmed.has(e.ip)) {
      confirmed.add(e.ip);
      changed = true;
    }
  }
  if (e.trigger === "node.peer") {
    if (!peers.has(e.ip)) {
      peers.add(e.ip);
      changed = true;
    }
  }
  if (e.trigger === "node.lost" || e.trigger === "node.dead") {
    if (peers.delete(e.ip)) changed = true;
    // A node that stops answering is no longer a CONFIRMED live node.
    if (e.trigger === "node.dead" && confirmed.delete(e.ip)) changed = true;
  }
  if (changed) notifyCounts();
});

// ── The probe animation sequence ───────────────────────────────────────────
// The full ladder for one node, in one call, so every surface performs it
// identically: green arc out, grey rings when it lands, then gold or red when
// the real answer comes back.

export interface ProbeTarget {
  ip: string;
  lat: number;
  lon: number;
}

/**
 * Announce that we are probing these nodes RIGHT NOW. Returns a function to
 * call with the real per-IP results when they arrive; it schedules each node's
 * gold/red resolution to land just after that node's grey "arrived" rings, so
 * the ladder always reads in order no matter when the answer turns up.
 */
export function beginProbeWave(targets: ProbeTarget[], stepMs = 90) {
  const startedAt = new Map<string, number>();
  targets.forEach((t, i) => {
    const delay = i * stepMs;
    startedAt.set(t.ip, delay);
    emitMap("node.seek", { lat: t.lat, lon: t.lon, ip: t.ip, delayMs: delay });
    emitMap("node.reached", { lat: t.lat, lon: t.lon, ip: t.ip, delayMs: delay + ARC_MS });
  });
  const waveStart = performance.now();

  return (results: { ip: string; online: boolean }[]) => {
    for (const r of results) {
      const t = targets.find((x) => x.ip === r.ip);
      if (!t) continue;
      // Resolve no earlier than the moment this node's grey rings finish.
      const greyEnds = waveStart + (startedAt.get(r.ip) ?? 0) + ARC_MS + RING_MS;
      const delay = Math.max(0, greyEnds - performance.now());
      emitMap(r.online ? "node.alive" : "node.dead", {
        lat: t.lat,
        lon: t.lon,
        ip: t.ip,
        delayMs: delay,
      });
    }
  };
}
