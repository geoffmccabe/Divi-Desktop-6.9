// The wire between a cockpit and the room.
//
// JSON, and deliberately so for this first version. A binary format is maybe
// four times smaller and is the right end state, but it is also the thing that
// makes a protocol impossible to debug from a browser console, and getting the
// AUTHORITY right matters far more than getting the bytes down. The shapes are
// kept flat and short-keyed so the change is mechanical when it comes.
//
// Read the direction names from the server's point of view: In is what it
// receives, Out is what it sends.

/** A vector on the wire. Rounded to a tenth of a unit; the globe is 200 across. */
export type Vec = [number, number, number];

/* ---- cockpit to room ---- */

export interface JoinIn {
  t: "join";
  /** The node this player is flying from. Identity in this game is the node,
   *  and the room takes it on trust only as far as the leaderboard: nothing
   *  that pays out is settled without the ledger checking it again. */
  node: string;
  name: string;
  /** Where their tower is, so the room can place them. */
  home: Vec;
}

export interface TransformIn {
  t: "tf";
  p: Vec;
  f: Vec;
  /** Guard up. The room decides whether they HAVE a guard to raise. */
  g?: 1;
}

export interface FireIn {
  t: "fire";
  k: "main" | "mini" | "torp";
  p: Vec;
  f: Vec;
  /** Mini gun only: where the pointer was aiming. */
  a?: Vec;
}

export interface DetonateIn { t: "det" }

export type ClientMessage = JoinIn | TransformIn | FireIn | DetonateIn;

/* ---- room to cockpit ---- */

export interface WelcomeOut {
  t: "hi";
  /** The seat. Everything about this player on the wire is keyed by it. */
  id: string;
  /** Server tick rate, so the client knows how to interpolate. */
  hz: number;
}

/** Everything visible, once per tick. Arrays rather than objects: a hundred
 *  bullets as `{pos:{x:..}}` is mostly punctuation. */
export interface StateOut {
  t: "s";
  n: number;
  /** Wave number, or 0 between waves. */
  w: number;
  /** [id, x,y,z, fx,fy,fz, guard, shield] */
  P: Array<[string, number, number, number, number, number, number, number, number]>;
  /** [x,y,z, fx,fy,fz, tier, shield, shieldMax] */
  E: Array<[number, number, number, number, number, number, number, number, number]>;
  /** [x,y,z, vx,vy,vz, hostile, mini] */
  B: Array<[number, number, number, number, number, number, number, number]>;
  /** [x,y,z] */
  C: Array<[number, number, number]>;
}

/** One thing that happened, for sound and sparks. */
export interface EventOut {
  t: "e";
  v: Array<{ k: string; at: Vec; p: number; who?: string; tier?: number; sh?: number; dmg?: number; wave?: number; g?: 1 }>;
}

/** This player's own gauges. Every one of these is the room's number, never
 *  the cockpit's: it is the whole point of the room existing. */
export interface YouOut {
  t: "you";
  shield: number;
  ammo: number;
  torps: number;
  guards: number;
  score: number;
  kills: number;
  /** Whole DIVI earned and not yet claimed. */
  divi: number;
  dead?: 1;
  /** Seconds until they can fly again. */
  respawn?: number;
}

/** The room refusing something, and saying why. Shown in the cockpit rather
 *  than swallowed: a player being quietly ignored is indistinguishable from a
 *  bug, and this is exactly where cheating and bugs look the same. */
export interface DeniedOut {
  t: "no";
  why: string;
  /** The room's idea of where they are, when it has snapped them back. */
  p?: Vec;
}

export type ServerMessage = WelcomeOut | StateOut | EventOut | YouOut | DeniedOut;

/** Shorten a float for the wire. A tenth of a unit is six metres on this globe. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;
