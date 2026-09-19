// The planet: a vector Earth, a tower for every real Divi node, and the links
// between your node and its peers.
//
// This builds its own THREE scene rather than reusing the Node Map's
// react-globe.gl component. Not duplication for its own sake: the map owns its
// camera through orbit controls and is free to render lazily, and a game needs
// a chase camera and a locked frame loop. Reaching into the map to take those
// away would put a working panel at risk to save a few hundred lines. The look
// is deliberately the same, and the two share their DATA, which is the part
// that actually has to agree.

import * as THREE from "three";
import worldmap from "../../assets/worldmap.json";
import type { OrbitNode } from "./orbitNodes";

/** Planet radius in globe units. One unit is about 64 km of real Earth. */
export const R = 100;
export const MIN_ALT = 1.2;
export const MAX_ALT = 26;

const POLYS: number[][][] = (worldmap as { polys: number[][][] }).polys;

/** Latitude and longitude in degrees to a point on a sphere of this radius. */
export function llToVec(lat: number, lon: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** A theme token, read once at build time, as something THREE can swallow. */
function tokenColor(name: string, fallback: string): THREE.Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return new THREE.Color(fallback);
  /* Tokens are stored as bare HSL triplets ("280 80% 60%"), not as colours. */
  const parts = raw.split(/\s+/);
  if (parts.length === 3 && parts[1].endsWith("%")) {
    return new THREE.Color(`hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`);
  }
  try {
    return new THREE.Color(raw);
  } catch {
    return new THREE.Color(fallback);
  }
}

export interface Palette {
  land: THREE.Color;
  grid: THREE.Color;
  ocean: THREE.Color;
  self: THREE.Color;
  peer: THREE.Color;
  net: THREE.Color;
  link: THREE.Color;
  ship: THREE.Color;
  bolt: THREE.Color;
}

export function readPalette(): Palette {
  return {
    land: tokenColor("--rebels-land", "#57e0c0"),
    grid: tokenColor("--rebels-grid", "#2b2068"),
    ocean: tokenColor("--rebels-ocean", "#05040c"),
    self: tokenColor("--rebels-home", "#ffd24a"),
    peer: tokenColor("--accent", "#ff4d9d"),
    net: tokenColor("--primary", "#b45cf5"),
    link: tokenColor("--rebels-link", "#8f6cff"),
    ship: tokenColor("--rebels-ship", "#e6c2ff"),
    bolt: tokenColor("--rebels-bolt", "#c77dff"),
  };
}

export interface World {
  group: THREE.Group;
  /** Tip position of each tower, in the same order as the node list. */
  towerTips: THREE.Vector3[];
  dispose(): void;
}

const TOWER_H = 4.2;
const TOWER_BASE = 0.9;
const TIP_R = 0.42;

/**
 * The planet, its towers and its links.
 *
 * Everything that can be one draw call is one draw call. The coastline is a
 * single LineSegments of about ten thousand segments, the towers are two
 * InstancedMeshes however many nodes there are, and the links are one more
 * LineSegments. That is the difference between this holding sixty frames a
 * second with three hundred nodes on screen and not.
 */
