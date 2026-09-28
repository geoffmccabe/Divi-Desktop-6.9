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
  /**
   * "web" when the player came in through divi.love/rebels rather than the
   * app. Their ledger account is kept apart from the address's app account
   * (two people in one house, one on each, must not share a balance), and a
   * web guest cannot cash out until they sign in. Absent from the app, which
   * is therefore exactly as before. Taken on the client's word, and a lie only
   * hurts the liar: claiming "web" gives up cashing out.
   */
  door?: "web";
  /**
   * A web guest's own id: random, made once in their browser and kept there, and
   * never shown to anyone. The guest's DIVI is banked under it, so it follows
   * them between visits and between internet connections rather than being tied
   * to an address that changes. Ignored unless `door` is "web".
   */
  guest?: string;
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
  /** How many wingmen of each tier this account holds, tier one first. Counts
   *  rather than keys, because two T3 drones are two wingmen. */
  drones?: number[];
  /** What this player holds in their DIVI wallet, which sets how long they wait
   *  to respawn. Absent where the door has no wallet to look in, which is the
   *  web today. The client's word, like the gear; see respawnSeconds. */
  divi?: number;
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

/**
 * LAUNCH was pressed: this player is now in the fight.
 *
 * Joining a room and FLYING in it are two different things, and the room used
 * to treat them as one. The cockpit joins the moment the map hands over its
 * scene, because the connection has to be up and settled before anybody
 * launches; but the seat was then counted as a player straight away, so the
 * waves began, the fighters spawned and they all came for a ship parked on its
 * pad while the human was still reading the launch card. Geoff, 2026-Sep-13:
 * "when the game starts it seems to have the player taking damage almost
 * instantly and I don't know why."
 *
 * So a seat is in the fight only between this message and its death.
 */
export interface FlyIn { t: "fly" }

/**
 * GONE somewhere the room's world does not reach.
 *
 * The other half of FlyIn. The room's world is Earth's neighbourhood, and a
 * ship that has left it entirely must stop being part of the fight: otherwise
 * the room goes on simulating a body at the last place it was told about, and
 * the fighters there go on shooting it. Geoff, 2026-Sep-16, after the first
 * trip to Spikeworld: "i was taking damage from what appeared to be invisible
 * enemies. I think the system thought I was somewhere else than where I
 * actually was." It did, and it was right to: nobody had told it.
 *
 * The seat is kept, with its gear and its earnings; it simply is not flying.
 * FlyIn brings it back.
 */
export interface AwayIn { t: "away" }

/** The resupply at a tower finished. The room checks the ship is at one. */
export interface DockIn { t: "dock" }

/** What this ship carries, when it changes mid-flight: a gun bought, a sphere
 *  opened, four things forged. Without this the server only ever knew what was
 *  declared on join, and anything bought while flying did nothing. */
export interface GearIn {
  t: "gear"; gear: string[]; reach?: number; drones?: number[];
  /** What the wallet holds, when the door finds out after joining. Sets the
   *  respawn wait; see respawnSeconds. */
  divi?: number;
}

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
  JoinIn | FlyIn | AwayIn | TransformIn | FireIn | DetonateIn | ClaimIn | PurseIn | UseIn | DockIn | CheatIn | BonusIn | GearIn | HurtIn;

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
  /**
   * Rounds FIRED this tick: id, where from, how fast, flags (1 hostile,
   * 2 mini gun, 4 a swarm drone's orb), and how long it lives.
   *
   * Not where every round in the sky is, twenty times a second. A round has
   * no decisions in it, and the cockpit runs the same simulation the server
   * does, so it is told the shot and flies the round itself. This was two
   * thirds of everything on the wire.
   */
  F?: Array<[number, number, number, number, number, number, number, number, number]>;
  /** Rounds that stopped EARLY, by id: hit something, or went into the
   *  planet. One that simply ran out of life needs no telling, since every
   *  cockpit counts the same life down. */
  X?: number[];
  /** [x,y,z] */
  C: Array<[number, number, number]>;
  /** Beams in the air: origin, direction, weapon key, seconds left. Absent
   *  when there are none, which is nearly always. */
  M?: Array<[number, number, number, number, number, number, string, number]>;
  /** Torpedoes in the air: position and velocity. Absent when none. */
  T?: Array<[number, number, number, number, number, number]>;
  /** Wreckage in orbit: where, how it is turned, and which piece (0 body,
   *  1 left wing, 2 right wing). It is solid, so a round that hits it is
   *  spent: the cockpit has to draw it or shots vanish against nothing. */
  J?: Array<[number, number, number, number, number, number, number]>;
  /** Wingmen: whose, which of the eight places, where, hull, hull max, tier.
   *  They always point where their owner points, so no heading is sent.
   *  Absent when nobody in the room flies any. */
  W?: Array<[string, number, number, number, number, number, number, number]>;
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

/**
 * This room is full: go to `next` instead. Sent the moment a socket arrives at a
 * full room, just before it is closed. A browser cannot read the HTTP status of a
 * refused websocket, so a plain refusal would only ever look like the network
 * failing and be retried against the same full room forever.
 */
export interface FullOut {
  t: "full";
  /** The overflow room to try, or "" when every overflow room is taken too. */
  next: string;
}

export type ServerMessage =
  WelcomeOut | StateOut | EventOut | YouOut | DeniedOut | RosterOut | PurseOut | FullOut;

