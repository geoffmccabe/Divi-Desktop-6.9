// Peers we've seen before, so the map has something to show at startup (faint
// grey) before live peers reconnect. Stored locally for now; a per-user Supabase
// copy can sync this across devices once the login layer exists. Entries that
// haven't been seen in a while are treated as dead and pruned.

// The broader Divi network we've seen over 30 days — shared across nodes, since
// it's the same network whichever node you view from. (Your own node and its
// direct peers are what change on switch; those are handled in NetworkMap.)
const KEY = "dd69.knownPeers";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days → considered dead, removed

export interface KnownPeer {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  cc?: string; // ISO-2 country code, for "City, US" labels
  lastSeen: number;
}
export type Known = Record<string, KnownPeer>;

export function loadKnown(): Known {
  let k: Known = {};
  try {
    k = JSON.parse(localStorage.getItem(KEY) || "{}");
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
  if (changed) save(k);
  return k;
}

function save(k: Known) {
  try {
    localStorage.setItem(KEY, JSON.stringify(k));
  } catch {
    /* storage unavailable */
  }
}

/// Record the currently-seen located peers, refreshing their lastSeen.
export function recordKnown(
  prev: Known,
  seen: { ip: string; lat: number; lon: number; city?: string; country?: string; cc?: string }[]
): Known {
  const now = Date.now();
  // Merge onto what is ON DISK, not just the caller's in-memory copy.
  //
  // This write used to be `{...prev}`. If a remount or a node switch handed us a
  // `prev` that was still empty or partial — the map's ref starts as {} and is
  // filled a tick later — the save would overwrite the whole accumulated network
  // with only the peers seen in that one poll. That is how a 92-node history
  // collapsed to roughly the current peer count. Folding the stored copy in
  // first means a stale caller can only ever ADD nodes, never silently drop them;
  // the 30-day prune in loadKnown remains the single place entries are removed.
  const k = { ...loadKnown(), ...prev };
  for (const s of seen)
    k[s.ip] = { lat: s.lat, lon: s.lon, city: s.city, country: s.country, cc: s.cc, lastSeen: now };
  save(k);
  return k;
}
