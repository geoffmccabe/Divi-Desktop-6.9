// The high-detail patch of ground under the viewer.
//
// HOW THIS SITS ON THE GLOBE
// --------------------------
// Not by replacing the globe's texture, and not by rewriting its shader. It is
// a separate curved patch of geometry, a few hundredths of a unit above the
// surface, wearing the tile for wherever the viewer is. That choice is worth
// stating because the obvious alternative, hooking the globe's own material,
// looked tidier and was worse in every way that matters: the globe belongs to
// the wallet's map rather than to the game, an edit to its shader is felt
// everywhere, and switching the whole thing off again becomes a question of
// undoing a shader rather than removing an object.
//
// This way the old globe is untouched underneath, and turning the detail off is
// removing one thing from the scene.
//
// The patch is built from getCoords, the same function the node towers are
// placed with, so it cannot drift out of register with them however the globe
// is oriented. Nothing here reverse-engineers three-globe's own mapping.

import * as THREE from "three";
import {
  earthManifest, loadTile, tileAt, tileBounds, tileKey, dropTiles,
  type EarthManifest,
} from "./earthTiles";

/** How far above the surface, as a fraction of the globe's radius. Enough to
 *  never fight the surface for depth, far too little to see as a step. */
const LIFT = 0.0006;
/** Quads across a patch. It is a curved rectangle up to thirty degrees on a
 *  side, so it needs enough segments to actually follow the curve. */
const GRID = 28;
/** Seconds to fade a tile in, and to fade the one it replaces out. */
const FADE = 0.55;
/** How much of the patch, at each edge, is spent dissolving into the map
 *  underneath. An eighth is wide enough not to read as a line. */
const EDGE = 0.125;

/**
 * Above this height the detail is not drawn at all.
 *
 * In globe radii, so 0.35 is about a third of the planet's radius up. Higher
 * than that and one pixel of the old map is smaller than one pixel on screen,
 * so there is nothing to gain and a download to avoid.
 */
const SHOW_BELOW = 0.5;
/** And it is fully on by this height.
 *
 *  Set from where the game actually flies rather than from what looks tidy: the
 *  towers stand about fourteen units above a hundred-unit globe, which is 0.14
 *  here, and the ship spends its whole life between there and the ground. The
 *  wallet's map sits at 2.2 by default, well outside both, so an idle globe
 *  spinning on screen never fetches a thing. */
const FULL_BELOW = 0.15;

export interface DetailLayer {
  object: THREE.Object3D;
  /** Where the viewer is, in degrees, and how high in globe radii. */
  update(lat: number, lon: number, altitude: number, dt: number): void;
  setEnabled(on: boolean): void;
  /** True once the manifest has been read and at least one tile is up. */
  ready(): boolean;
  dispose(): void;
}

interface Patch {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  key: string;
  /** 0 to 1, where it is in its fade. */
  fade: number;
}

/**
 * Shape a patch to cover a lat/lon rectangle.
 *
 * Positions come from the globe's own coordinate function so the patch lands
 * exactly where the map says that piece of the world is. The texture runs west
 * to east and north to south, which is the order the tile was cut in.
 */
function shape(
  geom: THREE.BufferGeometry,
  b: { lon0: number; lon1: number; lat0: number; lat1: number },
  coords: (lat: number, lng: number, alt: number) => { x: number; y: number; z: number },
): void {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  let i = 0;
  for (let row = 0; row <= GRID; row++) {
    const lat = b.lat0 + (b.lat1 - b.lat0) * (row / GRID);
    for (let col = 0; col <= GRID; col++) {
      const lon = b.lon0 + (b.lon1 - b.lon0) * (col / GRID);
      const p = coords(lat, lon, LIFT);
      pos.setXYZ(i++, p.x, p.y, p.z);
    }
  }
  pos.needsUpdate = true;
  geom.computeBoundingSphere();
}

