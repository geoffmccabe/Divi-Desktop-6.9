// Swarms: alien spheres that fly as one body, then come apart into smaller
// bodies and make strafing runs.
//
// Kept in its own file, and with no THREE in it beyond Vector3, so the whole
// thing runs headless in node. A flock is the one part of this game where a
// bug is invisible until twenty-four things are on screen at once, which is
// exactly when it is hardest to see what went wrong, so it is tested instead.
//
// WHY THIS IS NOT PLAIN BOIDS
// ---------------------------
// Reynolds' three rules (separation, alignment, cohesion) make a convincing
// shoal, but a shoal has no shape: it wanders, it stretches, and it never
// arrives anywhere as a recognisable formation. What is wanted here is a
// GROUP that holds a shape, so the model is the one games actually use:
//
//   * the GROUP has a position and a heading, and flies the mission;
//   * each drone owns a SLOT, a fixed offset inside the group's own frame,
//     and steers toward it;
//   * separation from real neighbours runs on top, so a shove, a dead drone
//     or a corner never lets two of them occupy the same bit of sky.
//
// Slot-keeping replaces cohesion, and the group's heading replaces alignment.
// That is not a shortcut: it is what turns a shoal into a formation, and it
// also happens to be much cheaper, because cohesion and alignment become one
// lookup per drone instead of one loop per drone.

import * as THREE from "three";
import { R } from "./orbitWorld";

/* ---- the tiers ----
   Grey first, and the rest are Geoff's list: "grey/gold, then green, blue,
   purple, red". Health is fifty at tier one, as asked, and climbs from there;
   nothing else about a tier changes except how hard it is to kill, how fast it
   moves and what colour it glows. */
export interface DroneClass {
  tier: number;
  name: string;
  colour: number;
  /** The whole of its health. Fifty at tier one. */
  shieldMax: number;
  /** Multiplier on flying speed. */
  speed: number;
}

/* ---- THE SEVEN ----
   Geoff's colours, in his order: yellow, green, blue, purple, red, white,
   fuchsia. Health fifty at tier one and twenty-five more per tier, speed
   fifteen percent more per tier: the ramps he confirmed. */
const DRONE_COLOURS = [0xf5d90a, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];
const DRONE_NAMES = ["Yellow", "Green", "Blue", "Purple", "Red", "White", "Fuchsia"];
export const DRONE_TIERS: DroneClass[] = DRONE_COLOURS.map((colour, i) => ({
  tier: i + 1,
  name: DRONE_NAMES[i],
  colour,
  shieldMax: 50 + i * 25,
  speed: 1 + i * 0.15,
}));

/** How many arrive, by tier: "24, 28, 32, 36, 40, 44, 48". */
export const FLEET_SIZES = [24, 28, 32, 36, 40, 44, 48];
export function fleetSize(tier: number): number {
  return FLEET_SIZES[Math.max(0, Math.min(FLEET_SIZES.length - 1, Math.round(tier) - 1))];
}

/** How many extra shapes grow out of a drone, by tier: "6, 8, 10, 12, 14, 16"
 *  and 18 for the seventh, as agreed. Data for the drawing. */
export const SHAPE_COUNTS = [6, 8, 10, 12, 14, 16, 18];

/* ---- HOW RARE ----
   "70%, 21%, 6.3%, etc": each tier is three tenths as likely as the one
   below. Carried to seven and scaled to sum to one, so a roll always lands;
   the very top of the range is tier seven. */
