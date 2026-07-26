// "Newest nodes" — the data + lifecycle behind the map spirals and the
// bottom-right Newest Nodes panel. No drawing here.
//
// KEY DESIGN: a node's "first seen" date lives in its OWN append-only registry
// (dd69.newNodes.reg), NOT inside knownPeers. knownPeers churns — it gets
// rewritten, per-scoped, and re-populated as nodes drop and reconnect — and
// stashing firstSeen in it made every re-added node look brand-new (a spiral on
// an old node). The registry is written once per IP and NEVER rewritten by that
// churn, so a node's age is stable no matter what the map does to knownPeers.
//
// A node is "new" for 10 days from the first time we recorded its IP. Honesty:
// "new" = first seen by OUR node(s) on that date, not "joined the network then".

import { loadKnown, type Known } from "./knownPeers";

export const NEW_DAYS = 10; // spiral lifetime
export const SPIRAL_MAX_PX = 25; // day-0 diameter
const DAY_MS = 24 * 60 * 60 * 1000;

const REG = "dd69.newNodes.reg"; // { ip: firstSeenMs } — append-only, never churned
const ANNOUNCED = "dd69.newNodes.announced"; // IPs whose arrival cue has fired

// The user's Costa Rica desktop node — seeded as the day-0 test spiral. It is the
// user's OWN node, not a peer, so its location is injected into knownPeers too so
// the map has somewhere to draw it.
const SEED = { ip: "201.206.191.234", lat: 9.9985, lon: -84.1171, city: "Heredia", country: "Costa Rica", cc: "CR" };

type Reg = Record<string, number>;

function loadReg(): Reg {
  try {
    return JSON.parse(localStorage.getItem(REG) || "{}");
  } catch {
    return {};
  }
}
function saveReg(r: Reg): void {
  try {
    localStorage.setItem(REG, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
}

/**
 * One-time seed. Registers EVERY node known today as "existing" (first seen far
 * in the past ⇒ no spiral), and the Costa Rica node as brand-new (day 0). Runs
 * only when the registry is empty, so it never re-freezes a genuine new node.
 * Reads knownPeers straight from disk (a stable 92-ish), so it can't be fooled
 * by a momentarily-thin in-memory copy.
 */
export function baselineNewNodes(now = Date.now()): void {
  const reg = loadReg();
  if (Object.keys(reg).length > 0) return; // already seeded
  const old = now - (NEW_DAYS + 1) * DAY_MS; // older than the window ⇒ not new
  const k = loadKnown();
  for (const ip of Object.keys(k)) reg[ip] = old;
  reg[SEED.ip] = now; // the one test spiral
  saveReg(reg);
  // Make sure the seed node has a location to draw at (it's our own node).
  try {
    k[SEED.ip] = { lat: SEED.lat, lon: SEED.lon, city: SEED.city, country: SEED.country, cc: SEED.cc, lastSeen: now };
    localStorage.setItem("dd69.knownPeers", JSON.stringify(k));
  } catch {
    /* ignore */
  }
  markAnnounced([SEED.ip]); // don't chime for the seed on first run
}

/**
 * Record IPs seen this poll. Only IPs NOT already in the registry get a fresh
 * firstSeen = now (genuinely new). An IP already registered — including one that
 * dropped from knownPeers and came back — keeps its original date, so it never
 * re-spirals. No-op until the baseline has seeded the registry.
 */
export function noteSeen(ips: string[], now = Date.now()): void {
  const reg = loadReg();
  if (Object.keys(reg).length === 0) return; // baseline hasn't run — don't invent ages
  let changed = false;
  for (const ip of ips) {
    if (reg[ip] == null) {
      reg[ip] = now;
      changed = true;
    }
  }
  if (changed) saveReg(reg);
}

/** Whole days since first seen (0 = today, in the user's local calendar). */
export function ageDays(firstSeen: number, now = Date.now()): number {
  const a = new Date(firstSeen);
  const b = new Date(now);
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.max(0, Math.round((db - da) / DAY_MS));
}

/** Spiral diameter in px for a given age; 0 once past the window (no spiral). */
export function spiralDiameter(firstSeen: number, now = Date.now()): number {
  const d = ageDays(firstSeen, now);
  if (d >= NEW_DAYS) return 0;
  return SPIRAL_MAX_PX * ((NEW_DAYS - d) / NEW_DAYS); // linear: 100% → 10% → gone
}

export interface NewNode {
  ip: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  cc?: string;
  firstSeen: number;
  ageDays: number;
  diameter: number;
}

/** Nodes still within their spiral window, newest first, capped at `limit`. */
export function newNodes(known: Known = loadKnown(), now = Date.now(), limit = 10): NewNode[] {
  const reg = loadReg();
  const out: NewNode[] = [];
  for (const [ip, firstSeen] of Object.entries(reg)) {
    const d = ageDays(firstSeen, now);
    if (d >= NEW_DAYS) continue;
    const kp = known[ip];
    // Need a location to place it. The seed node carries its own.
    const loc = kp ?? (ip === SEED.ip ? { lat: SEED.lat, lon: SEED.lon, city: SEED.city, country: SEED.country, cc: SEED.cc, lastSeen: now } : null);
    if (!loc) continue;
    out.push({
      ip,
      lat: loc.lat,
      lon: loc.lon,
      city: loc.city,
      country: loc.country,
      cc: loc.cc,
      firstSeen,
      ageDays: d,
      diameter: spiralDiameter(firstSeen, now),
    });
  }
  out.sort((a, b) => b.firstSeen - a.firstSeen); // newest first
  return out.slice(0, limit);
}

/** "today" / "yesterday" / "N days ago" for an age in days. */
export function ageLabel(d: number): string {
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

// ── Arrival cue: fire the flash+chime once per genuinely-new IP ──────────────

function announcedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ANNOUNCED) || "[]"));
  } catch {
    return new Set();
  }
}
function markAnnounced(ips: string[]): void {
  try {
    const s = announcedSet();
    for (const ip of ips) s.add(ip);
    localStorage.setItem(ANNOUNCED, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Day-0 nodes that haven't had their arrival cue yet; marks them so it fires once. */
export function takeUnannouncedArrivals(known: Known = loadKnown(), now = Date.now()): NewNode[] {
  const seen = announcedSet();
  const fresh = newNodes(known, now, Infinity).filter((n) => n.ageDays === 0 && !seen.has(n.ip));
  if (fresh.length) markAnnounced(fresh.map((n) => n.ip));
  return fresh;
}
