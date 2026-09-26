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

/** Which region a room name belongs to. Mirrors regionOf in the room's
 *  protocol.ts, and must agree with it: the cockpit uses this to know which
 *  origin to subtract, and being wrong by a region is being wrong by two
 *  hundred thousand units. */
export function regionOfRoom(name: string): RegionName {
  return /^spike(?:-\d{1,2})?$/.test(name) ? "spike" : "earth";
}