export const TIER_ODDS: number[] = (() => {
  const raw = DRONE_TIERS.map((_, i) => 0.7 * Math.pow(0.3, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
})();

export function rollFlockTier(rnd: () => number = Math.random): number {
  /* Kept inside [0, 1): the top of the range is the rarest tier, and a roll
     of exactly one must land there rather than fall off the end. */
  let r = Math.min(Math.max(rnd(), 0), 1 - 1e-9);
  for (let i = 0; i < TIER_ODDS.length; i++) {
    r -= TIER_ODDS[i];
    if (r <= 0) return i + 1;
  }
  return 1;
}

/** "1% chance to spawn a flock each 5 seconds of gameplay." */
export const SPAWN_CHECK_SECONDS = 5;
export const SPAWN_CHANCE = 0.01;

/** A flock member is a fifth of a fighter: in kill count and in coins. */
export const DRONE_KILL_WORTH = 0.2;

/* ---- THE JOURNEY ----
   Flocks come from the nearest planet, which is a thousand units out or
   more. Geoff: "fly faster to Earth but it's okay if it takes a while." So
   they cross at several times fighting speed and drop to it inside
   HUNT_RANGE of their target. A flock whose prey is gone for GIVE_UP_SECONDS
   (dead, or out past the leash) turns for home and is gone when it gets
   there, so a dead room does not fill with idle drones. */
export const TRANSIT_SPEED = 5;
export const HUNT_RANGE = 220;
export const LEASH = 600;
export const GIVE_UP_SECONDS = 60;
export const HOME_ARRIVE = 40;

export function droneClass(tier: number): DroneClass {
  return DRONE_TIERS[Math.max(0, Math.min(DRONE_TIERS.length - 1, Math.round(tier) - 1))];
}

/** How many arrive in one fleet. The same at every tier: a tier is meant to be
 *  nastier, not longer. Twenty-four, and it divides by 2, 3, 4 and 6, which is
 *  the whole reason the split sizes work out even. */
export const FLEET_SIZE = 24;

/** Nothing beyond this many drones alive at once, whatever gets asked for.
 *  The simulation is cheap but it is not free, and a stuck key should not be
 *  able to bring the frame rate down. */
export const DRONE_CAP = 144;

/** Hit radius. Smaller than a fighter's, because a sphere really is a sphere
 *  and there are no wings sticking out of it. */
export const DRONE_R = 0.95;
/** Drawn radius. */
export const DRONE_SIZE = 0.8;

export const DRONE_SPEED = 8.2;
/** Radians a second. Higher than a fighter's 0.6: a sphere has no wings to
 *  bank, so a tighter turn does not read as cheating the way it would on
 *  something with a shape. It is still well under the player's. */
export const DRONE_TURN = 1.15;

/* ---- how a fleet behaves ----
   One body until it is close, then several bodies, each making its own run. */

/** Centroid this close to the player and the fleet comes apart. Set well
 *  outside firing range so the split is something you WATCH happen rather than
 *  something that goes on behind you. */
export const SPLIT_RANGE = 190;
/** The ways twenty-four can come apart. Geoff's list. */
export const SPLIT_PARTS = [2, 3, 4, 6];

/** Distance between neighbours inside a formation. */
export const FORM_SPACING = 5.4;
/** How hard a drone pulls toward its slot. */
export const W_SLOT = 1.0;
/** How hard it pushes off a neighbour that is too close. Deliberately the
 *  largest weight: everything else is cosmetic if two of them merge. */
export const W_SEPARATE = 2.2;
/** How much it matches the group's heading. Small, because the slot already
 *  carries most of the formation. */
export const W_ALIGN = 0.45;
/** How hard the group's mission pulls. */
export const W_GOAL = 1.25;
/** Planet avoidance, which has to be able to beat all of the above. */
export const W_AVOID = 3.0;
/** Anything closer than this gets pushed off. */
export const SEPARATE_R = FORM_SPACING * 0.85;
/** Two drones are never allowed closer than this, whatever the steering
 *  wanted. A little over two body radii, so they can brush but never merge. */
export const TOUCH_R = DRONE_R * 2.1;

/** Below this height a drone climbs, hard. Same idea as the fighters' floor. */
export const DRONE_FLOOR = 22;

/** Seconds between shots, per drone. Geoff: "at most one bullet each 30
 *  seconds". With twenty-four of them that is still a shot every second and a
 *  bit from the fleet as a whole, which is plenty. */
export const DRONE_RELOAD = 30;
/** Fraction of a normal round's speed. */
export const DRONE_BULLET_SPEED = 0.8;
export const DRONE_FIRE_RANGE = 95;

/** How close a run presses before the group breaks off, and how far it runs
 *  before turning back. */
export const RUN_BREAK = 16;
export const RUN_REJOIN = 130;
/** A run gives up after this long even if it never got close. */
export const RUN_SECONDS = 14;

/** Seconds of flash expansion at the moment a fleet comes apart. */
export const SPLIT_FLASH = 0.28;
/** Radians each piece turns away from the fleet's heading as it leaves. Forty
 *  degrees: under about thirty and a split reads as a wobble. */
export const SPLIT_TURN = 0.7;

/**
 * What a group of drones is doing.
 *
 * The group is the thing with a plan. Individual drones have no plan at all:
 * they hold their slot and push off each other, and everything that reads as
 * intent comes from here.
 */
export type FlockPhase = "transit" | "hunt" | "leave";

export interface FlockGroup {
  id: number;
  /** Crossing from its planet, fighting, or going home. */
  phase: FlockPhase;
  /** The planet it came from, and returns to. */
  home: THREE.Vector3;
  /** Seconds without anyone to hunt. */
  idle: number;
  /** Which fleet it was born in, so a fleet can be counted or cleared. */
  fleet: number;
  tier: number;
  /**
   * `form`  travelling in as one body, holding station
   * `run`   committed to a pass at the player
   * `away`  broken off, running for distance on a held heading
   */
  mode: "form" | "run" | "away";
  /** Where the formation centre is trying to be. */
  aim: THREE.Vector3;
  /** The heading held while breaking off. Held rather than recomputed, or
   *  "away from the player" curves gently back into them and the pass becomes
   *  an orbit. The fighters learned this the hard way. */
  escape: THREE.Vector3;
  /** Which side this group comes in from, as an offset direction. What stops
   *  four sub-groups flying up the same corridor in single file. */
  approach: THREE.Vector3;
  /** Seconds before this group starts its run. Staggered across the
   *  sub-groups so they arrive one after another. */
  wait: number;
  /** Seconds left on the current run. */
  timer: number;
  /** Set once the fleet this group belongs to has come apart, so it cannot
   *  split again and again on the way in. */
  split: boolean;
  /** Live centroid and heading, recomputed each step. */
  centre: THREE.Vector3;
  fwd: THREE.Vector3;
  /** How many are still alive in it. Zero means the group is finished. */
  alive: number;
  /**
   * Seconds left of the burst of mutual repulsion that fires at the instant of
   * a split.
   *
   * Reynolds names this in the 1987 paper: "flash expansion", where "the
   * mutual desire to avoid collision drives the boids radially away". It is a
   * quarter of a second of separation turned up and slot-keeping turned off,
   * and it is what makes the split land as a visible EVENT. Without it the
   * groups drift apart over several seconds and the player never sees the
   * moment it happened.
   */
  flash: number;
}

/** The bits a drone carries that an ordinary fighter does not. Mixed into the
 *  Enemy record rather than kept in a parallel list, so a drone dies, drops
 *  wreckage and takes damage through exactly the same code a fighter does. */
export interface DroneBits {
  drone: true;
  /** Which group it flies in. Changes when its fleet splits. */
  group: number;
  fleet: number;
  /** Its place in the formation, an index into the group's slot lattice. */
  slot: number;
  /** Phase offset so the whole swarm does not pulse in unison. */
  pulse: number;
  /** Spawned by the cheat key. Worth no DIVI and no score: a key that makes
   *  enemies out of nothing must not also make money out of nothing. */
  cheat?: boolean;
}

/**
 * Where the drones of a group sit relative to its centre.
 *
 * A Fibonacci sphere, which is the standard way to put n points on a ball with
 * no two of them bunched. Even spacing is the entire requirement here ("keeping
 * a certain distance from each other") and hashing or randomising the offsets
 * does not give it: the same lattice was already tried and rejected once in
 * this game, when fourteen randomly-placed planets came out in a heap on one
 * side of the sky.
 *
 * The radius is chosen so the NEAREST-NEIGHBOUR gap comes out at the spacing
 * asked for whatever n is. n points spread over a sphere of radius r each own
 * about 4*pi*r^2/n of surface, so the gap between them goes as r*sqrt(4*pi/n);
 * turning that round gives the radius below. A group of four is a tight little
 * diamond and a group of twenty-four is a ball fifteen units across, and both
 * have the same gap between neighbours.
 */
const slotMemo = new Map<number, THREE.Vector3[]>();

/**
 * The slot lattice for a group of n, cached.
 *
 * Cached because this is called once per group per frame and it used to build
 * a fresh array of twenty-four vectors every time. At sixty frames a second
 * with four groups alive that is nearly six thousand throwaway objects a
 * second, and the measured risk in a flock this size is not the arithmetic, it
 * is the garbage collector pausing the frame. The lattice for a given n never
 * changes, so it is built once and read for ever after. Callers MUST NOT write
 * to what comes back.
 */
export function slotOffsets(n: number, spacing = FORM_SPACING): THREE.Vector3[] {
  if (spacing === FORM_SPACING) {
    const hit = slotMemo.get(n);
    if (hit) return hit;
  }
  const out = buildSlots(n, spacing);
  if (spacing === FORM_SPACING) slotMemo.set(n, out);
  return out;
}

function buildSlots(n: number, spacing: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  if (n <= 0) return out;
  if (n === 1) return [new THREE.Vector3()];
  const radius = spacing * Math.sqrt(n / (4 * Math.PI));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    /* Evenly in cos(latitude), which is what makes it even in AREA rather than
       even in angle: spacing by angle alone crowds both poles. */
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(radius));
  }
  return out;
}

