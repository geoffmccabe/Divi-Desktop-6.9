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
  /** The colour multiplied through the greyscale mask. */
  tint: number;
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
 * Which way each planet lies from Earth.
 *
 * A FIBONACCI SPHERE, not a hash.
 *
 * The first version hashed the planet's number and mapped that onto a sphere,
 * which is the usual trick and is fine for a thousand points. For fourteen it
 * is not: the hash happened to put eleven of them below the equator and most of
 * those on one side, and the sky came out as a clump with nothing opposite it.
 * Geoff: "they are all in a cluster in the same area on one side of the Earth."
 *
 * A Fibonacci lattice has no such luck in it. Walking the golden angle round
 * while stepping evenly down the axis spreads any number of points about as
 * evenly as points can be spread on a sphere, so Earth ends up genuinely in the
 * middle of them. Still completely deterministic, so it is the same sky every
 * time; a sky that rearranges itself between sessions is not an environment.
 *
 * The order is then shuffled by a fixed permutation, so the sizes do not
 * spiral neatly from pole to pole: without that, the planets grow in a visible
 * band as you fly along the lattice, which reads as a pattern rather than as a
 * solar system.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function directionFor(n: number): THREE.Vector3 {
  /* A fixed co-prime step round the fourteen, which mixes the order without
     changing the set of directions. 5 and 14 share no factors, so it visits
     every one exactly once. */
  const i = ((n - 1) * 5) % PLANET_COUNT;
  /* Evenly down the axis, avoiding the exact poles. */
  const y = 1 - (2 * (i + 0.5)) / PLANET_COUNT;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
}

/* ---- colour ----
   Synty's planet texture is a greyscale mask, so the colour is ours to choose
   and there is one per world, matched to what it is said to be below. */
const PLANET_TINTS = [
  0xb9a894, /* Ceralt       barren rock    */
  0xb2643c, /* Bhoro        iron           */
  0xcfe6f2, /* Ixion Minor  ice            */
  0xd4472a, /* Kelvarr      volcanic       */
  0xdfc178, /* Ondrus       desert         */
  0x2f7fd0, /* Tessimar     ocean          */
  0x4fbf8a, /* Halcyne      terraformed    */
  0xe0a63f, /* Vaskir Prime gas giant      */
  0xf0d9a0, /* Ormundi      ringed giant   */
  0x8b5bd6, /* Threx        storm          */
  0x7fd8e8, /* Calladon     frozen giant   */
  0xd45bb5, /* Sepharis     crystalline    */
  0x3f8f4a, /* Yggdral      forest         */
  0x2f6e73, /* Morrowain    shrouded giant */
];

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
      tint: PLANET_TINTS[n - 1] ?? 0xb9a894,
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
        /* Unlit because this lives in the map's scene, whose lighting is not
           ours; tinted because the planet texture is a greyscale mask and the
           colour has to come from somewhere. */
        const model = unitCopy(proto, { unlit: true, tint: spec.tint });
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
