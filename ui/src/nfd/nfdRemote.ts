// Getting NFD collections in and out of the database.
//
// GAME AGNOSTIC, like nfdCatalog.ts beside it. The one thing it needs from the
// host game is a way to talk to that game's database, and it takes that as
// TWO FUNCTIONS passed in rather than importing anybody's client. That is the
// whole reason this file can be lifted into Geoff's next game: swap the two
// functions, change nothing else.
//
// THE SPLIT AT THE SEAM. The table keeps `enabled` and `tiers` in their own
// columns, out of the collection JSON, so the database can answer
// "enabled only" and the room can fetch a tier map without downloading the
// art. See supabase/migrations/20261008120000_rebels_nfd.sql for the
// arithmetic that bought. The program shape has `enabled` on the collection,
// because that is the natural shape in a panel; the two are reconciled here
// and nowhere else.
//
// THE TABLE MAY NOT EXIST YET in a given project. Every read fails soft to an
// empty list: a game with no NFD collections is a game with no NFD benefits,
// which is exactly what it was before any of this existed.

import { validateCollection, type NfdCollection } from "./nfdCatalog";

/** Read rows: `pathAndQuery` is the table and its query. */
export type NfdReader = (pathAndQuery: string) => Promise<Response>;
/** Call a database function with named arguments. */
export type NfdCaller = (fn: string, args: Record<string, unknown>) => Promise<Response>;

export interface NfdStore {
  read: NfdReader;
  call: NfdCaller;
}

/** What a load gives you, and whether the database actually answered. */
export interface NfdLoad {
  collections: NfdCollection[];
  live: boolean;
  error?: string;
}

const TABLE = "rebels_nfd_collections";

/** A row as the table holds it. */
interface Row {
  id: string;
  collection?: unknown;
  enabled?: boolean | null;
  tiers?: Record<string, number> | null;
}

/** Row -> NfdCollection: put `enabled` back on, and trust the row's id. */
function fromRow(r: Row): unknown {
  const c = (r.collection ?? {}) as Record<string, unknown>;
  return { ...c, id: r.id, enabled: r.enabled === true };
}

/**
 * NfdCollection -> row: take `enabled` off.
 *
 * It is dropped rather than carried along, because a save must not be able to
 * change it. Enabling is its own call, so that re-uploading a corrected file
 * cannot quietly switch a set on, and cannot switch a live one off either.
 */
export function toRow(c: NfdCollection): { id: string; collection: unknown } {
  const rest = { ...c } as Partial<NfdCollection>;
  delete rest.enabled;
  delete rest.id;
  return { id: c.id, collection: rest };
}

/**
 * Every collection, enabled or not. For the admin panel. Never throws.
 *
 * Each row is put through the SAME validator an upload goes through, because a
 * row can have been written by an older version of the panel, or by hand in
 * the SQL editor. A row that no longer reads is reported by id and skipped,
 * not guessed at.
 */
export async function fetchCollections(store: NfdStore): Promise<NfdLoad> {
  return load(store, `${TABLE}?select=id,collection,enabled&order=id`);
}

/**
 * Only the collections that count in the game. For the Inventory tab.
 *
 * `enabled=is.true` is answered by the database, so a browser never downloads
 * a set an admin has switched off.
 */
export async function fetchEnabledCollections(store: NfdStore): Promise<NfdLoad> {
  return load(store, `${TABLE}?select=id,collection,enabled&enabled=is.true&order=id`);
}

async function load(store: NfdStore, query: string): Promise<NfdLoad> {
  try {
    const res = await store.read(query);
    if (!res.ok) return { collections: [], live: false, error: `http ${res.status}` };
    const rows = (await res.json()) as Row[];
    const collections: NfdCollection[] = [];
    const bad: string[] = [];
    for (const r of rows) {
      const v = validateCollection(fromRow(r), r.id);
      if ("ok" in v) collections.push(v.ok);
      else bad.push(`${r.id}: ${v.errors.join("; ")}`);
    }
    return {
      collections,
      live: true,
      ...(bad.length ? { error: `${bad.length} unreadable: ${bad.join(" | ")}` } : {}),
    };
  } catch (e) {
    return { collections: [], live: false, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Just the tier maps, for whoever has to work out a player's top owned tier.
 *
 * THIS IS THE ROOM'S READ, and the reason `tiers` is a column. A forty-item
 * set is about 24 KB of names, blurbs, traits and media URLs; its tier map is
 * about 400 bytes, and the tier is the only part of a collection that decides
 * a benefit. The room polls, so this is the one read that happens often.
 *
 * The map is keyed by edition, as a string, because that is what JSON keys
 * are. Callers get a lookup function instead, so nobody has to remember that.
 */
export async function fetchTierMaps(
  store: NfdStore,
): Promise<{ tierOf: (collection: string, edition: number) => number | null; live: boolean }> {
  try {
    const res = await store.read(`${TABLE}?select=id,tiers&enabled=is.true&order=id`);
    if (!res.ok) return { tierOf: () => null, live: false };
    const rows = (await res.json()) as Row[];
    const maps = new Map<string, Record<string, number>>();
    for (const r of rows) maps.set(r.id, (r.tiers ?? {}) as Record<string, number>);
    return {
      tierOf: (collection, edition) => {
        const m = maps.get(collection);
        if (!m) return null;
        const t = m[String(edition)];
        /* A tier we cannot read is NOT a tier of zero and not a tier of one:
           it is "we do not know", so the caller can tell a set it has never
           heard of from an item that genuinely has no benefit. */
        return typeof t === "number" && Number.isFinite(t) ? t : null;
      },
      live: true,
    };
  } catch {
    return { tierOf: () => null, live: false };
  }
}

/** Save ONE collection. Does not change whether it is enabled. */
export async function saveCollection(
  store: NfdStore, secret: string, c: NfdCollection,
): Promise<{ ok: true } | { error: string }> {
  const v = validateCollection(c, c.id);
  if ("errors" in v) return { error: v.errors.join("; ") };
  const row = toRow(v.ok);
  return send(store, "rebels_nfd_save",
    { p_secret: secret, p_id: row.id, p_collection: row.collection });
}

/** Switch one on or off. The gate, and deliberately its own call. */
export async function enableCollection(
  store: NfdStore, secret: string, id: string, enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  return send(store, "rebels_nfd_enable", { p_secret: secret, p_id: id, p_enabled: enabled });
}

/**
 * Forget one.
 *
 * Nothing here touches anybody's holdings: an NFD lives on the Divi chain, and
 * removing the row only means the game stops recognising the set.
 */
export async function deleteCollection(
  store: NfdStore, secret: string, id: string,
): Promise<{ ok: true } | { error: string }> {
  return send(store, "rebels_nfd_delete", { p_secret: secret, p_id: id });
}

async function send(
  store: NfdStore, fn: string, args: Record<string, unknown>,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await store.call(fn, args);
    if (res.ok) return { ok: true };
    let out = `http ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) out = j.message;
    } catch { /* not json */ }
    return { error: out };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
