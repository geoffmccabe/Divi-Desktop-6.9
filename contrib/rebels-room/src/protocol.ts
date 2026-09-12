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
  /** Which hull they fly, and how it is painted, so everyone else sees the
   *  ship this player actually built rather than a stand-in. Carried on the
   *  wire because it is the difference between a room full of people and a
   *  room full of identical grey arrows. */
  ship?: string;
  paint?: PaintWire;
  /** What the player has bought: weapon and item keys from the catalogues.
   *  The client's word, as the paint is; see the room for what that means. */
  gear?: string[];
  /** Half the hull's wingspan in world units: how far out a gem or sphere is
   *  captured. Clamped by the room. */
  reach?: number;
}

/**
 * A paint scheme, small enough to send.
 *
 * Five parts, each a hue, a saturation, a brightness and an overlay, in the
 * order the cockpit keeps them. An array rather than an object because it is
 * sent for every player in a room and `{"hull1":{"hue":205,...}}` is mostly
 * punctuation.
 */
export type PaintPart = [hue: number, sat: number, bright: number, overlay: number];
export type PaintWire = [PaintPart, PaintPart, PaintPart, PaintPart, PaintPart];

export interface TransformIn {
  t: "tf";
  p: Vec;
  f: Vec;
  /** Guard up. The room decides whether they HAVE a guard to raise. */
  g?: 1;
}

export interface FireIn {
  t: "fire";
  k: "main" | "mini" | "torp" | "beam";
  p: Vec;
  f: Vec;
  /** Mini gun only: where the pointer was aiming. */
  a?: Vec;
  /** Beam only: which one, a weapon key such as "beam2". */
  w?: string;
  /** The ship's up, so the two muzzles sit at the ship's sides however it
   *  is rolled. Without it the room used "away from the planet", and a
   *  rolled ship's guns fired from two strange angles (Geoff). */
  u?: Vec;
}

export interface DetonateIn { t: "det" }

/** Cash out: pay what this account has banked to a DIVI address. */
export interface ClaimIn {
  t: "claim";
  to: string;
}

/** Ask for the purse again. Sent when the player opens the points panel. */
export interface PurseIn { t: "purse" }

/** Use a held Instant Recharge or Supercharge (Y). The count is the
 *  client's, as the gear is; the room only paces it. */
export interface UseIn { t: "use"; k: "recharge" | "supercharge" }

/** The resupply at a tower finished. The room checks the ship is at one. */
export interface DockIn { t: "dock" }

/** What this ship carries, when it changes mid-flight: a gun bought, a sphere
 *  opened, four things forged. Without this the server only ever knew what was
 *  declared on join, and anything bought while flying did nothing. */
export interface GearIn { t: "gear"; gear: string[]; reach?: number }

/** The cockpit's flight model says the ship hit the ground or a tower, and by
 *  how much. See the room's onHurt for what is and is not trusted here. */
export interface HurtIn { t: "hurt"; d: number }

/** This node just won a stake, which is worth a minute of triple damage.
 *  The client's word, as the gear is, so the room caps how often it counts. */
export interface BonusIn { t: "bonus" }

/** A test cheat ("21" the dragon, "1x" a flock of tier x). Marked to remove
 *  with the cockpit's cheat key. */
export interface CheatIn { t: "cheat"; code: string }

export type ClientMessage =
  JoinIn | TransformIn | FireIn | DetonateIn | ClaimIn | PurseIn | UseIn | DockIn | CheatIn | BonusIn | GearIn | HurtIn;

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
  /** [x,y,z, fx,fy,fz, tier, shield, shieldMax, kind (0 fighter, 1 drone, 2 dragon), id] */
  E: Array<[number, number, number, number, number, number, number, number, number, number?, number?]>;
  /** [x,y,z, vx,vy,vz, hostile, mini] */
  B: Array<[number, number, number, number, number, number, number, number]>;
  /** [x,y,z] */
  C: Array<[number, number, number]>;
  /** Beams in the air: origin, direction, weapon key, seconds left. Absent
   *  when there are none, which is nearly always. */
  M?: Array<[number, number, number, number, number, number, string, number]>;
  /** Torpedoes in the air: position and velocity. Absent when none. */
  T?: Array<[number, number, number, number, number, number]>;
  /** Gems in the world: position, tier, spin, id, and for a dropped ITEM its
   *  catalogue key, owner seat and seconds it stays theirs alone. A private
   *  drop is sent only to its owner. Absent when there are none. */
  G?: Array<[number, number, number, number, number, string, string?, string?, number?]>;
}

/** One thing that happened, for sound and sparks. */
export interface EventOut {
  t: "e";
  v: Array<{ k: string; at: Vec; p: number; who?: string; tier?: number; sh?: number; dmg?: number; wave?: number; g?: 1; gem?: string; item?: string; id?: string }>;
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
  /** Seconds of triple damage left, when there are any. */
  bonus?: number;
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

/**
 * Who is in the room.
 *
 * Sent when somebody joins or leaves rather than every tick: a name and a paint
 * scheme change about once a session, and putting them in the twenty-times-a-
 * second state message would be sending the same forty bytes per player four
 * thousand times a minute to say nothing.
 */
export interface RosterOut {
  t: "who";
  players: Array<{
    id: string;
    /** What to show above their ship. */
    name: string;
    node: string;
    ship: string;
    paint?: PaintWire;
  }>;
}

/**
 * The account, as the ledger has it. Sent on join, on request, and after a
 * claim. `why` carries the refusal when a claim was not accepted.
 */
export interface PurseOut {
  t: "purse";
  /** Banked and not yet paid, whole DIVI. */
  divi: number;
  /** What a claim would pay right now: zero under the minimum. */
  claimable: number;
  /** Paid out, ever. */
  paid: number;
  /** A cash-out waiting for the treasury, if there is one. */
  pending: { to: string; amount: number; at: number } | null;
  /** How the last one ended. */
  last: { to: string; amount: number; txid?: string; error?: string; at: number } | null;
  why?: string;
  /** Flock kills, ever, and gems held, one count per tier. */
  flocks?: number;
  gems?: number[];
  /** Items picked up in rooms, by catalogue key: the room's count. */
  items?: Record<string, number>;
}

export type ServerMessage =
  WelcomeOut | StateOut | EventOut | YouOut | DeniedOut | RosterOut | PurseOut;

/** Shorten a float for the wire. A tenth of a unit is six metres on this globe. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;
