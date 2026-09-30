// WHERE a game is played: one table, one row per place.
//
// Phase 2 of docs/DIVI-REBELS-GAME-BUILDER-PLAN.md. Geoff's definition of a
// game is "a combination of both a place, and a set of waves", and this is the
// first half of it: the places, as data.
//
// WHAT A PLACE IS
// ---------------
// A room, and a piece of space that room owns. Every place has a CENTRE, and
// every position in that place travels on the wire measured from it, which is
// the trick that let Spikeworld work at all: it sits about two hundred thousand
// units from Earth and the room refuses any coordinate past a hundred thousand,
// so an absolute position could never have been sent. Measured from the heart,
// the furthest corner of Spikeworld is under six thousand. See rebelsRegions.ts,
// where the translation happens, and there only.
//
// WHY IT IS A TABLE AND NOT A SWITCH
// ----------------------------------
// Earth and Spikeworld were two hard-coded branches, and the room asked
// `region === "spike"` in eight places to decide a floor, a ceiling, where a
// dead player comes back, and what lives there. Adding a third place that way
// means finding all eight. As a table, a new place is a row.
//
// THE LIST OF PLACE IDS IS NOT HERE. It lives in gameTypes.ts, which the
// gameplay session owns, and this file imports it. There was briefly a second
// copy here, written before that file landed, and a second copy is exactly how
// a game comes to name a place the room has never heard of. Importing it means
// a drift is a compile error rather than something one of us notices later.
//
// This file owns the GEOMETRY of a place - where its centre is, how far a ship
// may go - and gameTypes.ts owns WHICH places exist. One of us has to be able
// to add a place without the other, and it is easier to add a row of numbers
// here than a member to a union over there.

import * as THREE from "three";
import { R, MIN_ALT, MAX_ALT, PLANET_COUNT, planetCentre, planetDiameter } from "./orbitWorld";
import { SPIKEWORLD_CENTRE } from "./rebelsRegions";
import { R_OUTER, SKY_EDGE, ARRIVAL_OUT, toWorld } from "./voxel/voxelWorld";
import { PLACES as PLACE_ID_LIST, type PlaceId } from "./gameTypes";

export type { PlaceId };

/** What the room puts in front of the players here, which is the one thing a
 *  place cannot express as a number. Earth runs waves around towers;
 *  Spikeworld guards a heart; a planet is open space with whatever the game
 *  says in it and nothing of its own. */
export type PlaceKind = "earth" | "spike" | "planet";

export interface Place {
  id: PlaceId;
  /** What a player is told they are flying in. */
  name: string;
  kind: PlaceKind;
  /** This place's zero, in world coordinates. Everything on the wire in this
   *  room is measured from here. */
  centre: THREE.Vector3;
  /** How close to the centre a ship may come, and how far out it may go, both
   *  measured from the centre. The room refuses a position outside them. */
  floor: number;
  /**
   * How much further than Earth a pilot can see here.
   *
   * ⚠ THE VIEW RANGES IN rebelsView.ts ARE EARTH'S, and Earth's fight happens
   * close to the ground: VIEW.enemies is 340 units. Spikeworld is a hollow
   * sphere a player crosses from 5,760 units out to a heart at zero, so 340 is
   * a couple of percent of the world. The heart's sixty guards were being
   * spawned, flown and hit by the server and simply never SENT: one enemy row
   * on the wire while the room held sixty-one. Geoff: "There are no longer any
   * enemies appearing to defend the heart inside the spikeworld."
   *
   * Earth is exactly 1 and must stay exactly 1: the wire golden is a byte
   * recording of an Earth room, and any other value there would change it.
   */
  sight: number;
  ceiling: number;
  /**
   * Where a ship arrives, and where a dead one comes back, relative to the
   * centre.
   *
   * Null on Earth alone, and deliberately: there a player belongs at their OWN
   * tower, which is a different point for every one of them, so the room uses
   * the pad it was given at join instead. Everywhere else there are no pads and
   * everybody arrives at the same door.
   */
  arrival: THREE.Vector3 | null;
  /** Whether a game here can actually be played today. The planets are named
   *  so a game can be written for one before its room exists. */
  live: boolean;
}

/* ---- the fixed two ---- */

/** Earth orbit: the original world, centred on the globe the map draws. */
function earth(): Place {
  return {
    id: "earth", name: "Earth Orbit", kind: "earth",
    centre: new THREE.Vector3(),
    /* The flight model's own floor and ceiling, which is what the room has
       always checked a position against. */
    floor: R + MIN_ALT - 2,
    ceiling: R + MAX_ALT + 2,
    /* EXACTLY ONE. The wire golden is a byte recording of an Earth room. */
    sight: 1,
    arrival: null,
    live: true,
  };
}

