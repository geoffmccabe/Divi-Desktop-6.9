// Peers we've seen before, so the map has something to show at startup (faint
// grey) before live peers reconnect. Stored locally for now; a per-user Supabase
// copy can sync this across devices once the login layer exists. Entries that
// haven't been seen in a while are treated as dead and pruned.

// Scoped per active node (Desktop, DIVI LOVE SCAN, …) so each node keeps its own
// map view. Switching nodes then shows that node's peers, not a union of both.
const KEY = "dd69.knownPeers";
const keyFor = (scope: string) => `${KEY}.${scope || "desktop"}`;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days → considered dead, removed

export interface KnownPeer {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  lastSeen: number;
}
export type Known = Record<string, KnownPeer>;

export function loadKnown(scope: string): Known {
  let k: Known = {};
  try {
    k = JSON.parse(localStorage.getItem(keyFor(scope)) || "{}");
  } catch {
    k = {};
  }
  const now = Date.now();
  let changed = false;
  for (const ip of Object.keys(k)) {
    if (now - (k[ip]?.lastSeen ?? 0) > TTL_MS) {
      delete k[ip];
      changed = true;
    }
  }
  if (changed) save(scope, k);
  return k;
}

function save(scope: string, k: Known) {
  try {
    localStorage.setItem(keyFor(scope), JSON.stringify(k));
  } catch {
    /* storage unavailable */
  }
}

/// Record the currently-seen located peers, refreshing their lastSeen.
export function recordKnown(
  scope: string,
  prev: Known,
  seen: { ip: string; lat: number; lon: number; city?: string; country?: string }[]
): Known {
  const now = Date.now();
  const k = { ...prev };
  for (const s of seen) k[s.ip] = { lat: s.lat, lon: s.lon, city: s.city, country: s.country, lastSeen: now };
  save(scope, k);
  return k;
}
