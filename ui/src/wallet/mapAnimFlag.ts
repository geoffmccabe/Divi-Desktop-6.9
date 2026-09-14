// ── The v2 animation switch ────────────────────────────────────────────────
//
// The new event-driven animation system runs ALONGSIDE the old polling one and
// is off by default. Cmd/Ctrl-Shift-N flips between them live, with no reload,
// so the two can be compared on the same running node.
//
// Cmd-N was already taken (it toggles the new-install simulator in
// NetworkMap.tsx), which is why this is Cmd-Shift-N.
//
// When the flag is OFF, every v2 code path short-circuits before doing any
// work, so the old behaviour is byte-for-byte what it was.

import { useSyncExternalStore } from "react";
import { clearMapEvents } from "./mapEvents";

const KEY = "dd69.mapAnim.v2";

let on = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

const subs = new Set<() => void>();

export function isMapAnimV2(): boolean {
  return on;
}

export function setMapAnimV2(next: boolean) {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* private mode — the flag just won't persist */
  }
  // Never carry a half-finished animation across a switch.
  clearMapEvents();
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** React binding: re-renders the component whenever the flag flips. */
export function useMapAnimV2(): boolean {
  return useSyncExternalStore(subscribe, isMapAnimV2, () => false);
}

let installed = false;

/** Global Cmd/Ctrl-Shift-N listener. Safe to call more than once. */
export function installMapAnimHotkey() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      setMapAnimV2(!isMapAnimV2());
    }
  });
}
