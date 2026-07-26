// Client for the scanner node-identity service (docs/NODE-IDENTITY-PLAN.md,
// ops/scanner/divi-identity.py). Publishes this node's public persona, reads the
// network manifest, and caches avatar media by its hash so nothing is downloaded
// twice.
//
// The service is not deployed yet, so BASE is a placeholder. When it goes live
// behind Cloudflare, set BASE to the real host and every call here works
// unchanged. Until then `enabled()` is false and callers no-op.

import { invoke } from "../tauri";

// Set this to the deployed host (e.g. "https://nodes.divi.love" or
// "https://ai.divi.love/identity") once the scanner service is live.
const BASE = "";

export function enabled(): boolean {
  return BASE.length > 0;
}

// ── the record we publish ────────────────────────────────────────────────────
// MUST match the server's `canonical()` exactly: same fields, sorted keys, no
// spaces. If these drift, signatures won't verify. Media is referenced only by
// hash — the bytes are uploaded separately and never signed over.
export interface IdentityRecord {
  name: string;
  description: string;
  mediaHash: string; // "" if none
  chatter: number; // 0–255
  ts: number; // unix seconds; the server rejects anything stale
}

function canonical(r: IdentityRecord): string {
  // JSON.stringify with sorted keys and no whitespace, matching Python's
  // json.dumps(..., sort_keys=True, separators=(",", ":")).
  const o = { chatter: r.chatter, description: r.description, mediaHash: r.mediaHash, name: r.name, ts: r.ts };
  return JSON.stringify(o);
}

// ── auth: wallet signature OR SSO token ──────────────────────────────────────
export type Auth = { kind: "wallet" } | { kind: "sso"; token: string };

async function authHeaders(record: IdentityRecord, auth: Auth): Promise<Record<string, string>> {
  if (auth.kind === "sso") return { Authorization: `Bearer ${auth.token}` };
  // Wallet: sign the canonical record with the node's address. Requires the
  // wallet unlocked — the caller surfaces the passphrase flow on failure.
  const address = await invoke<string | null>("signing_address");
  if (!address) throw new Error("No signing address — is the node reachable?");
  const signature = await invoke<string>("wallet_sign", { address, message: canonical(record) });
  return { "X-Divi-Address": address, "X-Divi-Signature": signature };
}

// ── publish / revoke ─────────────────────────────────────────────────────────
export async function publishIdentity(
  fields: { name: string; description: string; mediaHash: string; chatter: number },
  auth: Auth,
): Promise<void> {
  if (!enabled()) throw new Error("Network publishing isn't available yet.");
  // Apply the SAME limits the server's clean_record() applies, BEFORE signing —
  // otherwise the server verifies the signature against a truncated record that
  // no longer matches what we signed, and it fails. (name 64, description 1000,
  // chatter 0–255.)
  const record: IdentityRecord = {
    name: fields.name.slice(0, 64),
    description: fields.description.slice(0, 1000),
    mediaHash: fields.mediaHash,
    chatter: Math.max(0, Math.min(255, Math.trunc(fields.chatter))),
    ts: Math.floor(Date.now() / 1000),
  };
  const res = await fetch(`${BASE}/identity/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(record, auth)) },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Publish failed (${res.status}): ${await res.text()}`);
}

export async function revokeIdentity(auth: Auth): Promise<void> {
  if (!enabled()) return;
  const stub: IdentityRecord = { name: "", description: "", mediaHash: "", chatter: 0, ts: Math.floor(Date.now() / 1000) };
  await fetch(`${BASE}/identity/publish`, { method: "DELETE", headers: await authHeaders(stub, auth) });
}

/** Upload avatar bytes; returns the content hash to put in the record. */
export async function uploadMedia(blob: Blob, auth: Auth): Promise<string> {
  if (!enabled()) throw new Error("Network publishing isn't available yet.");
  // Media upload needs a valid owner but no specific record — sign a bare stamp.
  const stamp: IdentityRecord = { name: "", description: "", mediaHash: "", chatter: 0, ts: Math.floor(Date.now() / 1000) };
  const res = await fetch(`${BASE}/identity/media`, {
    method: "POST",
    headers: { "Content-Type": blob.type, ...(await authHeaders(stamp, auth)) },
    body: blob,
  });
  if (!res.ok) throw new Error(`Media upload failed (${res.status})`);
  return (await res.json()).hash as string;
}

// ── read the network ─────────────────────────────────────────────────────────
export interface ManifestEntry {
  key: string; // "divi:<addr>" or "sso:<id>"
  ip: string | null;
  name: string;
  mediaHash: string;
  chatter: number;
  updated: number;
}

export async function fetchManifest(): Promise<ManifestEntry[]> {
  if (!enabled()) return [];
  const res = await fetch(`${BASE}/identity/manifest`);
  if (!res.ok) return [];
  return (await res.json()).identities ?? [];
}

// ── media cache keyed by hash — download each file at most once, ever ─────────
// The URL is the hash, so a cached blob stays valid forever: a changed avatar is
// a different hash, hence a different key. Its own database ("dd69id") so it
// never collides with nodeIdentity's "dd69" version.
const MEDIA_DB = "dd69id";
const MEDIA_STORE = "identityMedia";

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(hash: string): Promise<Blob | null> {
  try {
    const db = await openMediaDb();
    const blob = await new Promise<Blob | null>((resolve) => {
      const r = db.transaction(MEDIA_STORE, "readonly").objectStore(MEDIA_STORE).get(hash);
      r.onsuccess = () => resolve((r.result as Blob) ?? null);
      r.onerror = () => resolve(null);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

async function putCached(hash: string, blob: Blob): Promise<void> {
  try {
    const db = await openMediaDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MEDIA_STORE, "readwrite");
      tx.objectStore(MEDIA_STORE).put(blob, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* cache is best-effort */
  }
}

/**
 * An object URL for a node's avatar by hash. Served from the local cache if we
 * already hold that exact hash; otherwise fetched once and cached. Returns null
 * if there is no media or the fetch fails. Caller revokes the URL when done.
 */
export async function mediaByHash(hash: string): Promise<string | null> {
  if (!hash) return null;
  let blob = await getCached(hash);
  if (!blob) {
    if (!enabled()) return null;
    try {
      const res = await fetch(`${BASE}/identity/media/${hash}`);
      if (!res.ok) return null;
      blob = await res.blob();
      // Trust-but-note: the URL is the hash; a well-behaved server returns
      // matching bytes. We don't re-hash here (cost), relying on the immutable
      // content-addressed contract.
      await putCached(hash, blob);
    } catch {
      return null;
    }
  }
  return URL.createObjectURL(blob);
}