/** Spikeworld: the hollow voxel world, centred on its heart. */
function spike(): Place {
  return {
    id: "spike", name: "Spikeworld", kind: "spike",
    centre: SPIKEWORLD_CENTRE.clone(),
    /* No ground and no sky in Earth's sense: a ship flies from outside the
       shell right down to the heart, which is a few hundred units from zero.
       Judging that by Earth's floor put every arriving pilot "outside the
       world" and snapped them onto their pad, which the room then read as a
       ship sitting inside the heart. */
    floor: 0,
    ceiling: toWorld(R_OUTER + SKY_EDGE),
    /* Enough that the whole inner cavity is visible from anywhere in it:
       VIEW.enemies * 7 is 2,380 against a cavity radius of 2,160. The test
       stands on that relationship rather than on the number 7, so changing
       either end fails loudly instead of making the guards invisible again. */
    sight: 7,
    arrival: new THREE.Vector3(0, 0, toWorld(R_OUTER + ARRIVAL_OUT)),
    live: true,
  };
}

/* ---- the fourteen ---- */

/** How far out a planet's bubble reaches, as a multiple of its own radius.
 *  Big enough to fight in and to run away across; small enough that a game at
 *  one planet is a place rather than the whole sky. */
export const PLANET_BUBBLE = 6;
/** Where a ship arrives at a planet, as a multiple of its radius: clear of the
 *  surface, well inside the bubble. */
export const PLANET_ARRIVAL = 2;
/** How far above the surface a ship may come, as a multiple of its radius.
 *  There is no landing and no docking out here, so the floor only has to keep
 *  ships out of the model. */
export const PLANET_FLOOR = 1.15;

/**
 * A planet as a place.
 *
 * Its centre is exactly where the sky already draws it (`planetCentre`), so a
 * game at Morrowain happens at the Morrowain a player has been looking at since
 * the first time they flew. Its size is the model's own, because the planets
 * are the one thing in this game that were never shrunk: Geoff, when everything
 * else halved, "The 'planets' which are 3D models around the earth, should NOT
 * be shrunk down".
 */
function planet(n: number, name: string): Place {
  const radius = planetDiameter(n) / 2;
  return {
    id: `p${n}` as PlaceId, name, kind: "planet",
    centre: planetCentre(n),
    floor: radius * PLANET_FLOOR,
    ceiling: radius * PLANET_BUBBLE,
    arrival: new THREE.Vector3(0, 0, radius * PLANET_ARRIVAL),
    /* Earth's, because a planet is Earth's kind of place: a surface flown over
       at Earth's scale, not a hollow sphere crossed end to end. Revisit only
       if one of these is ever made live and turns out to play differently. */
    sight: 1,
    /* Named, not reachable. A game can be written for one now; publishing it
       waits for somebody to decide what a planet actually has in it. */
    live: false,
  };
}

/** The planet names, in the order the sky lays them out. Kept here rather than
 *  imported so this table has no dependency on the drawing code; they are the
 *  same fourteen names and a test says so. */
const PLANET_NAMES = [
  "Kaldrane", "Vespera", "Orrus", "Thal", "Nyx Prime", "Cindral", "Halvex",
  "Brennik", "Auster", "Pallas Rey", "Wren", "Corvane", "Yggdral", "Morrowain",
];

/* ---- the table ---- */

const TABLE: Place[] = [
  earth(),
  spike(),
  ...Array.from({ length: PLANET_COUNT }, (_, i) => planet(i + 1, PLANET_NAMES[i] ?? `Planet ${i + 1}`)),
];

/** Every place, in order. */
export const PLACES: readonly Place[] = TABLE;

/** Every place id this table has geometry for, in order. */
export const PLACE_IDS: readonly PlaceId[] = TABLE.map((p) => p.id);

/** Every place id gameTypes.ts allows a game to name. Re-exported so a caller
 *  can ask "is this table complete?" without importing both files. */
export const NAMED_PLACE_IDS: readonly PlaceId[] = PLACE_ID_LIST;

/** The places a game can actually be played in today. */
export const LIVE_PLACE_IDS: readonly PlaceId[] = TABLE.filter((p) => p.live).map((p) => p.id);

const BY_ID = new Map<string, Place>(TABLE.map((p) => [p.id, p]));

/** The place with this id, or null. Never throws: an unknown id is a game
 *  pointed somewhere that does not exist, which the caller has to handle. */
export function placeById(id: string): Place | null {
  return BY_ID.get(id) ?? null;
}

/** Is this position inside the place's world? The one question the room asks
 *  of every position report, and the reason a place carries a floor at all. */
export function withinPlace(place: Place, fromCentre: number): boolean {
  return fromCentre >= place.floor && fromCentre <= place.ceiling;
}
