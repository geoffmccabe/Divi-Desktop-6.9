// A tiny bridge so the peer count in the corner reacts the INSTANT the map sees
// a peer connect, rather than waiting for its own status poll to come round.
//
// Before this, the map and the status panel each polled the node separately, so
// a node could turn pink on the map and the Peers count would sit unchanged for
// up to five seconds. Same fact, two clocks. Now the map announces what it saw
// and the panel reacts immediately.

type Cb = (count: number) => void;

const subs = new Set<Cb>();

/** Called by whoever fetched a fresh peer list. */
export function emitPeerCount(count: number) {
  for (const cb of [...subs]) {
    try {
      cb(count);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

export function onPeerCount(cb: Cb): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
