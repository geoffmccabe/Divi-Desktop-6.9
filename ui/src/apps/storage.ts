// Per-app key-value storage.
//
// Namespaced by app id so one app can never read another's data, size-capped so a
// misbehaving app cannot fill the disk, and kept entirely separate from the
// wallet's own `dd69.*` keys so an app can never read or clobber wallet state.
//
// This is local convenience storage, not a database and not a secret store. An
// app author should assume it can be cleared.

const PREFIX = "dd69.app.";
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const MAX_KEYS = 200;
const KEY_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

export class StorageError extends Error {}

interface Op {
  op?: string;
  key?: string;
  value?: unknown;
}

function bucketKey(appId: string): string {
  return PREFIX + appId;
}

function load(appId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(bucketKey(appId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A corrupt bucket is the app's problem, not the wallet's. Start clean
    // rather than throwing on every subsequent call.
    return {};
  }
}

function save(appId: string, data: Record<string, unknown>): void {
  const serialised = JSON.stringify(data);
  if (serialised.length > MAX_TOTAL_BYTES) {
    throw new StorageError("this app has used all of its storage");
  }
  try {
    localStorage.setItem(bucketKey(appId), serialised);
  } catch {
    throw new StorageError("could not save, storage is full");
  }
}

function checkKey(key: unknown): string {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw new StorageError("key must be 1 to 64 characters, letters/numbers/._-");
  }
  return key;
}

export function appStorage(appId: string) {
  return {
    async handle(p: Op): Promise<unknown> {
      switch (p.op) {
        case "get": {
          const key = checkKey(p.key);
          const data = load(appId);
          return { value: key in data ? data[key] : null };
        }
        case "set": {
          const key = checkKey(p.key);
          const encoded = JSON.stringify(p.value ?? null);
          if (encoded.length > MAX_VALUE_BYTES) {
            throw new StorageError("that value is too large to store");
          }
          const data = load(appId);
          if (!(key in data) && Object.keys(data).length >= MAX_KEYS) {
            throw new StorageError(`an app may store at most ${MAX_KEYS} keys`);
          }
          data[key] = JSON.parse(encoded);
          save(appId, data);
          return { saved: true };
        }
        case "remove": {
          const key = checkKey(p.key);
          const data = load(appId);
          delete data[key];
          save(appId, data);
          return { removed: true };
        }
        case "keys":
          return { keys: Object.keys(load(appId)) };
        case "clear":
          localStorage.removeItem(bucketKey(appId));
          return { cleared: true };
        default:
          throw new StorageError("storage op must be get, set, remove, keys or clear");
      }
    },
  };
}

/** Used when an app is uninstalled, so nothing is left behind. */
export function wipeAppStorage(appId: string): void {
  localStorage.removeItem(bucketKey(appId));
}
