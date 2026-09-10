// Which node the wallet is talking to, on the FRONT end.
//
// The backend decides (nodes.json, NodeConfig::load); this is the mirror the
// interface needs for two things: keying caches that belong to one node and
// not another (a transaction list is a wallet's, and each node is a wallet),
// and telling everyone when the node changes so nothing stale stays on screen.
//
// The id is kept in local storage so a cache key can be built synchronously
// on first render, before the backend has been asked.

import { listNodes } from "./api";

const KEY = "dd69.activeNode";
let current = "";

export function activeNodeId(): string {
  if (current) return current;
  try { current = localStorage.getItem(KEY) || "desktop"; } catch { current = "desktop"; }
  return current;
}

export function setActiveNodeId(id: string): void {
  current = id || "desktop";
  try { localStorage.setItem(KEY, current); } catch { /* storage blocked */ }
}

/** Ask the backend once at start so the mirror matches nodes.json. */
export function syncActiveNode(): void {
  void listNodes().then((r) => { if (r?.active) setActiveNodeId(r.active); }).catch(() => {});
}

/** A cache key that belongs to the active node. */
export function nodeKey(base: string): string {
  const id = activeNodeId();
  return id === "desktop" ? base : `${base}.${id}`;
}