/**
 * How a fleet comes apart: `parts` groups as near equal as they divide.
 *
 * Twenty-four into three is 8, 8, 8. Twenty-three into three is 8, 8, 7, which
 * is what keeps this honest once a few of them have been shot down before the
 * split.
 */
export function splitSizes(total: number, parts: number): number[] {
  const out: number[] = [];
  let left = total;
  for (let i = parts; i > 0; i--) {
    const take = Math.round(left / i);
    out.push(take);
    left -= take;
  }
  return out.filter((n) => n > 0);
}

/** Pick one of the splits at random, never into groups of one. A lone drone is
 *  not a group, it is a straggler, and it flies like one. */
export function pickSplit(total: number, rnd: () => number = Math.random): number[] {
  const usable = SPLIT_PARTS.filter((p) => total / p >= 2);
  if (!usable.length) return [total];
  const parts = usable[Math.floor(rnd() * usable.length)] ?? usable[0];
  return splitSizes(total, parts);
}

/**
 * The bits of a drone this file needs to fly it.
 *
 * Structural rather than an import of Enemy, because the combat file imports
 * THIS one and a cycle between the two would be a real problem in a bundle
 * that is loaded as one inline script.
 */
export interface FlockDrone {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  cls: { speed: number };
  group: number;
  slot: number;
  /** Seconds until this one may fire again. */
  fireAt: number;
  /** Knockback from being shot, which flying has to work on top of. */
  vel: THREE.Vector3;
}

