// The rows the room sends every tick, written down ONCE.
//
// The room packs the world into small arrays (a player is nine numbers, an
// enemy eleven) and every cockpit unpacks them by position. Each side used to
// keep its own copy of that layout, one in contrib/rebels-room/src/room.ts and
// one in rebelsRoom.ts, so changing either without the other broke the game
// silently. It has happened: every join was once refused because the two ends
// disagreed about the shape of a vector.
//
// Now there is one layout per row kind, here, with the room calling the pack
// functions and the cockpit calling the unpack functions. The bytes are exactly
// what they were before this file existed: contrib/rebels-room/test/wireGolden
// compares the room's messages character for character with a recording made
// first, because installed apps and open pages still decode with the code they
// were built with.
//
// No THREE in here, so the room, the cockpit, tests and any future client can
// all use it: an unpack takes a function that makes whatever vector the caller
// wants.

/** A position or direction as the simulation holds it. */
export interface V3 { x: number; y: number; z: number }
/** Makes the caller's own vector type from three numbers. */
export type MakeVec<V> = (x: number, y: number, z: number) => V;

/** A tenth of a unit, which is six metres on this globe. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/* ---- P: a ship ----
   [seat id, x, y, z, forward x, y, z, guard up (1/0), shield] */
export type PlayerRow = [string, number, number, number, number, number, number, number, number];
export function packPlayer(id: string, pos: V3, fwd: V3, guard: boolean, shield: number): PlayerRow {
  return [id, r1(pos.x), r1(pos.y), r1(pos.z), r1(fwd.x), r1(fwd.y), r1(fwd.z), guard ? 1 : 0, Math.max(0, Math.round(shield))];
}
export function unpackPlayer<V>(row: PlayerRow, vec: MakeVec<V>) {
  return { id: row[0], pos: vec(row[1], row[2], row[3]), fwd: vec(row[4], row[5], row[6]), guard: row[7] === 1, shield: row[8] };
}

/* ---- E: an enemy ----
   [x, y, z, forward x, y, z, tier, shield, shield max, kind (0 fighter, 1 drone, 2 dragon), enemy id] */
export type EnemyRow = number[];
export function packEnemy(
  pos: V3, fwd: V3, tier: number, shield: number, shieldMax: number,
  kind: { drone?: boolean; dragon?: boolean }, id: number | undefined | null,
): EnemyRow {
  return [
    r1(pos.x), r1(pos.y), r1(pos.z), r1(fwd.x), r1(fwd.y), r1(fwd.z),
    tier, Math.max(0, Math.round(shield)), shieldMax,
    kind.dragon ? 2 : kind.drone ? 1 : 0, id ?? 0,
  ];
}
export function unpackEnemy<V>(e: EnemyRow, vec: MakeVec<V>) {
  return {
    pos: vec(e[0], e[1], e[2]), fwd: vec(e[3], e[4], e[5]),
    tier: e[6], shield: e[7], shieldMax: e[8], drone: e[9] === 1, dragon: e[9] === 2, id: e[10] || 0,
  };
}

/* ---- F: a shot fired this tick ----
   [round id, x, y, z, velocity x, y, z, flags (1 hostile, 2 mini gun, 4 orb), seconds left] */
export type ShotRow = number[];
export function packShot(
  id: number | undefined, pos: V3, vel: V3, flags: { hostile?: boolean; mini?: boolean; orb?: boolean }, life: number,
): ShotRow {
  return [
    id ?? 0, r1(pos.x), r1(pos.y), r1(pos.z), r1(vel.x), r1(vel.y), r1(vel.z),
    (flags.hostile ? 1 : 0) | (flags.mini ? 2 : 0) | (flags.orb ? 4 : 0),
    r2(life),
  ];
}
export function unpackShot<V>(f: ShotRow, vec: MakeVec<V>) {
  return {
    id: f[0], pos: vec(f[1], f[2], f[3]), vel: vec(f[4], f[5], f[6]),
    hostile: (f[7] & 1) !== 0, mini: (f[7] & 2) !== 0, orb: (f[7] & 4) !== 0, life: f[8],
  };
}

/* ---- X: rounds that stopped early ----
   A plain list of round ids; nothing to pack. */

