// Who the player is, inside the desktop app.
//
// Moved here unchanged from rebelsScores.ts: it reads what the WALLET saved (the
// node's chosen name, or the node's address and country), which only the app
// door may know about. Kept free of any other wallet import so node tests can
// use it to stand in for the app.

import type { RebelsIdentity } from "../platform";

/**
 * Who the player is.
 *
 * The node's own name when its owner has set one, because that is the name
 * they chose to be known by on the map. Otherwise the node's address and
 * country, which is what the map itself falls back to.
 */
export function nodePlayerName(): string {
  try {
    const id = localStorage.getItem("dd69.nodeIdentity");
    if (id) {
      const parsed = JSON.parse(id) as { name?: string };
      const name = (parsed.name ?? "").trim();
      if (name) return name.slice(0, 32);
    }
  } catch {
    /* fall through to the address */
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("dd69.selfGeo.")) continue;
      const g = JSON.parse(localStorage.getItem(k) || "{}") as
        { ip?: string; country?: string };
      if (g.ip) return [g.ip, g.country].filter(Boolean).join(" · ").slice(0, 40);
    }
  } catch {
    /* nothing known */
  }
  return "this node";
}

export const appIdentity: RebelsIdentity = {
  name: () => nodePlayerName(),
  joinFields: (selfIp: string) => ({ node: selfIp || nodePlayerName(), name: nodePlayerName() }),
  /* The node's name: what the account rows have always been filed under. */
  accountKey: () => nodePlayerName(),
};