export function buildWorld(nodes: OrbitNode[], home: OrbitNode | null, pal: Palette): World {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- the sea floor, which is really an occluder ----------------------
     Without a solid sphere the coastlines on the far side show through and the
     planet reads as a wireframe ball rather than a world. It sits just under
     the line work so the lines never z-fight with it. */
  const oceanGeo = new THREE.SphereGeometry(R * 0.998, 64, 48);
  const oceanMat = new THREE.MeshBasicMaterial({ color: pal.ocean });
  group.add(new THREE.Mesh(oceanGeo, oceanMat));
  disposables.push(oceanGeo, oceanMat);

  /* ---- coastlines ---- */
  {
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (const poly of POLYS) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        llToVec(a[1], a[0], R * 1.002, v); pts.push(v.x, v.y, v.z);
        llToVec(b[1], b[0], R * 1.002, v); pts.push(v.x, v.y, v.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: pal.land, transparent: true, opacity: 0.9 });
    group.add(new THREE.LineSegments(g, m));
    disposables.push(g, m);
  }

  /* ---- graticule ----
     Every fifteen degrees. On a planet with no texture this is the only thing
     that tells you how fast you are turning. */
  {
    const pts: number[] = [];
    const v = new THREE.Vector3();
    const push = (lat: number, lon: number) => { llToVec(lat, lon, R * 1.001, v); pts.push(v.x, v.y, v.z); };
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -90; lat < 90; lat += 5) { push(lat, lon); push(lat + 5, lon); }
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -180; lon < 180; lon += 5) { push(lat, lon); push(lat, lon + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: pal.grid, transparent: true, opacity: 0.55 });
    group.add(new THREE.LineSegments(g, m));
    disposables.push(g, m);
  }

  /* ---- towers ----
     A slim four-sided spire with a lit tip, the same shape the Node Map uses,
     scaled up because at map scale a tower is a speck and at flying scale it
     has to be a landmark you can navigate by. */
  const towerTips: THREE.Vector3[] = [];
  if (nodes.length > 0) {
    const spire = new THREE.ConeGeometry(TOWER_BASE, TOWER_H, 4);
    spire.translate(0, TOWER_H / 2, 0);
    const tip = new THREE.SphereGeometry(TIP_R, 8, 6);

    const spireMat = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true });
    const tipMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const spires = new THREE.InstancedMesh(spire, spireMat, nodes.length);
    const tips = new THREE.InstancedMesh(tip, tipMat, nodes.length);

    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();

    nodes.forEach((n, i) => {
      llToVec(n.lat, n.lon, 1, normal);
      q.setFromUnitVectors(up, normal);

      const base = normal.clone().multiplyScalar(R);
      mat.compose(base, q, scale);
      spires.setMatrixAt(i, mat);

      const tipPos = normal.clone().multiplyScalar(R + TOWER_H);
      towerTips.push(tipPos);
      mat.compose(tipPos, q, scale);
      tips.setMatrixAt(i, mat);

      const isHome = home != null && n.ip === home.ip;
      col.copy(isHome ? pal.self : n.kind === "peer" ? pal.peer : pal.net);
      spires.setColorAt(i, col);
      tips.setColorAt(i, col);
    });
    spires.instanceMatrix.needsUpdate = true;
    tips.instanceMatrix.needsUpdate = true;
    if (spires.instanceColor) spires.instanceColor.needsUpdate = true;
    if (tips.instanceColor) tips.instanceColor.needsUpdate = true;

    group.add(spires, tips);
    disposables.push(spire, tip, spireMat, tipMat, spires, tips);
  }

  /* ---- links from home ----
     A twin helical strand rather than a plain arc, because that is what the
     Node Map's connections look like and the planet should feel like the same
     place. Drawn as line strips instead of tube geometry: at this scale the
     difference is invisible and the cost is not.

     The offset direction is the arc's PLANE NORMAL, which is constant along the
     whole run. Deriving it per point from a cross product with the endpoint
     instead makes it collapse and flip as the point approaches that endpoint,
     and the helix comes out as a curtain hanging off the sky. */
  if (home) {
    const pts: number[] = [];
    const a = llToVec(home.lat, home.lon, 1);
    const targets = nodes.filter((n) => n.ip !== home.ip).slice(0, 14);
    const b = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const p = new THREE.Vector3();
    const prev = [new THREE.Vector3(), new THREE.Vector3()];
    const HELIX_R = 0.5;

    for (const n of targets) {
      llToVec(n.lat, n.lon, 1, b);
      const ang = a.angleTo(b);
      if (ang < 1e-3) continue;
      axis.crossVectors(a, b);
      if (axis.lengthSq() < 1e-8) continue;   /* antipodal, no unique plane */
      axis.normalize();
      const steps = Math.max(10, Math.min(72, Math.round(ang * 44)));
      /* Kept low and flat. These are scenery you fly under and along, not
         arches over the whole sky. */
      const lift = 1 + ang * 2.2;
      for (let strand = 0; strand < 2; strand++) {
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          mid.copy(a).lerp(b, t).normalize();
          const radius = R + TOWER_H * 0.8 + Math.sin(t * Math.PI) * lift;
          const twist = t * ang * 22 + strand * Math.PI;
          p.copy(mid).multiplyScalar(radius)
            .addScaledVector(axis, Math.cos(twist) * HELIX_R)
            .addScaledVector(mid, Math.sin(twist) * HELIX_R);
          if (s > 0) pts.push(prev[strand].x, prev[strand].y, prev[strand].z, p.x, p.y, p.z);
          prev[strand].copy(p);
        }
      }
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color: pal.link, transparent: true, opacity: 0.42 });
      group.add(new THREE.LineSegments(g, m));
      disposables.push(g, m);
    }
  }

  /* ---- stars ---- */
  {
    const pts: number[] = [];
    for (let i = 0; i < 700; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 400);
      pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.PointsMaterial({ color: 0x8f86b8, size: 2.4, sizeAttenuation: false });
    group.add(new THREE.Points(g, m));
    disposables.push(g, m);
  }

  return {
    group,
    towerTips,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** The player's fighter, as line work so it belongs to the same picture. */
export function buildShip(pal: Palette): THREE.Object3D {
  const seg: number[] = [];
  const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
    seg.push(ax, ay, az, bx, by, bz);

  /* Nose forward is -Z, matching the way the camera looks down its own -Z. */
  line(0, 0, -1.6, -0.9, 0, 0.7);
  line(0, 0, -1.6, 0.9, 0, 0.7);
  line(-0.9, 0, 0.7, 0.9, 0, 0.7);
  line(0, 0, -1.6, 0, 0.42, 0.4);
  line(0, 0.42, 0.4, -0.9, 0, 0.7);
  line(0, 0.42, 0.4, 0.9, 0, 0.7);
  /* Wingtip cannons, where the bolts come from. */
  line(-0.9, 0, 0.7, -1.05, 0, -0.5);
  line(0.9, 0, 0.7, 1.05, 0, -0.5);
  /* Engine bar. */
  line(-0.55, 0, 0.72, 0.55, 0, 0.72);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
  const m = new THREE.LineBasicMaterial({ color: pal.ship });
  return new THREE.LineSegments(g, m);
}
