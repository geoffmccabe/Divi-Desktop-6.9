// A one-line store for the health bar that flashes up when the player is hit.
//
// Lifted straight from DreadRoot's healthBarStore, which does the same job for
// the same reason: the bar is raised by whatever DEALS the damage, and read by
// a component that is otherwise invisible. Anything else means the HUD polling
// the shield every frame and guessing when it went down, which cannot tell a
// hit apart from the slow repair running backwards.

let state = { current: 0, max: 1, at: -1 };
const subs = new Set<() => void>();

/** Show the bar now, with what is left and out of what. */
export function pulseHealth(current: number, max: number): void {
  state = { current: Math.max(0, current), max: Math.max(1, max), at: performance.now() };
  subs.forEach((f) => f());
}

export function getHealthPulse() { return state; }

export function subscribeHealth(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