/* ---- C: a DIVI coin ----
   [x, y, z] */
export type CoinRow = number[];
export function packCoin(pos: V3): CoinRow {
  return [r1(pos.x), r1(pos.y), r1(pos.z)];
}
export function unpackCoin<V>(k: CoinRow, vec: MakeVec<V>) {
  return { pos: vec(k[0], k[1], k[2]) };
}

/* ---- T: a torpedo ----
   [x, y, z, velocity x, y, z] */
export type TorpedoRow = number[];
export function packTorpedo(pos: V3, vel: V3): TorpedoRow {
  return [r1(pos.x), r1(pos.y), r1(pos.z), r1(vel.x), r1(vel.y), r1(vel.z)];
}
export function unpackTorpedo<V>(t: TorpedoRow, vec: MakeVec<V>) {
  return { pos: vec(t[0], t[1], t[2]), vel: vec(t[3], t[4], t[5]) };
}

/* ---- J: wreckage ----
   [x, y, z, rotation x, y, z, piece (0 body, 1 left wing, 2 right wing)] */
export type JunkRow = number[];
export type JunkPiece = "body" | "wingL" | "wingR";
export function packJunk(pos: V3, rot: V3, kind: string): JunkRow {
  return [r1(pos.x), r1(pos.y), r1(pos.z), r2(rot.x), r2(rot.y), r2(rot.z), kind === "wingL" ? 1 : kind === "wingR" ? 2 : 0];
}
export function unpackJunk<V>(j: JunkRow, vec: MakeVec<V>) {
  const kind: JunkPiece = j[6] === 1 ? "wingL" : j[6] === 2 ? "wingR" : "body";
  return { pos: vec(j[0], j[1], j[2]), rot: vec(j[3], j[4], j[5]), kind };
}

/* ---- M: a beam ----
   [x, y, z, direction x, y, z (to a thousandth), weapon key, seconds left] */
export type BeamRow = [number, number, number, number, number, number, string, number];
export function packBeam(pos: V3, fwd: V3, key: string, life: number): BeamRow {
  return [r1(pos.x), r1(pos.y), r1(pos.z), r3(fwd.x), r3(fwd.y), r3(fwd.z), key, r1(life)];
}
export function unpackBeam<V>(b: BeamRow, vec: MakeVec<V>) {
  return { pos: vec(b[0], b[1], b[2]), fwd: vec(b[3], b[4], b[5]), key: String(b[6]), life: Number(b[7]) || 0 };
}

/* ---- G: loot (a gem, or a dropped item sphere) ----
   [x, y, z, tier, spin, id] and, for an item, [..., item key, owner seat, private seconds left] */
export type GemRow = Array<number | string>;
export function packGem(
  pos: V3, tier: number, spin: number, id: string,
  item?: { key: string; owner?: string; hidden?: number },
): GemRow {
  return [
    r1(pos.x), r1(pos.y), r1(pos.z), tier, r2(spin), id,
    ...(item ? [item.key, item.owner ?? "", Math.round(item.hidden ?? 0)] : []),
  ];
}
export function unpackGem<V>(g: GemRow, vec: MakeVec<V>) {
  return {
    id: String(g[5]), tier: Number(g[3]) || 1,
    pos: vec(g[0] as number, g[1] as number, g[2] as number), spin: Number(g[4]) || 0,
    ...(g[6] ? { item: String(g[6]), owner: String(g[7] ?? ""), hidden: Number(g[8]) || 0 } : {}),
  };
}

/* ---- W: a wingman ----
   [owner seat id, formation slot, x, y, z, hull, hull max, tier] */
export type WingRow = [string, number, number, number, number, number, number, number];
export function packWing(owner: string, slot: number, pos: V3, hull: number, hullMax: number, tier: number): WingRow {
  return [owner, slot, r1(pos.x), r1(pos.y), r1(pos.z), Math.max(0, Math.round(hull)), hullMax, tier];
}
export function unpackWing<V>(v: WingRow, vec: MakeVec<V>) {
  return {
    owner: String(v[0]), slot: Number(v[1]) || 0, pos: vec(v[2], v[3], v[4]),
    hull: Number(v[5]) || 0, hullMax: Number(v[6]) || 1, tier: Number(v[7]) || 1,
  };
}