/** A grid of quads with its UVs already right. Positions are filled in later. */
function makeGrid(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const n = (GRID + 1) * (GRID + 1);
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const uv = new Float32Array(n * 2);
  let i = 0;
  for (let row = 0; row <= GRID; row++) {
    for (let col = 0; col <= GRID; col++) {
      uv[i * 2] = col / GRID;
      /* The tile's first row is its NORTHERN edge, and a texture's v runs from
         the bottom up, so the two are opposite. */
      uv[i * 2 + 1] = 1 - row / GRID;
      i++;
    }
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  /* ---- A SOFT EDGE ----
     The patch has to stop somewhere, and a patch that stops abruptly draws a
     rectangle on the planet: a visible seam where sharp ground becomes blurry
     ground in a straight line. So the alpha falls off over the outermost eighth
     of the patch and the detail dissolves into the map underneath instead of
     ending.

     Four components, not three, because three.js only reads a per-vertex alpha
     when the colour attribute actually carries one. */
  const col4 = new Float32Array(n * 4);
  i = 0;
  for (let row = 0; row <= GRID; row++) {
    for (let colI = 0; colI <= GRID; colI++) {
      const u = colI / GRID;
      const v = row / GRID;
      const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) / EDGE;
      col4[i * 4] = 1; col4[i * 4 + 1] = 1; col4[i * 4 + 2] = 1;
      col4[i * 4 + 3] = Math.max(0, Math.min(1, edge));
      i++;
    }
  }
  geom.setAttribute("color", new THREE.BufferAttribute(col4, 4));
  const idx: number[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const a = row * (GRID + 1) + col;
      const b = a + 1;
      const c = a + GRID + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geom.setIndex(idx);
  return geom;
}

export function createDetail(
  coords: (lat: number, lng: number, alt: number) => { x: number; y: number; z: number },
  anisotropy = 1,
): DetailLayer {
  const object = new THREE.Group();
  object.renderOrder = 1;
  let manifest: EarthManifest | null = null;
  let enabled = true;
  let gone = false;

  void earthManifest().then((m) => { if (!gone) manifest = m; });

  const patches: Patch[] = [0, 1].map(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false,
      /* Carries the edge falloff. See makeGrid. */
      vertexColors: true,
      /* Sitting just above the globe, so it must win the depth test against it
         without ever fighting. The lift does most of the work; this makes it
         certain at grazing angles, which is exactly where the player is. */
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(makeGrid(), mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    object.add(mesh);
    return { mesh, mat, key: "", fade: 0 };
  });

  /* Which patch is showing the current tile, and which is the one fading out
     behind it. Two, so moving from one tile to the next is a cross-fade rather
     than a snap: a hard swap of a whole patch of ground is the one thing that
     would make this read as a trick. */
  let front = 0;
  let want = "";

  function useTile(col: number, row: number, m: EarthManifest, tex: THREE.Texture) {
    const key = tileKey(col, row);
    if (patches[front].key === key) return;
    /* The old front becomes the back and starts fading out. */
    front = 1 - front;
    const p = patches[front];
    p.key = key;
    p.fade = 0;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    p.mat.map = tex;
    p.mat.needsUpdate = true;
    shape(p.mesh.geometry, tileBounds(col, row, m), coords);
    p.mesh.visible = true;
  }

  return {
    object,
    ready: () => manifest !== null && patches.some((p) => p.key !== ""),
    setEnabled(on) {
      enabled = on;
      if (!on) want = "";
    },
    update(lat, lon, altitude, dt) {
      const m = manifest;
      /* How much of it should be showing at this height. Off entirely up high,
         so an idle wallet spinning the globe never fetches a thing. */
      const target = !enabled || !m ? 0
        : altitude >= SHOW_BELOW ? 0
        : altitude <= FULL_BELOW ? 1
        : (SHOW_BELOW - altitude) / (SHOW_BELOW - FULL_BELOW);

      if (m && target > 0) {
        const { col, row } = tileAt(lat, lon, m);
        const key = tileKey(col, row);
        if (key !== want) {
          want = key;
          void loadTile(col, row, m).then((tex) => {
            /* Still the tile we are over? A fast flight can ask for three in
               the time one of them arrives. */
            if (tex && want === key && !gone) useTile(col, row, m, tex);
          });
        }
      }

      for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        if (!p.mesh.visible) continue;
        const to = i === front ? target : 0;
        p.fade += Math.max(-1, Math.min(1, to - p.fade)) * Math.min(1, dt / FADE);
        if (Math.abs(to - p.fade) < 0.01) p.fade = to;
        p.mat.opacity = p.fade;
        if (p.fade <= 0) {
          p.mesh.visible = false;
          /* Let go of the picture but not the key: coming straight back to a
             tile should not fetch it again. */
          if (i !== front) p.key = "";
        }
      }
    },
    dispose() {
      gone = true;
      for (const p of patches) {
        p.mesh.geometry.dispose();
        p.mat.dispose();
        object.remove(p.mesh);
      }
      dropTiles();
    },
  };
}
