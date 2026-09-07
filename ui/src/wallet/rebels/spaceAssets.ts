// Getting Synty's Sci-Fi Space models into the game: once over the network,
// then never again, and with their textures put right on the way through.
//
// WHY THEY ARE NOT IN THE DOWNLOAD
// -------------------------------
// Geoff: "I don't want to include all these models in every download of DD69."
// Quite right. There are 631 of them and the whole wallet is 6.4MB. They live
// on R2 and arrive as they are needed: the planets when the game first opens,
// because they are always in the sky, and a ship only when something actually
// has to draw it.
//
// WHY THEY ARE ONLY FETCHED ONCE
// ------------------------------
// The bytes go into IndexedDB the first time and come back from there for ever
// after. IndexedDB rather than the Cache API because a WKWebView's support for
// the latter is not something to bet a feature on, and because this codebase
// already keeps blobs in IndexedDB for node avatars, so the ground is known.
//
// THE BROKEN TEXTURES
// -------------------
// Every space model on R2 points at the SAME image, and it is the wrong one:
// PolygonSciFiSpace_Signs_Texture_01_A.webp, the atlas of signage. Not some of
// them, all of them — a fighter, a cruiser, a station, three planets, an
// asteroid and a warp gate all carry it. The conversion stamped one texture on
// the pack.
//
// The geometry and the UVs are fine, because every Synty model is laid out
// against one shared atlas; only the image is wrong. So the repair is to hand
// each model the atlas it should have had, which is a texture swap and nothing
// more. Both atlases are bundled rather than fetched: together they are 192KB,
// the planet one is not on R2 at all, and a bundled file cannot be broken by
// somebody else's deploy.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import atlasUrl from "../../assets/space_atlas.webp";
import planetAtlasUrl from "../../assets/space_planets.webp";

/** Where the converted Synty library lives. Shared with DreadRoot. */
const ASSET_BASE = "https://assets.dreadroot.com/siege/scifi";

const DB = "dd69.space";
const STORE = "models";

/** The R2 URL for a model id, e.g. "space_SM_Env_Planet_01". */
export function modelUrl(id: string): string {
  return `${ASSET_BASE}/${id}.glb`;
}

/* ---- the byte store ---- */

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

async function cached(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const got = await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve((r.result as ArrayBuffer) ?? null);
      r.onerror = () => resolve(null);
    });
    db.close();
    return got;
  } catch {
    return null;
  }
}

async function keep(id: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();     /* not worth failing a load over */
    });
    db.close();
  } catch {
    /* No store, no cache. It still flies, it just fetches again next time. */
  }
}

/** How many models are already on this machine, for a progress readout. */
export async function countCached(): Promise<number> {
  try {
    const db = await openDb();
    const n = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(0);
    });
    db.close();
    return n;
  } catch {
    return 0;
  }
}

/* ---- the textures ---- */

let atlas: THREE.Texture | null = null;
let planetAtlas: THREE.Texture | null = null;

function loadAtlas(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  /* Synty atlases are authored for direct sampling: no wrapping, and colour
     data rather than linear, or everything comes out washed out. */
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;                       /* glTF convention */
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** The right atlas for a model, by what it is. */
function atlasFor(id: string): THREE.Texture {
  if (/Planet/i.test(id)) {
    planetAtlas ??= loadAtlas(planetAtlasUrl);
    return planetAtlas;
  }
  atlas ??= loadAtlas(atlasUrl);
  return atlas;
}

/* ---- loading ---- */

const loader = new GLTFLoader();
const inFlight = new Map<string, Promise<THREE.Group>>();
const loaded = new Map<string, THREE.Group>();

async function bytesFor(id: string): Promise<ArrayBuffer> {
  const have = await cached(id);
  if (have && have.byteLength > 0) return have;
  const res = await fetch(modelUrl(id));
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  void keep(id, bytes);                  /* not awaited: drawing need not wait */
  return bytes;
}

/**
 * Load a model, from this machine if it has been seen before.
 *
 * What comes back is a SHARED prototype. Clone it to put one in the world;
 * never move the thing this returns, or every copy moves with it.
 */
export function loadModel(id: string): Promise<THREE.Group> {
  /* Headless: no store, no network, no models. The simulation tests run the
     whole controller in node, and without this each of them would reach out to
     R2 for fourteen planets — real requests, from a test, whose timing then
     leaks into everything measured afterwards. The renderer-side modules guard
     on `document` for the same reason; this one guards on the store it needs. */
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no browser storage: not loading models"));
  }
  const already = loaded.get(id);
  if (already) return Promise.resolve(already);
  const running = inFlight.get(id);
  if (running) return running;

  const job = bytesFor(id)
    .then((bytes) => new Promise<THREE.Group>((resolve, reject) => {
      loader.parse(bytes, "", (gltf) => resolve(gltf.scene as THREE.Group), reject);
    }))
    .then((scene) => {
      repair(scene, id);
      loaded.set(id, scene);
      inFlight.delete(id);
      return scene;
    })
    .catch((e) => {
      inFlight.delete(id);
      throw e;
    });

  inFlight.set(id, job);
  return job;
}

/** Put the right atlas on every material in a freshly parsed model. */
function repair(root: THREE.Object3D, id: string): void {
  const tex = atlasFor(id);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std) continue;
      std.map = tex;
      /* Synty's atlases are flat colour. Metalness at anything above zero
         turns the whole pack into wet plastic under the game's lighting. */
      std.metalness = 0;
      std.roughness = 0.85;
      std.side = THREE.FrontSide;
      std.needsUpdate = true;
    }
  });
}

/**
 * A copy of a model, normalised so its LONGEST side is exactly one unit and
 * its centre is the origin.
 *
 * Everything in this pack is modelled at Unity's metres — a fighter is 13
 * units across, a station 565, a planet 450 — and the game's own scale is a
 * hundred-unit Earth. Normalising first means every placement in the game can
 * be written as the size the thing should APPEAR, which is the only way the
 * numbers in the plan stay readable.
 */
export function unitCopy(proto: THREE.Group): THREE.Group {
  const model = proto.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  model.position.sub(centre);
  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.scale.setScalar(1 / longest);
  /* A second wrapper, so callers can scale and rotate without fighting the
     normalisation. */
  const outer = new THREE.Group();
  outer.add(wrap);
  return outer;
}
