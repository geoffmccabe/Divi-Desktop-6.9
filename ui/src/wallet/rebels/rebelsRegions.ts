// The regions, and where each one sits in the world.
//
// A REGION IS A ROOM. Geoff: "for spikeworld, make it multiplayer now as a
// second region." There are two, and they are the same kind of thing: one
// Durable Object, one roster, one simulation, one wire. What differs is what
// the room puts in front of the players (Earth has waves and towers,
// Spikeworld has a guarded heart) and where in space it is.
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// Spikeworld's centre is a thousand Earth diameters away, which is about two
// hundred thousand units. The room refuses any coordinate past a hundred
// thousand, and it is right to: the check is what stops one bad cockpit
// reporting a position at infinity and dragging everyone's aim with it.
//
// So a region's positions go on the wire RELATIVE TO ITS OWN CENTRE. In the
// Earth room the centre is the planet and nothing changes; in the Spikeworld
// room the centre is the heart, and a ship at the far edge of the shell is four
// and a half thousand units from zero instead of two hundred thousand. Same
// validator, same wire, no special cases anywhere else.
//
// The translation happens in exactly two places, both in rebelsRoom.ts: the
// vector maker every unpack is handed, and the one function that writes a
// vector out. Everything upstream and downstream works in world coordinates and
// never knows this happened.

import * as THREE from "three";
import { EARTH_D } from "./orbitWorld";
import { DISTANCE_IN_EARTHS } from "./voxel/voxelWorld";

export type RegionName = "earth" | "spike";

/** Spikeworld's centre, in world coordinates: the heart itself. */
export const SPIKEWORLD_CENTRE = new THREE.Vector3(0, 0, DISTANCE_IN_EARTHS * EARTH_D);

/** Where a region's own zero is, in world coordinates. Earth's is the planet,
 *  which is already the world's zero, so nothing moves there. */
export function regionOrigin(region: RegionName): THREE.Vector3 {
  return region === "spike" ? SPIKEWORLD_CENTRE : new THREE.Vector3();
}

/** The room name a region starts at. Its overflow rooms are this with a number
 *  after them, which the server decides; see nextRoom in the room's protocol. */
export function regionRoom(region: RegionName): RegionName {
  return region;
}

/* ================= READING A ROOM'S NAME =================
   A room name carries three things, and until now three different places each
   knew part of it: this file, protocol.ts in the room, and the door's own
   charset. That is the shape of bug that caught us repeatedly in a day, and
   this one had already gone wrong - the version here read `spike_descent` as
   EARTH, which would have put a cockpit's origin two hundred thousand units
   from where the room thought it was, silently, for ever.

   So there is one reader, and it lives HERE rather than in the room, because
   every other thing both halves share lives on this side and the room imports
   it: rebelsWire, rebelsCombat, voxelWorld, gameTypes, enemyTypes,
   rebelsPlaces. protocol.ts already imports r1 from rebelsWire, so a parser
   there that this file imported would be a cycle - and would drag the room's
   protocol into the web bundle, which does not otherwise contain a byte of it.

   THE GRAMMAR

     earth              earth, room 1, the place's own game
     earth-2            earth, room 2, the place's own game
     earth_shakedown    earth, room 1, the game "shakedown"
     spike-3_descent    spike, room 3, the game "descent"

   `-` was already the overflow separator, so the game uses `_`, which the
   door's charset ([A-Za-z0-9_-]) already accepts and nothing else uses. */

export interface RoomName {
  region: RegionName;
  /** 1 for the first room, 2 and up for its overflow rooms. */
  overflow: number;
  /** The game this room runs, or null for the place's own. */
  game: string | null;
}

/** The most overflow rooms a region may have. Mirrors ROOM_OVERFLOW_MAX in
 *  the room's protocol.ts; roomNameParse.test.ts stands on the two agreeing. */
export const OVERFLOW_MAX = 16;

const NAME = /^(earth|spike)(?:-(\d{1,2}))?(?:_([a-z0-9][a-z0-9-]{1,38}[a-z0-9]))?$/;

/**
 * Read a room name, or null if it is not one.
 *
 * Null rather than a guess, deliberately. The old version here defaulted
 * anything it did not recognise to Earth, which is how `spike_descent` became
 * a silent two-hundred-thousand-unit error. A caller that cannot name the
 * region should be made to say what it wants to do about that.
 */
export function parseRoom(name: string): RoomName | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const overflow = m[2] === undefined ? 1 : Number(m[2]);
  if (overflow < 1 || overflow > OVERFLOW_MAX) return null;
  /* "earth-1" is not a name: room one is written without a number, so
     allowing both would make two names for one room. */
  if (m[2] !== undefined && overflow === 1) return null;
  return { region: m[1] as RegionName, overflow, game: m[3] ?? null };
}

/** The inverse. parseRoom and this must round-trip; the test stands on it. */
export function roomNameOf(parts: RoomName): string {
  const n = parts.overflow > 1 ? `${parts.region}-${parts.overflow}` : parts.region;
  return parts.game ? `${n}_${parts.game}` : n;
}

/** Which region a room name belongs to, or null if it names no room. */
export function regionOfRoom(name: string): RegionName | null {
  return parseRoom(name)?.region ?? null;
}

/** The game a room runs, or null for the place's own. */
export function gameOfRoom(name: string): string | null {
  return parseRoom(name)?.game ?? null;
}

/** The overflow room after this one, or "" when there is nowhere left. The
 *  GAME travels with it: a player pushed out of a full earth_shakedown lands
 *  in earth-2_shakedown and not in a different game. */
export function nextRoomName(name: string): string {
  const p = parseRoom(name);
  if (!p || p.overflow >= OVERFLOW_MAX) return "";
  return roomNameOf({ ...p, overflow: p.overflow + 1 });
}