/** Somewhere for a group to be told about the world it is flying in. */
export interface FlockWorld {
  playerPos: THREE.Vector3;
  /** The nearest living player to a point, or null when nobody is alive.
   *  Absent, playerPos is everyone. */
  nearest?: (from: THREE.Vector3) => THREE.Vector3 | null;
  /** A group has reached home and is done: remove its drones. */
  despawn?: (groupId: number) => void;
  /** The open-space speed multiplier at a given height, so a swarm out among
   *  the planets can keep up with a player who is also moving faster there.
   *  The fighters had to learn this: without it the sky quietly empties. */
  scale: (alt: number) => number;
}

let nextGroupId = 1;
let nextFleetId = 1;
/** Test hook. Ids leaking across tests make assertions about them worthless. */
export function resetFlockIds(): void { nextGroupId = 1; nextFleetId = 1; }

/** A direction at right angles to `v`, picked at random. Used for approach
 *  offsets and for escape headings. */
function sideways(v: THREE.Vector3): THREE.Vector3 {
  const out = new THREE.Vector3().randomDirection().cross(v);
  if (out.lengthSq() < 1e-9) out.set(1, 0, 0).cross(v);
  if (out.lengthSq() < 1e-9) out.set(0, 1, 0).cross(v);
  return out.normalize();
}

/**
 * Start a fleet: one group, `count` slots, coming in from a distance.
 *
 * Returns the group and the slot indices to hand out. Making the drones
 * themselves is the combat file's job, because a drone is an Enemy and only
 * that file knows how to build one.
 */
export function newGroup(
  fleet: number, tier: number, at: THREE.Vector3, heading: THREE.Vector3,
  home: THREE.Vector3 | null = null,
): FlockGroup {
  return {
    id: nextGroupId++,
    phase: home ? "transit" : "hunt",
    home: home ? home.clone() : at.clone(),
    idle: 0,
    fleet,
    tier,
    mode: "form",
    aim: at.clone(),
    escape: heading.clone().normalize(),
    approach: sideways(heading),
    wait: 0,
    timer: RUN_SECONDS,
    split: false,
    centre: at.clone(),
    fwd: heading.clone().normalize(),
    alive: 0,
    flash: 0,
  };
}

export function newFleetId(): number { return nextFleetId++; }

/**
 * Fly every group and every drone for one step.
 *
 * The order matters and is the whole design:
 *
 *   1. count who is alive in each group, and retire the empty ones;
 *   2. fly each GROUP as though it were a single ship on a mission;
 *   3. fly each DRONE toward the slot its group's frame puts it in.
 *
 * Step two is one piece of work per group, not per drone, which is why a
 * hundred and forty-four of these cost about what a dozen fighters do.
 */
