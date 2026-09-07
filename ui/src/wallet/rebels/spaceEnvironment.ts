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
import { PLANET_COUNT, EARTH_D, planetDiameter, planetDistance } from "./orbitWorld";
import { loadModel, unitCopy } from "./spaceAssets";

/** One thing hanging in the sky, and what to say about it. */
export interface SpaceBody {
  id: string;
  name: string;
  kind: "planet" | "station" | "belt" | "gate";
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

/** A deterministic 0..1 from a number. Scattering a hundred rocks needs some
 *  randomness and none of it may be Math.random: the field has to be the same
 *  field every time the game is opened, like everything else out here. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function latticeDirection(slot: number, offset = 0): THREE.Vector3 {
  const i = slot + offset;
  /* Evenly down the axis, avoiding the exact poles. */
  const y = 1 - (2 * (i + 0.5)) / PLANET_COUNT;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
}

function directionFor(n: number): THREE.Vector3 {
  /* A fixed co-prime step round the fourteen, which mixes the order without
     changing the set of directions. 5 and 14 share no factors, so it visits
     every slot exactly once. */
  return latticeDirection(((n - 1) * 5) % PLANET_COUNT);
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

/* ---- everything that is not a planet ----
   Stations, asteroid fields and the warp gate. Same rules as the planets: a
   fixed place, a name, something to say about itself, and it announces itself
   within three of its own size.

   They are laid out BETWEEN the planets rather than on top of them, on the same
   golden-angle lattice offset by half a step, so the sky has something in it at
   every distance instead of fourteen worlds and a lot of nothing. */

/** How much a station is shrunk for the sky.
 *
 *  The models are enormous: Station 01 is 565 units across its own bounding
 *  box, which at this game's scale is nearly three Earth diameters. Shown at
 *  true size they would dwarf the planets they orbit near and stop reading as
 *  stations at all. A fifth keeps them unmistakably big without competing with
 *  a world. The Ship Market shows their real numbers. */
const STATION_SCALE = 0.2;

interface Furniture {
  id: string;
  name: string;
  kind: "station" | "belt" | "gate";
  detail: string;
  /** Which lattice slot, and how many Earth diameters out. */
  slot: number;
  distance: number;
  size: number;
  /** Belts only: how many rocks, and how wide the field is. */
  rocks?: number;
}

const FURNITURE: Furniture[] = [
  { id: "space_SM_Ship_Station_01", name: "Kestrel Anchorage", kind: "station",
    detail: "Deep-space anchorage · repair and resupply · crew 6,000", slot: 0, distance: 4.4, size: 565 * STATION_SCALE },
  { id: "space_SM_Ship_Station_02", name: "Ardent Reach", kind: "station",
    detail: "Trade platform · open registry · crew 6,600", slot: 3, distance: 7.6, size: 498 * STATION_SCALE },
  { id: "space_SM_Ship_Station_03", name: "Colm Vantage", kind: "station",
    detail: "Survey station · long-range sensors · crew 7,300", slot: 6, distance: 10.4, size: 268 * STATION_SCALE },
  { id: "space_SM_Ship_Station_04", name: "Ninth Gate Keep", kind: "station",
    detail: "Fortified waypoint · restricted approach · crew 8,000", slot: 9, distance: 13.5, size: 258 * STATION_SCALE },
  { id: "space_SM_Ship_Station_05", name: "Halvern Spire", kind: "station",
    detail: "Refinery and yard · hull works · crew 8,800", slot: 11, distance: 15.8, size: 292 * STATION_SCALE },
  { id: "space_SM_Ship_Station_06", name: "Low Verge", kind: "station",
    detail: "Relay post · unmanned most of the year · crew 9,700", slot: 13, distance: 17.4, size: 101 * STATION_SCALE },

  { id: "space_SM_Env_Asteroid_01", name: "The Shoals", kind: "belt",
    detail: "Asteroid field · dense · navigation hazard", slot: 1, distance: 5.6, size: 220, rocks: 90 },
  { id: "space_SM_Env_Asteroid_03", name: "Bruin Drift", kind: "belt",
    detail: "Asteroid field · iron-bearing · lightly worked", slot: 5, distance: 9.3, size: 300, rocks: 110 },
  { id: "space_SM_Env_Asteroid_05", name: "The Long Scatter", kind: "belt",
    detail: "Asteroid field · strung out · poorly charted", slot: 8, distance: 12.6, size: 420, rocks: 140 },
  { id: "space_SM_Env_Asteroid_07", name: "Cinder Bank", kind: "belt",
    detail: "Asteroid field · burnt rock · no claim filed", slot: 12, distance: 16.7, size: 340, rocks: 120 },

  { id: "space_SM_Veh_WarpGate_Outer_01", name: "Threshold Gate", kind: "gate",
    detail: "Warp gate · destination unset · do not approach under power", slot: 4, distance: 8.2, size: 90 },
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

/** Everything that is not a planet, in its place. */
export function furnitureLayout(): Array<Omit<SpaceBody, "object"> & { rocks?: number; slotSeed: number }> {
  return FURNITURE.map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.kind,
    detail: f.detail,
    /* Half a step round the lattice from the planets, so nothing sits inside
       a world. */
    at: latticeDirection(f.slot, 0.5).multiplyScalar(EARTH_D * f.distance),
    slotSeed: f.slot * 13.7,
    diameter: f.size,
    tint: 0xffffff,
    spin: f.kind === "gate" ? 0.12 : 0.03,
    axis: new THREE.Vector3(Math.sin(f.slot * 2.1), 1, Math.cos(f.slot * 1.3)).normalize(),
    rocks: f.rocks,
  }));
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

  for (const spec of furnitureLayout()) {
    const holder = new THREE.Group();
    holder.position.copy(spec.at);
    group.add(holder);
    const { rocks, ...rest } = spec;
    bodies.push({ ...rest, object: holder });

    void loadModel(spec.id)
      .then((proto) => {
        if (dead) return;
        if (rocks) {
          /* A FIELD, not one big rock. The same model over and over at
             different sizes and attitudes, spread through a flattened blob:
             cloning shares the geometry, so a hundred of them cost one. */
          for (let i = 0; i < rocks; i++) {
            const rock = unitCopy(proto, { unlit: true });
            /* Deterministic scatter, so the field is the same field every
               time, like everything else out here. */
            const a = hash(i * 3.1 + spec.slotSeed);
            const b = hash(i * 7.7 + spec.slotSeed);
            const c = hash(i * 11.3 + spec.slotSeed);
            const r = spec.diameter * 0.5 * Math.cbrt(a);
            const theta = b * Math.PI * 2;
            const phi = Math.acos(2 * c - 1);
            rock.position.set(
              r * Math.sin(phi) * Math.cos(theta),
              /* Flattened, because a belt is a disc rather than a ball. */
              r * Math.cos(phi) * 0.28,
              r * Math.sin(phi) * Math.sin(theta),
            );
            rock.rotation.set(a * 7, b * 7, c * 7);
            rock.scale.setScalar(spec.diameter * (0.012 + a * 0.03));
            holder.add(rock);
          }
        } else {
          const model = unitCopy(proto, { unlit: true });
          model.scale.setScalar(spec.diameter);
          holder.add(model);
        }
      })
      .catch(() => { /* one missing station is not a broken sky */ });
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
