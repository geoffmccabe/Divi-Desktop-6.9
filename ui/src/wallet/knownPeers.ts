// Peers we've seen before, so the map has something to show at startup (faint
// grey) before live peers reconnect. Stored locally for now; a per-user Supabase
// copy can sync this across devices once the login layer exists. Entries that
// haven't been seen in a while are treated as dead and pruned.

// The broader Divi network we've seen over 90 days — shared across nodes, since
// it's the same network whichever node you view from. (Your own node and its
// direct peers are what change on switch; those are handled in NetworkMap.)
const KEY = "dd69.knownPeers";
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days → considered dead, removed

export interface KnownPeer {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  cc?: string; // ISO-2 country code, for "City, US" labels
  lastSeen: number;
  /** Last user-agent this node advertised (getpeerinfo subver). Remembered so
   *  the node's TYPE (nodeTypes.ts) still shows when it's offline and no longer
   *  a live peer. Optional — older stored entries won't have it. */
  subver?: string;
}
export type Known = Record<string, KnownPeer>;

function parse(raw: string | null): Known {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function loadKnown(): Known {
  const now = Date.now();
  // Start from the shared store, then UNION IN any leftover per-node stores
  // (dd69.knownPeers.desktop / .scan). An earlier version of the map split the
  // network per node; those subsets got stranded there, so the shared list read
  // low and nodes appeared "missing". Folding them back in — keeping the most
  // recent sighting of each IP — recovers the full network and heals the split.
  const k: Known = parse(localStorage.getItem(KEY));
  const baseCount = Object.keys(k).length;
  let changed = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY + ".")) continue; // dd69.knownPeers.<scope>
      const sub = parse(localStorage.getItem(key));
      for (const ip of Object.keys(sub)) {
        if (!k[ip] || (sub[ip]?.lastSeen ?? 0) > (k[ip]?.lastSeen ?? 0)) {
          k[ip] = sub[ip];
          changed = true;
        }
      }
    }
  } catch {
    /* enumerate best-effort */
  }
  // Drop anything not seen in 90 days.
  for (const ip of Object.keys(k)) {
    if (now - (k[ip]?.lastSeen ?? 0) > TTL_MS) {
      delete k[ip];
      changed = true;
    }
  }
  if (changed || Object.keys(k).length !== baseCount) save(k); // heal the shared store
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
  seen: { ip: string; lat: number; lon: number; city?: string; country?: string; cc?: string; subver?: string }[]
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
    k[s.ip] = {
      lat: s.lat,
      lon: s.lon,
      city: s.city,
      country: s.country,
      cc: s.cc,
      lastSeen: now,
      // Keep the last-known subver if this sighting didn't carry one.
      subver: s.subver || k[s.ip]?.subver,
    };
  save(k);
  return k;
}