export function stepFlock(
  groups: FlockGroup[], drones: FlockDrone[], dt: number, w: FlockWorld,
): void {
  if (!groups.length) return;

  /* ---- 1. who is left ---- */
  const byGroup = new Map<number, FlockDrone[]>();
  for (const d of drones) {
    const list = byGroup.get(d.group);
    if (list) list.push(d); else byGroup.set(d.group, [d]);
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    g.alive = byGroup.get(g.id)?.length ?? 0;
    if (g.alive === 0) groups.splice(i, 1);
  }
  if (!groups.length) return;

  /* ---- 2. the mission ---- */
  const toPlayer = new THREE.Vector3();
  const want = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const born: FlockGroup[] = [];

  for (const g of groups) {
    const prey = w.nearest ? w.nearest(g.centre) : w.playerPos;
    toPlayer.copy(prey ?? w.playerPos).sub(g.centre);
    const range = toPlayer.length();
    toPlayer.divideScalar(range || 1);

    if (g.wait > 0) g.wait -= dt;
    if (g.flash > 0) g.flash = Math.max(0, g.flash - dt);

    /* ---- the journey: crossing, fighting, going home ---- */
    if (prey && range <= LEASH) g.idle = 0; else g.idle += dt;
    let quick = 1;
    if (g.phase === "transit") {
      if (prey && range <= HUNT_RANGE) {
        g.phase = "hunt";
        g.mode = "form";
      } else {
        want.copy(toPlayer);
        quick = TRANSIT_SPEED;
      }
    } else if (g.phase === "hunt" && g.idle >= GIVE_UP_SECONDS) {
      g.phase = "leave";
    }
    if (g.phase === "leave") {
      want.copy(g.home).sub(g.centre);
      const left = want.length();
      want.divideScalar(left || 1);
      quick = TRANSIT_SPEED;
      if (left <= HOME_ARRIVE) {
        w.despawn?.(g.id);
        g.alive = 0;
      }
    }

    if (g.phase === "hunt" && g.mode === "form") {
      /* Come in as one body, aimed a little to one side of the player rather
         than straight down their throat, so the fleet arrives ACROSS the view
         instead of appearing as a dot that gets bigger. */
      want.copy(toPlayer).addScaledVector(g.approach, 0.35).normalize();

      if (!g.split && range < SPLIT_RANGE) {
        splitGroup(g, byGroup.get(g.id) ?? [], born);
      } else if (g.split && g.wait <= 0) {
        g.mode = "run";
        g.timer = RUN_SECONDS;
      }
    } else if (g.phase === "hunt" && g.mode === "run") {
      want.copy(toPlayer);
      g.timer -= dt;
      if (range < RUN_BREAK || g.timer <= 0) {
        g.mode = "away";
        /* STRAIGHT ON, and off to one side. At the merge the group is already
           pointed at the player, so holding that heading carries it through
           and out the far side, which is what a pass IS. Subtracting "toward
           the player" here would leave it still pointed at them: the fighters
           spent a whole release doing exactly that and loitering instead of
           passing. */
        g.escape.copy(g.fwd)
          .addScaledVector(sideways(g.fwd), 0.45)
          .normalize();
      }
    } else if (g.phase === "hunt") {
      want.copy(g.escape);
      if (range > RUN_REJOIN) {
        g.mode = "run";
        g.timer = RUN_SECONDS;
        g.approach.copy(sideways(toPlayer));
      }
    }

    /* Never into the planet, whatever the mission says. */
    const alt = g.centre.length() - R;
    if (alt < DRONE_FLOOR) {
      avoidPlanet(g.centre, g.fwd, alt, want, 2.4);
    }

    turnToward(g.fwd, want, DRONE_TURN * 0.85 * dt, axis);
    const open = w.scale(g.centre.length() - R);
    g.centre.addScaledVector(g.fwd, DRONE_SPEED * droneClass(g.tier).speed * open * quick * dt);
    g.aim.copy(g.centre);
  }
  for (const g of born) groups.push(g);
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i].alive === 0) groups.splice(i, 1);

  /* ---- 3. the drones ---- */
  const slotCache = new Map<number, THREE.Vector3[]>();
  const frames = new Map<number, { right: THREE.Vector3; up: THREE.Vector3; fwd: THREE.Vector3 }>();
  for (const g of groups) {
    const n = byGroup.get(g.id)?.length ?? g.alive;
    slotCache.set(g.id, slotOffsets(Math.max(1, n)));
    /* The formation's own frame: nose along the group's heading, "up" away
       from the planet. Built from the group rather than from any one drone, so
       a drone being shoved about does not roll the whole formation with it. */
    const up = g.centre.clone().normalize();
    const right = new THREE.Vector3().crossVectors(g.fwd, up);
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0).cross(g.fwd);
    right.normalize();
    frames.set(g.id, { right, up: new THREE.Vector3().crossVectors(right, g.fwd).normalize(), fwd: g.fwd });
  }

  const byId = new Map<number, FlockGroup>();
  for (const g of groups) byId.set(g.id, g);

  const steer = new THREE.Vector3();
  const push = new THREE.Vector3();
  const slotAt = new THREE.Vector3();

  for (const d of drones) {
    const g = byId.get(d.group);
    if (!g) continue;
    const frame = frames.get(g.id)!;
    const slots = slotCache.get(g.id)!;
    const off = slots[d.slot % slots.length] ?? slots[0];

    /* Where this drone is supposed to be, in the world. */
    slotAt.copy(g.centre)
      .addScaledVector(frame.right, off.x)
      .addScaledVector(frame.up, off.y)
      .addScaledVector(frame.fwd, off.z);

    steer.copy(slotAt).sub(d.pos);
    const gap = steer.length();
    if (gap > 1e-4) steer.divideScalar(gap);
    /* During a flash expansion the slot is ignored entirely and separation is
       tripled, which is what throws the pieces apart at the moment of a split
       instead of letting them ooze. */
    const blown = g.flash > 0;
    steer.multiplyScalar(blown ? 0 : W_SLOT);

    /* Match the formation's heading. Small: the slot does most of the work,
       and leaning on alignment instead is what makes a flock wander. */
    steer.addScaledVector(frame.fwd, W_ALIGN);

    /* ---- separation ----
       Against EVERY other drone, not only the ones in this group, because two
       sub-groups crossing on their runs is exactly when they would otherwise
       fly through each other.

       This is the naive all-pairs loop and it stays that way on purpose. A
       spatial grid is the right answer at a few thousand agents; at the cap of
       a hundred and forty-four it is twenty thousand squared-distance tests a
       frame, which is a fraction of a millisecond, and it would cost more to
       BUILD the grid each frame than the loop it replaces. */
    for (const o of drones) {
      if (o === d) continue;
      push.copy(d.pos).sub(o.pos);
      const d2 = push.lengthSq();
      if (d2 > SEPARATE_R * SEPARATE_R || d2 < 1e-9) continue;
      /* Falls off with distance, so a neighbour just inside the radius nudges
         and one about to touch shoves. Dividing by the raw distance rather
         than clamping is how boids end up flinging a pair of agents apart at
         infinite speed when they land on top of each other. */
      const gapTo = Math.sqrt(d2);
      push.multiplyScalar((blown ? W_SEPARATE * 3 : W_SEPARATE)
        * (1 - gapTo / SEPARATE_R) / gapTo);
      steer.add(push);
    }

    /* The mission, felt directly as well as through the slot. Keeps a drone
       that has been knocked well out of formation still flying the attack
       rather than only chasing its place in it. */
    want.copy(g.mode === "away" ? g.escape : toPlayerFrom(d.pos, w.playerPos, want));
    steer.addScaledVector(want, W_GOAL * 0.35);

    /* ---- the floor ---- */
    const alt = d.pos.length() - R;
    if (alt < DRONE_FLOOR) {
      avoidPlanet(d.pos, d.fwd, alt, steer, W_AVOID);
    }

    if (steer.lengthSq() > 1e-9) {
      steer.normalize();
      turnToward(d.fwd, steer, DRONE_TURN * d.cls.speed * dt, axis);
    }

    /* ---- speed ----
       A drone sitting in its slot flies at the formation's speed. One that has
       fallen behind is allowed to run faster to catch up, and one that has got
       ahead eases off. Without this a knocked-about drone could never rejoin,
       because it would be chasing something moving exactly as fast as it is. */
    const open = w.scale(alt);
    const base = DRONE_SPEED * d.cls.speed * open;
    const catchUp = Math.max(0.62, Math.min(1.4, 0.62 + gap / (FORM_SPACING * 2.2)));
    d.pos.addScaledVector(d.fwd, base * catchUp * dt);
    d.pos.addScaledVector(d.vel, dt);
    d.vel.multiplyScalar(1 - Math.min(1, dt * 2.2));

    if (d.pos.length() < R + 1.2) d.pos.normalize().multiplyScalar(R + 1.2);
    d.fireAt -= dt;
  }

  separateHard(drones);
}

