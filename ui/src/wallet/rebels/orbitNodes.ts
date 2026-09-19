// The node list Orbit mode flies over.
//
// Deliberately the SAME data the Node Map uses rather than a second source of
// truth: `dd69.knownPeers` for the network we have seen over 90 days, and the
// `dd69.selfGeo.*` entry for this wallet's own node. Both are plain localStorage
// and neither needs the node to be running, so the game opens instantly and
// works offline, which matters because a game that waits on RPC before it will
// start is a game nobody plays twice.

import { loadKnown, loadMyIps } from "../knownPeers";

export type NodeKind = "self" | "peer" | "net";

export interface OrbitNode {
  ip: string;
  lat: number;
  lon: number;
  kind: NodeKind;
  city?: string;
  country?: string;
  /** Advertised client string, so a tower can wear its node's class. */
  subver?: string;
}

/**
 * This wallet's own node, if it has ever been located.
 *
 * The Node Map stores it under a per-node scope key, and rather than duplicate
 * that scoping rule (which would quietly disagree with it the first time either
 * side changed) this reads whichever scope is present. A wallet with two nodes
 * gets whichever it saw last, which is the right answer for "where am I".
 */
function readSelf(): OrbitNode | null {
  let best: OrbitNode | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("dd69.selfGeo.")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const g = JSON.parse(raw) as { ip?: string; lat?: number; lon?: number; city?: string; country?: string };
      if (!g || typeof g.lat !== "number" || typeof g.lon !== "number") continue;
      best = { ip: g.ip || "self", lat: g.lat, lon: g.lon, kind: "self", city: g.city, country: g.country };
    }
  } catch {
    /* storage unavailable, fly without a home tower */
  }
  return best;
}

export interface OrbitWorldData {
  nodes: OrbitNode[];
  /** The tower you launch from, repair at and respawn to. */
  home: OrbitNode | null;
}

/**
 * Every tower to put on the planet, and which one is yours.
 *
 * Two rules carried over from the Node Map, both of which produce phantom
 * towers if dropped: strip every IP this wallet has ever called its own (a VPN
 * or an ISP change otherwise leaves your old addresses standing around as
 * separate nodes), and never let the same IP appear twice.
 */
export function gatherNodes(): OrbitWorldData {
  const mine = loadMyIps();
  const seen = new Set<string>();
  const nodes: OrbitNode[] = [];

  const self = readSelf();
  if (self) {
    seen.add(self.ip);
    nodes.push(self);
  }

  for (const [ip, kp] of Object.entries(loadKnown())) {
    if (seen.has(ip) || mine.has(ip)) continue;
    if (typeof kp.lat !== "number" || typeof kp.lon !== "number") continue;
    seen.add(ip);
    nodes.push({ ip, lat: kp.lat, lon: kp.lon, kind: "net", city: kp.city, country: kp.country, subver: kp.subver });
  }

  return { nodes, home: self };
}

/**
 * Somewhere to launch from when this wallet has never located its own node.
 *
 * A brand new install has an empty map, and refusing to start would be the
 * worst possible first impression. The northernmost known tower is as good a
 * choice as any, and if there are no towers at all the caller flies from a
 * fixed point over the Atlantic.
 */
export function fallbackHome(nodes: OrbitNode[]): OrbitNode | null {
  if (nodes.length === 0) return null;
  return nodes.reduce((a, b) => (b.lat > a.lat ? b : a));
}

/** Great-circle distance in globe units (planet radius 100). */
export function surfaceDistance(aLat: number, aLon: number, bLat: number, bLon: number, R: number): number {
  const d = Math.PI / 180;
  const p1 = aLat * d, p2 = bLat * d;
  const dp = (bLat - aLat) * d, dl = (bLon - aLon) * d;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
