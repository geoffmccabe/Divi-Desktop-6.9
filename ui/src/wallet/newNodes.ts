// "Newest nodes" — the data + lifecycle behind the map spirals and the
// bottom-right Newest Nodes panel. No drawing here; NetworkMap draws the spiral
// and NewestNodesPanel lists them, both reading from this module so they agree.
//
// A node is "new" for 10 days from the FIRST time we ever recorded its IP
// (KnownPeer.firstSeen). During that window a spiral marks it on the map,
// shrinking each day; after day 10 it becomes an ordinary node.
//
// Honesty: "new" means first seen by OUR node(s) on this date — not "joined the
// network then". A node can be old but new to us. Wording says "first seen".

import { loadKnown, type Known } from "./knownPeers";

export const NEW_DAYS = 10; // spiral lifetime
export const SPIRAL_MAX_PX = 25; // day-0 diameter
const DAY_MS = 24 * 60 * 60 * 1000;

const BASELINED = "dd69.newNodes.baselined"; // one-shot migration flag
const ANNOUNCED = "dd69.newNodes.announced"; // IPs whose arrival cue has fired

// The user's Costa Rica desktop node — seeded as the day-0 test spiral so the
// feature is visibly working from the moment it ships (it is the user's OWN
// node, not a peer, so it's injected into the known set here).
const SEED = {
  ip: "201.206.191.234",
  lat: 9.9985,
  lon: -84.1171,
  city: "Heredia",
  country: "Costa Rica",
  cc: "CR",
};

/**
 * Runs once. Freezes every node known today as "existing" (firstSeen far in the
 * past, so none spiral), then seeds the Costa Rica node as brand-new (day 0).
 * After this, recordKnown stamps firstSeen = now on genuinely first-seen IPs.
 *
 * Idempotent via a localStorage flag — it must never re-freeze a real new node.
 */
export function baselineNewNodes(now = Date.now()): void {
  try {
    if (localStorage.getItem(BASELINED)) return;
  } catch {
    return;
  }
  const k = loadKnown();
  const old = now - (NEW_DAYS + 1) * DAY_MS; // older than the window ⇒ not new
  for (const ip of Object.keys(k)) {
    if (k[ip].firstSeen == null) k[ip].firstSeen = old;
  }
  // Seed the test node at day 0 (only if not already a genuine new node).
  const existing = k[SEED.ip];
  k[SEED.ip] = {
    lat: SEED.lat,
    lon: SEED.lon,
    city: SEED.city,
    country: SEED.country,
    cc: SEED.cc,
    lastSeen: now,
    firstSeen: existing?.firstSeen && existing.firstSeen < old ? existing.firstSeen : now,
  };
  try {
    localStorage.setItem("dd69.knownPeers", JSON.stringify(k));
    localStorage.setItem(BASELINED, "1");
    // The seed node counts as already-announced so it doesn't chime on first run.
    markAnnounced([SEED.ip]);
  } catch {
    /* storage unavailable — try again next launch */
  }
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
  const out: NewNode[] = [];
  for (const [ip, kp] of Object.entries(known)) {
    if (kp.firstSeen == null) continue;
    const d = ageDays(kp.firstSeen, now);
    if (d >= NEW_DAYS) continue;
    out.push({
      ip,
      lat: kp.lat,
      lon: kp.lon,
      city: kp.city,
      country: kp.country,
      cc: kp.cc,
      firstSeen: kp.firstSeen,
      ageDays: d,
      diameter: spiralDiameter(kp.firstSeen, now),
    });
  }
  out.sort((a, b) => b.firstSeen - a.firstSeen); // newest first
  return out.slice(0, limit);
}

/** "today" / "yesterday" / "N days ago" for a first-seen date. */
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

/**
 * Given the current known set, return the IPs that are new (day 0) AND have not
 * yet had their arrival cue, and mark them announced so it only fires once.
 * NetworkMap calls this each poll and plays the flash/chime for what comes back.
 */
export function takeUnannouncedArrivals(known: Known = loadKnown(), now = Date.now()): NewNode[] {
  const seen = announcedSet();
  const fresh = newNodes(known, now, Infinity).filter((n) => n.ageDays === 0 && !seen.has(n.ip));
  if (fresh.length) markAnnounced(fresh.map((n) => n.ip));
  return fresh;
}
