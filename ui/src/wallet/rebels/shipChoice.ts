// Which ship the player has chosen, and telling the rest of the game about it.
//
// The badge in the corner of the cockpit and the turntable in the Market are
// two views of one decision, so the decision lives here rather than inside
// either of them. Saved, because a ship you picked yesterday should still be
// yours today, and announced on a window event so the badge changes the moment
// the choice does rather than on the next reload — the same pattern the wallet
// already uses for the node's identity.

const KEY = "dd69.rebels.ship";
const EVENT = "dd69-rebels-ship-changed";

/** The hull the game starts everyone on. */
export const DEFAULT_SHIP = "space_SM_Ship_Fighter_01";

export function loadShip(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && /^space_SM_Ship_[A-Za-z0-9_]+$/.test(v)) return v;
  } catch {
    /* no storage; the default is fine */
  }
  return DEFAULT_SHIP;
}

export function saveShip(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* storage full */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Called whenever the choice changes, from anywhere. */
export function subscribeShip(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
