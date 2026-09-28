// Turning one of Geoff's enemy definitions into a ship that is actually flying.
//
// Phase 3's other half. enemyTypes.ts says what an enemy IS; this makes one.
//
// The whole job is a translation between two shapes that do not line up. An
// EnemyType carries thirteen things a person typed into a panel. A flying Enemy
// carries a ShipClass, which has room for five of them - a name, health, a
// colour, a speed and a spawn weight - and nowhere at all for resistance,
// cadence, reach, shot speed or worth. Those five now travel separately, as the
// EnemyTune the simulation reads (see Enemy.tune in rebelsCombat.ts).
//
// SO A CUSTOM ENEMY IS BUILT IN TWO MOVES: spawn the built-in whose BRAIN it
// wants, then overwrite what it brought with it. Nothing here spawns anything.
// The room does that, because only the room knows where the players are, and
// then hands the result through here.
//
// THE TRAP THIS FILE EXISTS TO AVOID
// ----------------------------------
// `TIERS` in rebelsCombat.ts is a module-level array of seven ShipClass objects
// and every fighter of a tier holds a REFERENCE to the same one. So the obvious
// way to give a custom enemy five thousand health -
//
//     e.cls.shieldMax = t.shieldMax          // NEVER THIS
//
// - does not give that enemy five thousand health. It gives every Blue Fighter
// in the room five thousand health, for the life of the room, including ones
// already flying and every one that spawns afterwards, and it survives the game
// ending because the array is the module's and the module is the worker's. One
// custom enemy would quietly rewrite the game's difficulty table.
//
// So the class is CLONED, always, even when nothing about it is changing. The
// test for this is the most important one in the file.
//
// WHAT CANNOT BE HONOURED YET, and it is worth being plain about: the LOOK. The
// wire sends an enemy's tier, not its colour or its hull (see packEnemy in
// broadcast.ts), and every cockpit draws the ship from that tier. So a custom
// enemy's health, toughness, speed, cadence, reach, shot speed, damage and worth
// are all real, and its paint is not - it wears the paint of the tier it was
// built from. `tierForType` therefore picks the tier that looks MOST LIKE what
// was asked for, which is the best that can be done without a wire change, and
// a wire change needs the cockpit half as well.

import type { Enemy, ShipClass } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { TIERS } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { DRONE_TIERS } from "../../../ui/src/wallet/rebels/rebelsFlock";
import { tuneFor, type EnemyType } from "../../../ui/src/wallet/rebels/enemyTypes";

/**
 * Which built-in tier a custom enemy should be SPAWNED as.
 *
 * Chosen by health, because health is what a tier reads as: the nearest one, so
 * something with four thousand shield arrives looking like a Fuchsia and
 * something with ninety looks like a Grey. It decides three things that are all
 * downstream of the tier and not of the definition:
 *
 *   - which ship every cockpit draws, since the wire carries the tier
 *   - how badly it aims, via aimErrorFor
 *   - which of the seven kill counters its death lands in
 *
 * None of those can be set independently today, so getting the tier as close as
 * possible is how a custom enemy looks and feels like the thing it claims to be.
 */
export function tierForType(t: EnemyType): number {
  const table: ReadonlyArray<{ shieldMax: number }> =
    t.behaviour === "drone" ? DRONE_TIERS : TIERS;
  let best = 1;
  let gap = Infinity;
  for (let i = 0; i < table.length; i++) {
    const d = Math.abs(table[i].shieldMax - t.shieldMax);
    /* Strictly nearer, so a tie goes to the LOWER tier: an enemy exactly
       between two should read as the gentler of them. */
    if (d < gap) { gap = d; best = i + 1; }
  }
  return best;
}

/**
 * The ship class a custom enemy should fly with: a COPY of the one it was
 * spawned as, with what the definition overrides written onto the copy.
 *
 * The tier is deliberately kept from the original rather than taken from the
 * definition, because the tier is an index into three other tables (see
 * tierForType) and a number that does not match the ship the cockpits are
 * drawing would break all three.
 */
export function classFor(t: EnemyType, base: ShipClass): ShipClass {
  return {
    ...base,
    name: t.name,
    shieldMax: t.shieldMax,
    colour: t.colour,
    speed: t.speed,
  };
}

/**
 * Make an already-spawned enemy into this custom one.
 *
 * Returns the same enemy, changed in place, because it is already in the
 * combat state's list and replacing it there would be a second thing to get
 * wrong.
 *
 * The shield is REFILLED rather than left alone. It was set from the tier's
 * health when the ship spawned, so a custom enemy with five thousand health
 * would otherwise arrive with a hundred and thirty of it and die to one pass
 * while its bar showed three percent.
 */
export function applyEnemyType(e: Enemy, t: EnemyType): Enemy {
  /* CLONED, ALWAYS. See the note at the top of this file: e.cls is shared with
     every other enemy of its tier and writing through it rewrites the game. */
  e.cls = classFor(t, e.cls);
  e.shield = t.shieldMax;
  e.tune = tuneFor(t);
  return e;
}

/** A definition by id, from a set. Undefined when nothing answers to that
 *  name, which the room treats as "a round asked for an enemy nobody has
 *  written" - a quiet gap in one round, never a room that will not start. */
export function typeById(
  types: readonly EnemyType[],
  id: string,
): EnemyType | undefined {
  return types.find((t) => t.id === id);
}
