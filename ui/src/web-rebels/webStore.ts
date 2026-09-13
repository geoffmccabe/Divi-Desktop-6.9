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
