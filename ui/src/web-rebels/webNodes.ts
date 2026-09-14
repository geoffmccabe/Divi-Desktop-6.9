// The towers on the web globe.
//
// In the app they are the player's own node's peers. On the web there is no
// node, so they are the network as the Scanner has seen it over the last month
// (its `scan_known` list), fetched through our own small server because the
// Scanner does not let other sites read it directly. The Scanner itself is home:
// every web player launches from it.

import type { GlobePoint } from "../wallet/GlobeMap";

/** The Scanner node, in London. Where web players launch from. */
export const SCANNER: GlobePoint = {
  ip: "109.228.38.104", lat: 51.5074, lng: -0.1278, kind: "self", city: "London", country: "United Kingdom",
};

/** How many of the most recently seen nodes are drawn as the Scanner's own
 *  peers (with the double-helix links). The rest are the wider network. */
const PEERS = 24;
const MOST = 400;

export interface KnownNode {
  ip: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  lastSeen?: number;
}

/** The Scanner's list, as towers: the Scanner first as home, then the rest,
 *  newest first. Anything without a usable position is left out. */
export function towersFrom(list: unknown): GlobePoint[] {
  const rows = Array.isArray(list) ? (list as KnownNode[]) : [];
  const good = rows
    .filter((r) => r && typeof r.ip === "string" && r.ip !== SCANNER.ip
      && Number.isFinite(r.lat) && Number.isFinite(r.lon)
      && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .slice(0, MOST);
  const seen = new Set<string>();
  const towers: GlobePoint[] = [SCANNER];
  for (const r of good) {
    if (seen.has(r.ip)) continue;
    seen.add(r.ip);
    towers.push({
      ip: r.ip, lat: r.lat, lng: r.lon,
      kind: towers.length <= PEERS ? "peer" : "net",
      city: r.city, country: r.country,
    });
  }
  return towers;
}

/** Fetch the towers. On any failure, the Scanner alone: the game still opens
 *  and still launches from London. */
export async function loadTowers(base: string, fetchFn: typeof fetch = fetch): Promise<GlobePoint[]> {
  try {
    const r = await fetchFn(`${base}api/nodes`);
    if (!r.ok) return [SCANNER];
    return towersFrom(await r.json());
  } catch {
    return [SCANNER];
  }
}
