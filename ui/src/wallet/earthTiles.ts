// The high-detail night map, in pieces, fetched as they are needed.
//
// The globe's own texture is one 4096 by 2048 picture of the whole planet. That
// is 6.5 pixels per game unit, so the player's ship is seventeen pixels long and
// a single pixel is about ten kilometres of real Earth. From orbit it is
// beautiful; flying over it, there is simply nothing there. Geoff: "close up,
// flying over its surface, it's a blur and ugly, breaking immersion."
//
// So the detail lives out on R2 in tiles, and only the tile under the player is
// ever fetched. Nothing is bundled: the wallet download does not grow by a byte,
// and a tile is kept for good on the machine that fetched it, which is exactly
// how the ship models already work.
//
// WHAT IS IN A TILE
// -----------------
// Not a replacement for the globe's picture. A tile is that picture, enlarged,
// with the detail it was missing added back: see scripts/build-earth-tiles.py.
// Shrink a tile back down and the old map returns, which is the property that
// lets this be switched on without the planet changing colour.

import * as THREE from "three";

const BASE = "https://assets.dreadroot.com/earth/v1";
const DB = "dd69.earth";
const STORE = "tiles";

export interface EarthManifest {
  version: number;
  /** Degrees of longitude and latitude in one tile. */
  tileDeg: number;
  cols: number;
  rows: number;
  /** Pixels across one tile. */
  size: number;
  format: string;
  /** How many of cols*rows actually exist. The empty ocean has none. */
  tiles: number;
}

/** Which tile covers a place. Row 0 is the north pole, as in the image. */
export function tileAt(lat: number, lon: number, m: EarthManifest): { col: number; row: number } {
  const wrapped = ((lon + 180) % 360 + 360) % 360;
  const col = Math.min(m.cols - 1, Math.floor(wrapped / m.tileDeg));
  const row = Math.min(m.rows - 1, Math.max(0, Math.floor((90 - lat) / m.tileDeg)));
  return { col, row };
}

/** The patch of the world a tile covers, in degrees. */
export function tileBounds(col: number, row: number, m: EarthManifest): {
  lon0: number; lon1: number; lat0: number; lat1: number;
} {
  return {
    lon0: col * m.tileDeg - 180,
    lon1: (col + 1) * m.tileDeg - 180,
    /* lat0 is the NORTHERN edge, because row 0 is the top of the image. */
    lat0: 90 - row * m.tileDeg,
    lat1: 90 - (row + 1) * m.tileDeg,
  };
}

/* ---- the byte store ----
   Same shape as the model cache: keep the bytes, not the decoded picture, so a
   tile survives a restart and costs nothing to keep. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("no local store"));
  });
}

async function cached(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function keep(key: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, key);
  } catch {
    /* A full or blocked store is not worth failing a download over: the tile
       still shows this time, it is just fetched again next time. */
  }
}

let manifestOnce: Promise<EarthManifest | null> | null = null;

/** The grid, fetched once. Null means the detail map is unavailable, and the
 *  globe carries on exactly as it did before. */
export function earthManifest(): Promise<EarthManifest | null> {
  if (!manifestOnce) {
    manifestOnce = fetch(`${BASE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: EarthManifest | null) => (m && m.cols > 0 && m.rows > 0 ? m : null))
      .catch(() => null);
  }
  return manifestOnce;
}

/** Tiles already decoded, so flying back and forth over a border does not
 *  decode the same picture again and again. */
const decoded = new Map<string, THREE.Texture>();
const missing = new Set<string>();
const inFlight = new Map<string, Promise<THREE.Texture | null>>();

export function tileKey(col: number, row: number): string { return `t_${col}_${row}`; }

/**
 * Fetch and decode one tile.
 *
 * Null means there is no such tile, which is the ordinary case rather than a
 * failure: most of the ocean and both poles have no lights in them at all and
 * the builder does not upload a tile that would add nothing.
 */
export function loadTile(col: number, row: number, m: EarthManifest): Promise<THREE.Texture | null> {
  const key = tileKey(col, row);
  const have = decoded.get(key);
  if (have) return Promise.resolve(have);
  if (missing.has(key)) return Promise.resolve(null);
  const going = inFlight.get(key);
  if (going) return going;

  const job = (async () => {
    let bytes = await cached(key);
    if (!bytes) {
      const res = await fetch(`${BASE}/${key}.${m.format}`).catch(() => null);
      if (!res || !res.ok) { missing.add(key); return null; }
      bytes = await res.arrayBuffer();
      void keep(key, bytes);
    }
    const blob = new Blob([bytes], { type: `image/${m.format}` });
    /* ---- flipY, AND WHY IT IS DONE HERE ----
       three.js turns pictures upside down on purpose, because a texture's v
       runs from the bottom while an image's rows run from the top. It does that
       with an unpack flag when it uploads... unless the source is an
       ImageBitmap, which it explicitly skips ("if (isImageBitmap === false)" in
       WebGLTextures). So texture.flipY is quietly ignored for exactly the kind
       of source used here, and every tile would have come out mirrored
       north-to-south: the ground under the player would be a picture of
       somewhere the same distance the other side of the equator.
       Flipping the bitmap itself, at decode, is not subject to that. */
    const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" }).catch(() => null);
    if (!bitmap) { missing.add(key); return null; }
    const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    /* Already flipped above, and three would ignore this for a bitmap anyway.
       Set so nobody reads the default and assumes it did something. */
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    /* Clamped, because a tile is a window onto the world and repeating it at
       the edge would wrap the far side of the patch onto the near side. */
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    decoded.set(key, tex);
    return tex;
  })().finally(() => { inFlight.delete(key); });

  inFlight.set(key, job);
  return job;
}

/** Free every decoded tile. The bytes stay on disk. */
export function dropTiles(): void {
  for (const t of decoded.values()) t.dispose();
  decoded.clear();
}
