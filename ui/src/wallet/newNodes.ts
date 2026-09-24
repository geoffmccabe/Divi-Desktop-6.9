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

// A dev-only test spiral used to point at one specific desktop node (in Heredia,
// Costa Rica) as a demo "brand-new node". It was hardcoded and injected into
// every install's saved peer data, so EVERY user — wherever they actually are —
// saw a phantom node in Costa Rica and read it as "their node". That is wrong to
// ship. We no longer seed it, and `cleanupLegacySeed` removes it from any machine
// that already saved it. A genuinely-live node at this IP will simply reappear
// through the normal peer path with its real, geolocated position.
const LEGACY_SEED_IP = "201.206.191.234";
const SEED_CLEANUP_FLAG = "dd69.newNodes.seedCleanup.v1";
// The exact coordinates we used to inject, so cleanup only removes OUR fake
// entry from knownPeers and never a real peer that happens to share the IP.
const LEGACY_SEED_LAT = 9.9985;
const LEGACY_SEED_LON = -84.1171;

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
 * Remove the old hardcoded Costa Rica test node from a machine that already
 * saved it (registry, arrival-announcements, and the injected knownPeers entry).
 * Runs once (flag-guarded). We only delete the knownPeers entry when its saved
 * coordinates match the exact ones we injected, so a genuinely-live peer at the
 * same IP is left untouched and will keep its real, geolocated position.
 */
export function cleanupLegacySeed(): void {
  try {
    if (localStorage.getItem(SEED_CLEANUP_FLAG)) return;
  } catch {
    return;
  }
  // registry
  const reg = loadReg();
  if (reg[LEGACY_SEED_IP] != null) {
    delete reg[LEGACY_SEED_IP];
    saveReg(reg);
  }
  // arrival announcements
  try {
    const s = announcedSet();
    if (s.delete(LEGACY_SEED_IP)) {
      localStorage.setItem(ANNOUNCED, JSON.stringify([...s]));
    }
  } catch {
    /* ignore */
  }
  // the injected knownPeers entry — only if it's OUR fake (coords match)
  try {
    const k = loadKnown();
    const e = k[LEGACY_SEED_IP];
    if (e && Math.abs(e.lat - LEGACY_SEED_LAT) < 0.001 && Math.abs(e.lon - LEGACY_SEED_LON) < 0.001) {
      delete k[LEGACY_SEED_IP];
      localStorage.setItem("dd69.knownPeers", JSON.stringify(k));
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(SEED_CLEANUP_FLAG, "1");
  } catch {
    /* ignore */
  }
}

/**
 * One-time seed. Registers EVERY node known today as "existing" (first seen far
 * in the past ⇒ no spiral). Runs only when the registry is empty, so it never
 * re-freezes a genuine new node. Reads knownPeers straight from disk (a stable
 * 92-ish), so it can't be fooled by a momentarily-thin in-memory copy.
 *
 * No demo/test node is seeded here: a "new node" spiral now only ever comes from
 * a genuinely newly-seen peer, so the map reflects the real network for everyone.
 */
export function baselineNewNodes(now = Date.now()): void {
  cleanupLegacySeed(); // heal installs that already saved the old Costa Rica seed
  const reg = loadReg();
  const old = now - (NEW_DAYS + 1) * DAY_MS; // older than the window ⇒ not new
  if (Object.keys(reg).length === 0) {
    const k = loadKnown();
    for (const ip of Object.keys(k)) reg[ip] = old;
    saveReg(reg);
  }
  rebaselineAfterCrawl(reg, old);
}

/* ── ONE-TIME RESET AFTER THE NETWORK CRAWL ──────────────────────────────
   The seed above only runs on a brand-new install. The U-key crawl then
   started asking every peer for ITS peers, and an install that had known
   about ninety nodes suddenly learned of hundreds -- every one of them
   registered "first seen today", every one of them a spiral. Geoff,
   2026-Sep-22: "hundreds of them are showing as spirals on the map and it's
   ruining the node map."

   So, once per install: everything known at this moment becomes "existing".
   From here on a spiral means a node this wallet has genuinely never seen
   before. Guarded by a flag so it can never re-freeze a real newcomer, and
   the flag is versioned so a future reset is one line. */
/* v3, 2026-Sep-24: it happened again. The crawl learns addresses from OTHER
   nodes' peer lists and every one of them was registered "first seen today"
   on hearing about it, alive or not. Geoff: "very covered with spirals
   again". So a second reset, and the rule that stops a third: an address is
   registered only when it is VERIFIED alive (a real peer, or it answered a
   probe), never on merely being heard of. A spiral now means a live node
   this wallet had never seen before, which is what it was always meant to
   mean. */
const REBASELINE_FLAG = "dd69.newNodes.rebaseline.v3";

function rebaselineAfterCrawl(reg: Reg, old: number): void {
  try {
    if (localStorage.getItem(REBASELINE_FLAG)) return;
  } catch {
    return;
  }
  for (const ip of Object.keys(reg)) reg[ip] = old;
  for (const ip of Object.keys(loadKnown())) reg[ip] = old;
  saveReg(reg);
  // No arrival cue for any of them either: they did not arrive, we noticed.
  try {
    localStorage.setItem(ANNOUNCED, JSON.stringify(Object.keys(reg)));
    localStorage.setItem(REBASELINE_FLAG, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
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
/**
 * `limit` was 10, from when new nodes trickled in one or two at a time from our
 * own peers. A discovery run now returns a hundred or more at once, so all but
 * ten of them appeared as ordinary dots and the arrival was invisible.
 */
export function newNodes(known: Known = loadKnown(), now = Date.now(), limit = 250): NewNode[] {
  const reg = loadReg();
  const out: NewNode[] = [];
  for (const [ip, firstSeen] of Object.entries(reg)) {
    const d = ageDays(firstSeen, now);
    if (d >= NEW_DAYS) continue;
    // Need a location to place it; skip any node we can't position.
    const loc = known[ip];
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
