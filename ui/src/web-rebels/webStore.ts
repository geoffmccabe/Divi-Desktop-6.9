// The web version's own long-term storage: IndexedDB.
//
// Geoff, 2026-Sep-13: "when users return, even if they haven't signed up yet,
// they still have their Divi, their points, the stuff they've earned. Can you
// leave all of this in indexeddb."
//
// IndexedDB rather than localStorage alone because it is the storage a browser
// treats as the site's real data: larger, and kept when a quick "clear recent
// history" wipes the smaller stores. The game reads its settings synchronously,
// many times a frame in places, so the page loads everything from here ONCE
// before the game starts, keeps it in memory, and writes every change back.
//
// Every function here fails soft. A browser that refuses IndexedDB (a private
// window in some browsers) still plays; it just does not remember.

import type { RebelsStorage } from "../wallet/rebels/platform/platform";

const DB = "divi-rebels";
const STORE = "kv";

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Every key and value kept for this site. Empty when there is no IndexedDB. */
export async function idbAll(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const d = await db();
  if (!d) return out;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        if (typeof cur.value === "string") out.set(String(cur.key), cur.value);
        cur.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

/** Keep one value, or remove it when `value` is null. */
export async function idbPut(key: string, value: string | null): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (value === null) store.delete(key); else store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ---- the game's progress, kept in IndexedDB ----
   What the game calls storage (RebelsStorage): read from memory, written to
   memory, to IndexedDB, and to localStorage as a second copy. */


/** The keys that are a player's progress, as opposed to caches. */
export function isProgressKey(key: string): boolean {
  return key.startsWith("dd69.rebels.") && key !== "dd69.rebels.diag";
}

type Quick = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & { length: number };

/**
 * A synchronous store over a snapshot of IndexedDB.
 *
 * `put` is where a change is written for good (IndexedDB in the page, a spy in a
 * test). localStorage is kept as a second copy so a returning player whose
 * IndexedDB was cleared, but not their localStorage, still finds their things.
 */
export function createWebStorage(
  snapshot: Map<string, string>,
  quick: Quick | null,
  put: (key: string, value: string | null) => void = (k, v) => { void idbPut(k, v); },
): RebelsStorage {
  const mem = new Map(snapshot);
  return {
    getItem(key) {
      return mem.has(key) ? mem.get(key)! : null;
    },
    setItem(key, value) {
      mem.set(key, value);
      try { quick?.setItem(key, value); } catch { /* full or blocked */ }
      put(key, value);
    },
    removeItem(key) {
      mem.delete(key);
      try { quick?.removeItem(key); } catch { /* blocked */ }
      put(key, null);
    },
  };
}

/**
 * Before the game starts: everything IndexedDB holds, with anything only the
 * localStorage copy still has put back into IndexedDB. IndexedDB wins where both
 * hold a key, because it is the copy written last on every change and the one a
 * browser keeps the longest.
 */
export async function hydrateWebStorage(
  quick: Quick | null = safeQuick(),
  all: () => Promise<Map<string, string>> = idbAll,
  put: (key: string, value: string | null) => void = (k, v) => { void idbPut(k, v); },
): Promise<RebelsStorage> {
  const snapshot = await all().catch(() => new Map<string, string>());
  if (quick) {
    try {
      for (let i = 0; i < quick.length; i++) {
        const k = quick.key(i);
        if (!k || !isProgressKey(k) || snapshot.has(k)) continue;
        const v = quick.getItem(k);
        if (v === null) continue;
        snapshot.set(k, v);
        put(k, v);
      }
    } catch { /* blocked */ }
  }
  return createWebStorage(snapshot, quick, put);
}

function safeQuick(): Quick | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
