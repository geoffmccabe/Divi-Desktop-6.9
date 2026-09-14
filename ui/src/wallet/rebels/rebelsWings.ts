// Drones: the wingmen that fly formation on your ship.
//
// Geoff's rules, 2026-Sep-11 and 12:
//   "Drones T1-T5 (wingmen 50/80/110/140/170% hull & damage, bullets
//    x1/1/1.25/1.5/1.75, 8 formation slots, half-size copy of the player's
//    ship, 1.5x ship width from centre, fire in unison)"
//   "they make a somewhat symmetrical pattern around you as they fill in
//    their spots. So left, right, top, bottom, top right, bottom left, top
//    left, bottom right in that order."
//   "if you have 2 or more then they begin to orbit around you slowly, 1
//    revolution per 15 seconds, and they always point in the same direction
//    as you do."
//   "drones get replenished along with your ship in the same way at the same
//    time."
//
// Everything here is geometry and arithmetic: where a slot is, how fast the
// ring turns, what a tier is worth. The server owns the wingmen themselves
// (see the room's stepWings); the cockpit uses these same functions only to
// know how big to draw things. One copy of the rules, as everywhere else.

import * as THREE from "three";
import { itemByKey, DRONE_SHARE, DRONE_ROUNDS, ITEM_TIER_MAX } from "./itemCatalog";

/** Eight places, in the order they are filled. */
export const WING_SLOTS: THREE.Vector3[] = [
  new THREE.Vector3(-1, 0, 0),    /* left */
  new THREE.Vector3(1, 0, 0),     /* right */
  new THREE.Vector3(0, 1, 0),     /* top */
  new THREE.Vector3(0, -1, 0),    /* bottom */
  new THREE.Vector3(1, 1, 0),     /* top right */
  new THREE.Vector3(-1, -1, 0),   /* bottom left */
  new THREE.Vector3(-1, 1, 0),    /* top left */
  new THREE.Vector3(1, -1, 0),    /* bottom right */
].map((v) => v.normalize());

export const WING_MAX = WING_SLOTS.length;
/** One revolution every fifteen seconds, and only with two or more. */
export const WING_SPIN_SECONDS = 15;
export const WING_SPIN_MIN = 2;
/** How far out the ring sits: one and a half times the ship's WIDTH, which is
 *  twice its half-span (the same measurement the capture ball uses). */
export const WING_WIDTHS = 1.5;
/** Kept sane whatever hull is flown. */
export const WING_RADIUS_MIN = 5;
export const WING_RADIUS_MAX = 26;
/** Drawn at half the owner's size. */
export const WING_SCALE = 0.5;

/** The ring's radius for a ship whose half-span is `reach`. */
export function wingRadius(reach: number): number {
  const r = WING_WIDTHS * 2 * Math.max(0, reach);
  return Math.min(WING_RADIUS_MAX, Math.max(WING_RADIUS_MIN, r));
}

/** How far round the ring has turned after `seconds`, for `count` wingmen. */
export function wingSpin(seconds: number, count: number): number {
  if (count < WING_SPIN_MIN) return 0;
  return ((seconds % WING_SPIN_SECONDS) / WING_SPIN_SECONDS) * Math.PI * 2;
}

/**
 * Where one wingman sits.
 *
 * The slot is a direction in the ship's own frame, turned about the ship's
 * nose by the ring's spin, so the whole formation rolls together and every
 * wingman keeps its own place in it.
 */
export function wingPosition(
  owner: { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 },
  slot: number,
  spin: number,
  reach: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const off = WING_SLOTS[((slot % WING_MAX) + WING_MAX) % WING_MAX];
  const up = _up.copy(owner.up).addScaledVector(owner.fwd, -owner.up.dot(owner.fwd));
  if (up.lengthSq() < 1e-9) up.set(0, 1, 0).addScaledVector(owner.fwd, -owner.fwd.y);
  up.normalize();
  const right = _right.crossVectors(up, owner.fwd).normalize();
  /* The slot, in the ship's frame. */
  out.copy(right).multiplyScalar(off.x).addScaledVector(up, off.y);
  /* Rolled about the nose. */
  if (spin !== 0) out.applyAxisAngle(owner.fwd, spin);
  return out.multiplyScalar(wingRadius(reach)).add(owner.pos);
}
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

/** What a tier of wingman is worth, as a share of the player's own ship. */
export function wingShare(tier: number): number {
  const t = Math.min(ITEM_TIER_MAX, Math.max(1, Math.round(tier)));
  /* A forged tier past the top carries the top's power, as every other
     family does. */
  return DRONE_SHARE[Math.min(DRONE_SHARE.length, t) - 1];
}

/** And how many rounds it carries, against the player's own magazine. */
export function wingRounds(tier: number): number {
  const t = Math.min(ITEM_TIER_MAX, Math.max(1, Math.round(tier)));
  return DRONE_ROUNDS[Math.min(DRONE_ROUNDS.length, t) - 1];
}

/**
 * Which wingmen a player flies with, from what they hold.
 *
 * Best tier first, eight at most, so somebody holding one of each flies the
 * strongest eight they own. Counts rather than a set, because two T3 drones
 * are two wingmen and the armoury's owned-set cannot say that.
 */
export function wingTiers(counts: Record<string, number>): number[] {
  const out: number[] = [];
  for (let tier = ITEM_TIER_MAX; tier >= 1 && out.length < WING_MAX; tier--) {
    const spec = itemByKey(`drone${tier}`);
    if (!spec) continue;
    const n = Math.max(0, Math.floor(counts[`drone${tier}`] ?? 0));
    for (let i = 0; i < n && out.length < WING_MAX; i++) out.push(tier);
  }
  return out;
}