/**
 * The last word on two drones occupying the same bit of sky: move them apart.
 *
 * Steering alone cannot promise this and it is worth being clear about why.
 * A drone can only TURN, at a bit over a radian a second, and two of them
 * closing head-on cover the gap between them in a fraction of the time that
 * turn would take. The separation force is doing the right thing and is simply
 * too late. Left at that, a long run put two of them within three quarters of
 * a unit of each other, which on bodies a unit and a half across is a merge:
 * twenty-four spheres that can pass through each other read as fewer than
 * twenty-four spheres, and no amount of tuning the weights hides it.
 *
 * So the soft force keeps them politely spaced and this hard pass guarantees
 * they never actually touch. Each of a too-close pair is moved half the
 * overlap, which conserves the pair's centre and so does not shove the
 * formation about. It is the same trick an RTS uses when units crowd a
 * doorway.
 */
function separateHard(drones: FlockDrone[]): void {
  const fix = new THREE.Vector3();
  for (let i = 0; i < drones.length; i++) {
    for (let j = i + 1; j < drones.length; j++) {
      const a = drones[i], b = drones[j];
      fix.copy(a.pos).sub(b.pos);
      const d2 = fix.lengthSq();
      if (d2 >= TOUCH_R * TOUCH_R) continue;
      /* Exactly coincident: they were spawned or shoved onto the same point
         and there is no direction to push along. Any direction will do, and it
         has to be taken rather than skipped, or the two stay welded together
         for the rest of the run. */
      if (d2 < 1e-8) {
        fix.set(1, 0, 0).addScaledVector(a.fwd, 0.5).normalize();
        a.pos.addScaledVector(fix, TOUCH_R * 0.5);
        b.pos.addScaledVector(fix, -TOUCH_R * 0.5);
        continue;
      }
      const gap = Math.sqrt(d2);
      fix.multiplyScalar((TOUCH_R - gap) / gap * 0.5);
      a.pos.add(fix);
      b.pos.sub(fix);
    }
  }
}

