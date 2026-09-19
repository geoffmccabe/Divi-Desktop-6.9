// ── Traffic that leaves the Divi network ───────────────────────────────────
//
// The price feed, the IP geolocation lookup and the update check are real
// network calls the app makes on the user's behalf, and none of them used to
// appear on the map. They are drawn in cyan so they read as clearly NOT Divi
// peer traffic.
//
// WHERE THEY ARE DRAWN. Each service's hostname is resolved and that address
// geolocated, exactly as peers are. Nothing is drawn until the real place is
// known.
//
// This replaces a hardcoded point in the mid-Atlantic that stood for "we do
// not know where this is". On screen that is indistinguishable from a real
// node sitting in the ocean, which everything appears to keep contacting — and
// it was reported as exactly that. A marker whose meaning has to be explained
// is not honest, it is just wrong in a way that needs a footnote.

import { emitMap } from "./mapEvents";
import { serviceLocation } from "./api";

export type ExternalService = "price" | "geolocate" | "update" | "assets";

interface Located {
  lat: number;
  lon: number;
  label: string;
}

/** The host each service actually talks to. */
const HOSTS: Record<ExternalService, { host: string; what: string }> = {
  price: { host: "scan.divi.love", what: "DIVI price feed" },
  geolocate: { host: "ip-api.com", what: "IP geolocation lookup" },
  update: { host: "scan.divi.love", what: "Update check" },
  assets: { host: "assets.dreadroot.com", what: "Game assets" },
};

/** Resolved once per run. `null` means "asked, and could not find out". */
const located = new Map<ExternalService, Located | null>();
const inFlight = new Map<ExternalService, Promise<Located | null>>();

function resolve(service: ExternalService): Promise<Located | null> {
  const cached = located.get(service);
  if (cached !== undefined) return Promise.resolve(cached);
  const already = inFlight.get(service);
  if (already) return already;

  const { host, what } = HOSTS[service];
  const p = serviceLocation(host)
    .then((r) => {
      const hit: Located | null =
        r && typeof r.lat === "number" && typeof r.lon === "number"
          ? {
              lat: r.lat,
              lon: r.lon,
              label: `${what} (${[r.city, r.country].filter(Boolean).join(", ") || host})`,
            }
          : null;
      located.set(service, hit);
      return hit;
    })
    .catch(() => {
      located.set(service, null);
      return null;
    })
    .finally(() => inFlight.delete(service));

  inFlight.set(service, p);
  return p;
}

/**
 * Wrap a real outbound call so the map shows it happening: a cyan arc out, then
 * cyan rings if it answered or red rings if it did not.
 *
 * The promise is returned untouched, so callers are unaffected and this can
 * neither change behaviour nor swallow an error. If the service's location is
 * not known the call still happens; it simply is not drawn, because inventing
 * a position is what caused the phantom node in the Atlantic.
 */
export function traceExternal<T>(service: ExternalService, p: Promise<T>): Promise<T> {
  void resolve(service).then((at) => {
    if (!at) return;
    emitMap("external.seek", { lat: at.lat, lon: at.lon, label: at.label });
    p.then(
      () => emitMap("external.ok", { lat: at.lat, lon: at.lon, delayMs: 900, label: at.label }),
      () => emitMap("external.fail", { lat: at.lat, lon: at.lon, delayMs: 900, label: at.label }),
    );
  });
  return p;
}
