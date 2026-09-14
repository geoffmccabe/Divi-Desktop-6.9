// ── Traffic that leaves the Divi network ───────────────────────────────────
//
// The price feed, the IP geolocation lookup and the update check are all real
// network calls the app makes on the user's behalf, and until now none of them
// appeared on the map at all. They are drawn in cyan so they read as clearly
// NOT Divi peer traffic.
//
// HONESTY NOTE ON LOCATIONS: we know where some of these services actually are
// and not others. Where we know, we use the real place. Where we don't, we use
// one shared symbolic anchor out in the Atlantic and SAY SO in the label,
// rather than inventing a plausible-looking city and quietly misleading people.

import { emitMap } from "./mapEvents";
import { isMapAnimV2 } from "./mapAnimFlag";

export type ExternalService = "price" | "geolocate" | "update" | "assets";

interface ServiceAnchor {
  lat: number;
  lon: number;
  label: string;
  /** False when the coordinate is symbolic rather than the real location. */
  known: boolean;
}

// The symbolic "somewhere out on the internet" anchor: mid-Atlantic, well clear
// of any real node, so it can never be mistaken for a Divi node's location.
const OFFSHORE = { lat: 30, lon: -40 };

const ANCHORS: Record<ExternalService, ServiceAnchor> = {
  // scan.divi.love sits behind Cloudflare, but the real origin is our own
  // fasthosts box in London — the same coordinate NetworkMap already hard-sets
  // for the snapshot source, so the two agree.
  update: { lat: 51.5074, lon: -0.1278, label: "Update check (scan.divi.love, London)", known: true },
  price: { ...OFFSHORE, label: "DIVI price feed (location not known)", known: false },
  geolocate: { ...OFFSHORE, label: "IP geolocation lookup (location not known)", known: false },
  assets: { ...OFFSHORE, label: "Game assets (CDN, location not known)", known: false },
};

/**
 * Wrap a real outbound call so the map shows it happening: a cyan arc on the
 * way out, then cyan rings if it answered or red rings if it didn't. The
 * promise is returned untouched, so callers are completely unaffected and the
 * wrapper cannot change behaviour or swallow an error.
 */
export function traceExternal<T>(service: ExternalService, p: Promise<T>): Promise<T> {
  if (!isMapAnimV2()) return p;
  const a = ANCHORS[service];
  emitMap("external.seek", { lat: a.lat, lon: a.lon, label: a.label });
  return p.then(
    (v) => {
      emitMap("external.ok", { lat: a.lat, lon: a.lon, delayMs: 900, label: a.label });
      return v;
    },
    (err) => {
      emitMap("external.fail", { lat: a.lat, lon: a.lon, delayMs: 900, label: a.label });
      throw err;
    },
  );
}
