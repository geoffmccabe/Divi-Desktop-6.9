// How far a player is told about.
//
// The room used to send everybody the whole world, including a fight on the
// far side of a planet they could not see. These are the ranges past which a
// thing is not worth a player's bandwidth, one per kind, because they are not
// equally visible or equally dangerous.
//
// Ranges are in world units. Earth is 100 across; the outer planets sit some
// thousands of units out. A ship is drawn with a name plate to about 420 and
// is a dot well before that.

import * as THREE from "three";

/* ---- WHERE THESE NUMBERS COME FROM ----
   Not from the size of the world, which is thousands of units across, but
   from the size of a FIGHT. A fighter shoots at seventy units. A swarm hunts
   at two hundred and twenty. A rival's name plate stops being drawn at four
   hundred and twenty, past which they are a dot with nothing readable on
   them. The first numbers here were nine hundred and seven hundred, which
   sounded careful and were useless: the whole shell of sky around Earth is
   about seven hundred units across, so every player could see every other
   player and every fighter, and nothing was saved at all. */
export const VIEW = {
  /** Other ships, to a little past where their name plate gives up. */
  ships: 450,
  /** Fighters and swarms: half again the range a swarm hunts from, so one
   *  is on screen well before it has decided to come for you. */
  enemies: 340,
  /** Beams are bright and long, and a beam you cannot see is a beam that
   *  kills you from nowhere. */
  beams: 620,
  /**
   * Rounds in the air.
   *
   * A round travels about 240 units a second and lives a little over two, so
   * this is most of its flight: anything fired at you from inside this comes
   * into view before it arrives. Shorter would mean invisible incoming fire,
   * which is the one saving worth refusing.
   */
  /* Just past the range a ship is visible at, which is the invariant that
     matters: if you can see who fired, you can see what they fired. At three
     hundred and thirty a rival four hundred units away could put rounds
     through you that were never drawn. Rounds cost almost nothing at this
     range because a shot is announced once, on the tick it is taken, and not
     twenty times a second for its whole flight. */
  shots: 470,
  /** Torpedoes: slower, bigger, and worth seeing early. */
  torpedoes: 430,
  /** Coins. They scatter where you killed something, you fly through them
   *  seconds later, and there are hundreds: near is enough. */
  loot: 210,
  /**
   * Gems and dropped spheres, which are a different thing entirely.
   *
   * They are rare, they persist in the world, and the whole point of one is
   * that you go and get it: a flock's gem is left wherever its last member
   * fell, which is routinely three hundred units from where you were
   * fighting. Invisible until you were on top of it would mean flying a
   * search pattern for something you had earned. There are only ever a
   * handful in the sky, so a generous range costs almost nothing.
   */
  gems: 700,
  /** Wreckage. Small, and solid, so it matters only where you are flying. */
  junk: 210,
  /**
   * How far away something can happen and still be worth hearing.
   *
   * Explosions are big and bright, so this is generous: further than you can
   * see a coin, about as far as you can spot a gem. Beyond it a bang is a
   * sound from nowhere, which is what every player got when every event went
   * to everybody. Anything that happened to you or by you reaches you at any
   * distance, and a wave arriving or the dragon appearing reaches everyone.
   */
  events: 700,
} as const;

/** Cheap enough to run per player per entity: no square roots. */
export function inRange(a: THREE.Vector3, b: THREE.Vector3, r: number): boolean {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/**
 * Whether a fight this far away is worth sending at all.
 *
 * A straight distance test per player per thing, rather than a grid. At the
 * sizes this game is built for (a couple of dozen ships and a few hundred
 * other things) that is a few thousand comparisons a tick, which is nothing,
 * and a spatial index would be a structure to keep correct for no gain. If a
 * room ever holds hundreds of players, bucket the world and scan the buckets
 * a player's ranges touch; the ranges above do not change.
 */
export const VIEW_MAX = Math.max(...Object.values(VIEW));
