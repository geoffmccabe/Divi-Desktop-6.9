// The sky around Earth: fourteen planets, and later the belts and stations.
//
// GEOSYNCHRONOUS COSTS NOTHING HERE
// --------------------------------
// Geoff: "everything should be in geosynchronous orbit unless I tell you
// differently". On this map that is already true and needs no code: the globe's
// own controls have autoRotate off and the towers sit in a fixed group, so a
// fixed position in the scene IS a position that holds station over the same
// spot on Earth. Everything below is parented to that same group, so if the
// globe is ever made to turn, the sky turns with it and stays synchronous.
//
// WHAT LOADS WHEN
// ---------------
// These are scenery: always in the sky, so they are fetched when the game first
// opens rather than on demand. Ships are the opposite and load only when
// something has to draw one.

import * as THREE from "three";
import { PLANET_COUNT, planetDiameter, planetDistance } from "./orbitWorld";
import { loadModel, unitCopy } from "./spaceAssets";

/** One thing hanging in the sky, and what to say about it. */
export interface SpaceBody {
  id: string;
  name: string;
  kind: "planet";
  /** What it is made of, how big, how far. Shown when you get close. */
  detail: string;
  /** Centre, in scene units. */
  at: THREE.Vector3;
  /** How wide it is drawn, in scene units. */
  diameter: number;
  object: THREE.Object3D;
  /** Radians per second about its own axis. */
  spin: number;
  axis: THREE.Vector3;
}

/* ---- names ----
   Fourteen of them, ordered from the nearest out, so the small close ones get
   the workaday names and the giants further out get the grander ones. Nothing
   here is a real place. */
const PLANET_NAMES = [
  "Ceralt", "Bhoro", "Ixion Minor", "Kelvarr", "Ondrus", "Tessimar", "Halcyne",
  "Vaskir Prime", "Ormundi", "Threx", "Calladon", "Sepharis", "Yggdral", "Morrowain",
];

const PLANET_KINDS = [
  "Barren rock", "Iron world", "Ice moon", "Volcanic", "Desert world", "Ocean world",
  "Terraformed", "Gas giant", "Ringed giant", "Storm world", "Frozen giant",
  "Crystalline", "Forest world", "Shrouded giant",
];

/**
 * Where each planet sits.
 *
 * The direction is random but FIXED: a hash of the planet's number rather than
 * Math.random, so the sky is the same sky every time the game is opened. A sky
 * that rearranges itself between sessions is not an environment, it is noise.
 */
function directionFor(n: number): THREE.Vector3 {
  /* A cheap deterministic hash, then the standard even-sphere mapping so the
     fourteen do not clump around a pole. */
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  const a = h - Math.floor(h);
  const h2 = Math.sin(n * 269.5 + 183.3) * 43758.5453;
  const b = h2 - Math.floor(h2);
  const z = 1 - 2 * a;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = b * Math.PI * 2;
  return new THREE.Vector3(r * Math.cos(phi), z, r * Math.sin(phi));
}

/** Every planet, described. Cheap, synchronous, and has nothing to do with
 *  whether the models have arrived yet. */
export function planetLayout(): Array<Omit<SpaceBody, "object">> {
  const out: Array<Omit<SpaceBody, "object">> = [];
  for (let n = 1; n <= PLANET_COUNT; n++) {
    const diameter = planetDiameter(n);
    const distance = planetDistance(n);
    const at = directionFor(n).multiplyScalar(distance);
    /* Slow. A planet that visibly whirls looks like a prop; one that takes a
       minute or two to come round reads as something enormous. */
    const spin = 0.02 + (n % 5) * 0.006;
    const tilt = new THREE.Vector3(
      Math.sin(n * 1.7), 1, Math.cos(n * 2.3),
    ).normalize();
    out.push({
      id: `space_SM_Env_Planet_${String(n).padStart(2, "0")}`,
      name: PLANET_NAMES[n - 1] ?? `Planet ${n}`,
      kind: "planet",
      detail: `${PLANET_KINDS[n - 1] ?? "Unclassified"} · ${(diameter / 200).toFixed(1)} Earth diameters · ${Math.round(distance * 64).toLocaleString()} km out`,
      at,
      diameter,
      spin,
      axis: tilt,
    });
  }
  return out;
}

/**
 * Build the sky into a group.
 *
 * Returns immediately with an empty group and fills it as the models land, so
 * a slow first fetch never holds the game up: you launch into an empty sky and
 * the worlds appear over the next few seconds. On the second run they are all
 * in IndexedDB and it is instant.
 */
export function createSpace(): {
  group: THREE.Group;
  bodies: SpaceBody[];
  step(dt: number): void;
  /** Whichever body the point is within `within` diameters of, or null. */
  near(p: THREE.Vector3, within: number): SpaceBody | null;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = "rebels-space";
  const bodies: SpaceBody[] = [];
  let dead = false;

  for (const spec of planetLayout()) {
    /* A placeholder holds the body's place in the list straight away, so the
       approach readout and the spacing are right before any model arrives. */
    const holder = new THREE.Group();
    holder.position.copy(spec.at);
    group.add(holder);
    const body: SpaceBody = { ...spec, object: holder };
    bodies.push(body);

    void loadModel(spec.id)
      .then((proto) => {
        if (dead) return;
        /* Unlit: this lives in the map's scene, whose lighting is not ours. */
        const model = unitCopy(proto, { unlit: true });
        model.scale.setScalar(spec.diameter);
        holder.add(model);
      })
      .catch(() => {
        /* One planet that will not load is one planet missing, not a broken
           sky. It keeps its place in the list and its name still shows. */
      });
  }

  return {
    group,
    bodies,
    step(dt: number) {
      for (const b of bodies) b.object.rotateOnAxis(b.axis, b.spin * dt);
    },
    near(p: THREE.Vector3, within: number) {
      let best: SpaceBody | null = null;
      let bestD = Infinity;
      for (const b of bodies) {
        const d = p.distanceTo(b.at);
        if (d > b.diameter * within) continue;
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    },
    dispose() {
      dead = true;
      group.removeFromParent();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      group.clear();
    },
  };
}
