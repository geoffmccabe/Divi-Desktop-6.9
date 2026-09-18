// ── The supervisor's events, onto the map ──────────────────────────────────
//
// The Rust side reports what IT is doing (see crates/supervisor/src/mapfeed.rs)
// as `dd69://map-event`. It deliberately sends meaning only — which trigger,
// which node, a line of detail — and never a coordinate, because the supervisor
// has no geography and should not be inventing any. Placing the event on the
// map is this file's job, using the locations the map has already verified.

import { emitMap, mapSelf, type MapTriggerName, CATALOG } from "./mapEvents";

interface FeedPayload {
  trigger?: string;
  ip?: string | null;
  detail?: string | null;
}

type TauriEventApi = {
  listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
};

/**
 * Start listening. Returns a function that stops. Safe to call when there is no
 * Tauri runtime (the browser build of Divi Rebels), where it simply does
 * nothing rather than throwing.
 */
export function startMapFeedBridge(
  /** Where a given node is, when the map knows. */
  locate: (ip: string) => { lat: number; lon: number } | null,
): () => void {
  const ev = (window as unknown as { __TAURI__?: { event?: TauriEventApi } }).__TAURI__?.event;
  if (!ev) return () => {};

  let stop: (() => void) | null = null;
  let dead = false;

  ev.listen("dd69://map-event", (e) => {
    const p = (e.payload ?? {}) as FeedPayload;
    const trigger = p.trigger;
    // Only triggers the catalog actually knows. An unrecognised name from a
    // newer Rust build is ignored rather than crashing the map.
    if (!trigger || !(trigger in CATALOG)) return;

    const at = p.ip ? locate(p.ip) : mapSelf();
    // No known location means there is nothing honest to draw. Dropping it is
    // correct: a guessed position would be worse than no animation.
    if (!at) return;

    emitMap(trigger as MapTriggerName, {
      lat: at.lat,
      lon: at.lon,
      ip: p.ip ?? undefined,
      label: p.detail ?? undefined,
    });
  })
    .then((un) => {
      if (dead) {
        un();
        return;
      }
      stop = un;
    })
    .catch(() => {
      /* no listener; the map just won't show supervisor events */
    });

  return () => {
    dead = true;
    try {
      stop?.();
    } catch {
      /* already gone */
    }
  };
}