/**
 * THE ROOMS THAT MAY EXIST.
 *
 * "earth" is the one shared world. When it is full, players overflow into
 * "earth-2", then "earth-3", up to "earth-16": still multiplayer, and nobody is
 * ever locked out. "p1" to "p14" are held for the planet shards (network plan,
 * phase 7). Anything else is refused at the door, because every name is a Durable
 * Object and a name anyone could invent is an object anyone could create.
 *
 * "spike" is THE SECOND REGION, and it overflows the same way. Geoff: "for
 * spikeworld, make it multiplayer now as a second region." It is a room in
 * exactly the sense earth is: one Durable Object, the same simulation, the same
 * wire. What differs is what the room puts in it (see REGIONS in room.ts): no
 * Earth waves, no towers, a guarded heart instead.
 *
 * The two are separate objects, so an Earth fight and a Spikeworld fight run at
 * the same time without either paying for the other, and a player who flies
 * through the gate leaves one roster and joins the other.
 */
export const ROOM_OVERFLOW_MAX = 16;
/** The regions a player can be in. One name each; the overflow rooms of a
 *  region are the same region with a number after them. */
export const REGION_NAMES = ["earth", "spike"] as const;
export type RegionName = (typeof REGION_NAMES)[number];

/**
 * A room name, taken apart.
 *
 * ⚠ THE ONE READER FOR A ROOM NAME. There were four, and they disagreed.
 *
 * A name carries three things: the region it is in, which overflow copy of it
 * this is, and WHICH GAME is being played there. The last is what lets a player
 * pick a game at all: a room is one simulation with one sky, so two people in
 * it cannot be playing different games, and the choice therefore has to be
 * which ROOM to join rather than a per-player setting. See the game builder
 * plan. That also means Geoff can have as many Earth games as he likes instead
 * of only the first.
 *
 *     earth              earth,  no overflow, the place's own game
 *     earth-2            earth,  overflow 2,  the place's own game
 *     earth_shakedown    earth,  no overflow, the game "shakedown"
 *     spike-3_descent    spike,  overflow 3,  the game "descent"
 *
 * WHY IT IS HERE AND EXPORTED. The cockpit had its own copy of this rule
 * (regionOfRoom in rebelsRegions.ts) and it did not have the game suffix, so
 * "spike_descent" parsed as EARTH. The cockpit would then subtract Earth's
 * origin instead of Spikeworld's, every position it reported would be two
 * hundred thousand units out, the room would refuse them all as outside the
 * world, and the player would be snapped back for ever with nothing logged
 * anywhere. One rule, in one file, imported by everything that needs it, is the
 * only shape that cannot drift - and the compiler catches the next person
 * rather than a player discovering it.
 */
export interface RoomName {
  region: RegionName;
  /** 1 for the first room, 2 upward for overflow. */
  overflow: number;
  /** The game's id, or null for the place's own game. */
  game: string | null;
}

/** Room names split on `_`: the place and its overflow to the left, the game to
 *  the right. `-` was taken by overflow and `_` was free in the name charset. */
const ROOM = /^(earth|spike)(?:-(\d{1,2}))?(?:_([a-z0-9][a-z0-9-]{1,38}[a-z0-9]))?$/;

/** Take a room name apart, or null if it is not a room name at all. */
export function parseRoom(name: string): RoomName | null {
  const m = ROOM.exec(name);
  if (!m) return null;
  const overflow = m[2] === undefined ? 1 : Number(m[2]);
  if (m[2] !== undefined && !(overflow >= 2 && overflow <= ROOM_OVERFLOW_MAX)) return null;
  return { region: m[1] as RegionName, overflow, game: m[3] ?? null };
}

/** Build a room name from its parts. The inverse of parseRoom, so the two
 *  cannot drift: the test puts every name through both. */
export function roomNameOf(r: RoomName): string {
  const over = r.overflow > 1 ? `-${r.overflow}` : "";
  return `${r.region}${over}${r.game ? `_${r.game}` : ""}`;
}

/** Which region a room name belongs to, or null if it is not a region room.
 *  One reader for the name, so the door, the room and the cockpit cannot
 *  disagree about what "spike-3" is. */
export function regionOf(name: string): RegionName | null {
  return parseRoom(name)?.region ?? null;
}

/** Which game a room is playing, or null for the place's own. */
export function gameOf(name: string): string | null {
  return parseRoom(name)?.game ?? null;
}

export function roomNameOk(name: string): boolean {
  if (regionOf(name)) return true;
  const p = /^p(\d{1,2})$/.exec(name);
  return !!p && Number(p[1]) >= 1 && Number(p[1]) <= 14;
}
/** Where to send someone when this room is full, or "" when there is nowhere. */
export function nextRoom(name: string): string {
  const r = parseRoom(name);
  if (!r) return "";
  /* ⚠ THE GAME COMES WITH THEM. A player pushed out of a full earth_shakedown
     must land in earth-2_shakedown and not in plain earth-2, which is a
     different game entirely and would look like the room changing under them
     for no reason. */
  return r.overflow < ROOM_OVERFLOW_MAX
    ? roomNameOf({ ...r, overflow: r.overflow + 1 })
    : "";
}
/** A guest id worth trusting as a key: long, random-looking, nothing odd in it. */
export function guestIdOk(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{16,64}$/.test(id);
}

/** Shorten a float for the wire. A tenth of a unit is six metres on this globe.
 *  One definition, shared with the cockpit: see ui/src/wallet/rebels/rebelsWire.ts. */
export { r1 } from "../../../ui/src/wallet/rebels/rebelsWire";
