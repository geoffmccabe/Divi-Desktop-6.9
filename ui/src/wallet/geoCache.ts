import { geolocateIps, type Geo } from "./api";

// IP→location cache. IPs rarely move, so we look each up once and keep it, which
// keeps calls to the free geo service to a minimum.
const KEY = "dd69.geoCache";

type Cache = Record<string, Geo>;

function load(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function save(c: Cache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

/// Return cached geos immediately, and look up any unknown IPs (updating the
/// cache). `onUpdate` fires with the merged map once new lookups return.
export async function resolveGeos(ips: string[], onUpdate: (m: Cache) => void): Promise<Cache> {
  const cache = load();
  // Entries cached before we recorded the country code are refreshed once, so
  // the map can label a node "Dallas, US" instead of just "United States".
  const missing = ips.filter((ip) => !cache[ip] || cache[ip].countryCode === undefined);
  onUpdate(cache);
  if (missing.length === 0) return cache;
  try {
    // The geo service takes 100 IPs per call, so walk through in chunks rather
    // than silently losing everything past the first hundred.
    for (let i = 0; i < missing.length; i += 100) {
      const found = await geolocateIps(missing.slice(i, i + 100));
      for (const g of found) cache[g.ip] = { ...g, countryCode: g.countryCode ?? "" };
      save(cache);
      onUpdate({ ...cache });
    }
  } catch {
    /* leave cache as-is; unresolved IPs simply aren't plotted */
  }
  return cache;
}