const _lat = new THREE.Vector3();
const _rad = new THREE.Vector3();

/**
 * Push a wanted heading away from the planet, SIDEWAYS.
 *
 * The obvious version adds "straight up" to the heading and is wrong, and
 * Reynolds says exactly why in the 1987 paper: a body approaching an obstacle
 * head-on into a radial force field gets pushed straight backwards, "serves
 * only to slow the boid... and provides no side thrust at all. The worst
 * reaction to an impending collision is to fail to turn."
 *
 * A drone diving at the surface is precisely that case: straight up is
 * straight behind it. So the radial push has its forward component taken out
 * first, leaving only the part that actually turns the thing. When the two are
 * so nearly opposed that nothing lateral is left, any perpendicular will do to
 * break the tie, and it is chosen from the body's own heading rather than at
 * random: a flock that re-rolled which way to dodge every frame would shimmer.
 */
export function avoidPlanet(
  pos: THREE.Vector3, fwd: THREE.Vector3, alt: number, into: THREE.Vector3, weight: number,
): void {
  _rad.copy(pos).normalize();
  /* The part of "away from the planet" that is not simply "slow down". */
  _lat.copy(_rad).addScaledVector(fwd, -_rad.dot(fwd));
  if (_lat.lengthSq() < 1e-6) {
    _lat.set(1, 0, 0).cross(fwd);
    if (_lat.lengthSq() < 1e-6) _lat.set(0, 1, 0).cross(fwd);
  }
  _lat.normalize();
  const urgency = 1 - Math.max(0, alt) / DRONE_FLOOR;
  into.addScaledVector(_lat, weight * urgency);
  /* A little of the raw radial as well, so a drone already flying level just
     above the surface still climbs instead of merely refusing to descend. */
  into.addScaledVector(_rad, weight * urgency * 0.35);
  into.normalize();
}

/** Reused scratch, filled with the unit vector from `from` to `to`. */
function toPlayerFrom(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(to).sub(from);
  const len = out.length();
  return len > 1e-6 ? out.divideScalar(len) : out.set(0, 0, 1);
}

/**
 * Turn a heading toward another, by at most `most` radians.
 *
 * THE HALF-TURN TRAP, again. A body pointed exactly opposite to where it wants
 * to go has no defined axis to turn about, because the cross product of two
 * antiparallel vectors is zero. Left alone it flies straight on for ever. That
 * is not a corner case: it is precisely where something that has just been
 * shoved backwards, or has just hit the floor pointing down, ENDS UP. Any
 * perpendicular will do to break the tie; a moment later the real axis takes
 * over.
 */
