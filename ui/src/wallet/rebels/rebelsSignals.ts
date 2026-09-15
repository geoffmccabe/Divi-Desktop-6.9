// "Something changed": one small store for the game's change signals.
//
// These used to be browser-wide `window` events, with the same "inventory
// changed" name defined twice under two names in two files. A plain module is
// simpler, needs no browser to test, and works the same in every door, including
// a phone shell that has no window events to lean on.
//
// Two signals, and each means "read again":
//   "armoury": points, bought gear, found items, a ship's name or fitted upgrades
//   "ship":    which hull is being flown

export type RebelsSignal = "armoury" | "ship";

const listeners: Record<RebelsSignal, Set<() => void>> = { armoury: new Set(), ship: new Set() };

/** Tell everyone listening that this changed. A listener that throws does not
 *  stop the others. */
export function notify(signal: RebelsSignal): void {
  for (const fn of [...listeners[signal]]) {
    try { fn(); } catch { /* one broken listener must not silence the rest */ }
  }
}

/** Hear about a change. Returns the function that stops listening. */
export function listen(signal: RebelsSignal, fn: () => void): () => void {
  listeners[signal].add(fn);
  return () => { listeners[signal].delete(fn); };
}

/** How many are listening, for tests. */
export function listenerCount(signal: RebelsSignal): number {
  return listeners[signal].size;
}
