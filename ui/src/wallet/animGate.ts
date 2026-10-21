/* Should the map animate right now?
 *
 * 2026-Oct-21: the wallet's web view had used most of a CPU core for a day
 * and a half on Geoff's Mac. The globe (a WebGL scene), its arc overlay and
 * the flat map each run a requestAnimationFrame loop, and the web view only
 * stops those when the window is minimised or fully covered. Behind a few
 * other windows, still partly visible, it kept drawing at full rate for
 * nobody. The wallet boots into the map, so this was the normal state.
 *
 * Rule: animate while the window is focused, or for a short grace after it
 * loses focus (so a click into another app does not freeze the picture mid
 * motion). Once the page is hidden or the window has been in the background
 * for a few seconds, every loop idles: at most one cheap tick a second to
 * notice when to wake up, no drawing. Focus or visibility brings it all back
 * at once. */

const GRACE_MS = 4000;
const listeners = new Set<(active: boolean) => void>();
let focused = typeof document === "undefined" ? true : document.hasFocus();
let hidden = typeof document === "undefined" ? false : document.visibilityState === "hidden";
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let active = true;

function recompute() {
  const next = !hidden && focused;
  if (next === active) return;
  active = next;
  for (const l of listeners) {
    try { l(active); } catch { /* a listener's problem, not ours */ }
  }
}

function onBlur() {
  focused = false;
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = setTimeout(() => { graceTimer = null; recompute(); }, GRACE_MS);
}
function onFocus() {
  focused = true;
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  recompute();
}
function onVisibility() {
  hidden = document.visibilityState === "hidden";
  recompute();
}

if (typeof window !== "undefined") {
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
}

/** True while someone can be looking at the map. */
export function mapAnimActive(): boolean {
  return active;
}

/** Called with the new state whenever it flips. Returns an unsubscribe. */
export function onMapAnimChange(cb: (active: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The idle heartbeat: how long a paused loop sleeps between checks. */
export const IDLE_TICK_MS = 1000;

/** Test hook: drive the state without real window events. */
export function _setForTest(next: { focused?: boolean; hidden?: boolean }): void {
  if (next.focused !== undefined) focused = next.focused;
  if (next.hidden !== undefined) hidden = next.hidden;
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  recompute();
}