export function turnToward(
  fwd: THREE.Vector3, want: THREE.Vector3, most: number, axis = new THREE.Vector3(),
): void {
  const dot = Math.max(-1, Math.min(1, fwd.dot(want)));
  const off = Math.acos(dot);
  if (off < 1e-4) return;
  axis.crossVectors(fwd, want);
  if (axis.lengthSq() < 1e-9) {
    axis.set(1, 0, 0).cross(fwd);
    if (axis.lengthSq() < 1e-9) axis.set(0, 1, 0).cross(fwd);
  }
  axis.normalize();
  fwd.applyAxisAngle(axis, Math.min(off, most)).normalize();
}

/**
 * Break one group into several, and hand its drones out between them.
 *
 * The sub-groups keep flying in the direction the fleet was already going, but
 * each is pushed out to its own side and given its own moment to turn in. That
 * stagger is what makes the split READ as a decision rather than as a glitch:
 * they visibly peel apart and come at you one after another, instead of all
 * arriving together looking like the same single blob it was a second ago.
 */
function splitGroup(g: FlockGroup, members: FlockDrone[], born: FlockGroup[]): void {
  g.split = true;
  const sizes = pickSplit(members.length);
  if (sizes.length <= 1) {
    /* Too few left to be worth splitting. It just presses on alone. */
    g.mode = "run";
    g.timer = RUN_SECONDS;
    reslot(members);
    return;
  }

  /* The formation's own frame, which is also the frame the pieces are cut in. */
  const up = g.centre.clone().normalize();
  const right = new THREE.Vector3().crossVectors(g.fwd, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, g.fwd).normalize();

  /* ---- CUT IT SPATIALLY, NOT ARBITRARILY ----
     Every drone is measured by the angle it sits at around the group's nose,
     and the list is sorted by that angle before it is sliced. So each piece is
     a WEDGE of the ball that was there a moment ago, and the pieces are
     already apart before they are told to be.

     Handing out membership in list order instead would interleave them: the
     pieces would be scattered through each other and would have to untangle
     themselves in mid-air, which reads as a bug rather than as a decision.
     Reynolds' point about flocks bifurcating only works if the split is along
     a plane; the same is true of a deliberate one. */
  const angled = members.map((d) => {
    const rel = d.pos.clone().sub(g.centre);
    return { d, a: Math.atan2(rel.dot(realUp), rel.dot(right)) };
  }).sort((x, y) => x.a - y.a);

  /* Start the first wedge at the first drone, so the cuts fall between
     neighbours rather than through the densest part of the ball. */
  let taken = 0;
  for (let i = 0; i < sizes.length; i++) {
    const mine = angled.slice(taken, taken + sizes[i]).map((e) => e.d);
    taken += sizes[i];
    if (!mine.length) continue;

    /* The side this piece leaves on is the middle of its own wedge, so it
       carries on outward in the direction it was already sitting. */
    const mid = angled[Math.min(angled.length - 1, taken - Math.ceil(sizes[i] / 2))];
    const side = right.clone().multiplyScalar(Math.cos(mid.a))
      .addScaledVector(realUp, Math.sin(mid.a));
    if (side.lengthSq() < 1e-9) side.copy(right);
    side.normalize();

    const part: FlockGroup = i === 0 ? g : {
      ...g,
      id: nextGroupId++,
      centre: g.centre.clone(),
      fwd: g.fwd.clone(),
      aim: g.aim.clone(),
      escape: g.escape.clone(),
      approach: side.clone(),
    };

    part.approach.copy(side);
    part.split = true;
    part.mode = "form";
    /* One after another, a couple of seconds apart, so they arrive in
       sequence rather than as one wall. */
    part.wait = i * 2.1;
    part.timer = RUN_SECONDS;
    part.flash = SPLIT_FLASH;
    /* Pushed out to its own side, and TURNED to face that way as well.
       Position alone is not enough: research on this is blunt that anything
       under about thirty degrees of divergence reads as the flock wobbling
       rather than as it dividing. Forty is comfortably past that. */
    part.centre.addScaledVector(side, FORM_SPACING * 2.4);
    turnToward(part.fwd, side, SPLIT_TURN);

    for (const d of mine) d.group = part.id;
    reslot(mine);

    if (i > 0) born.push(part);
  }
}

/** Hand out slot indices 0..n-1. Called after any change of membership, or a
 *  group of four would still be using four scattered indices out of a
 *  twenty-four point lattice and would fly as a loose scatter rather than as a
 *  tight diamond. */
export function reslot(members: FlockDrone[]): void {
  for (let i = 0; i < members.length; i++) members[i].slot = i;
}
