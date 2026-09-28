// Sample enemies and games, so there is something in the database to look at.
//
// Geoff: "you can make 2 more sample ones and name them something that sounds
// like a space fighter game quest. Make a nice progression... so that helps us
// test the database and then I can change them or delete them or whatever, but
// we have something to work with."
//
// ORDINARY ROWS, NOT BUILT-INS, and that is the whole point of where they
// live. A built-in is in the code and cannot be deleted; these are seeded into
// the tables when the migrations run, so Geoff can edit them, rename them or
// throw them away from the panel like anything he makes himself. If he deletes
// them they stay deleted - re-running a migration will not put them back.
//
// The names follow the sky's own: Kestrel Anchorage, Ardent Reach, Colm
// Vantage, Low Verge. Spare, a bit naval, no adjectives doing the work.

import type { EnemyType } from "./enemyTypes";
import type { GameType } from "./gameTypes";

/* ================= TWO ENEMIES =================
   Between them they cover the two ends the built-in tiers do not: something
   FASTER and flimsier than a tier one, and something SLOWER and far harder
   than a tier seven. That is what makes them useful as samples rather than as
   decoration - each one is a different problem to shoot at. */

export function sampleEnemies(): EnemyType[] {
  return [
    {
      id: "shrike",
      name: "Shrike",
      behaviour: "fighter",
      /* A pale hot orange: reads as a spark going past. */
      colour: 0xff9a3c,
      fireColour: 0xffd27a,
      /* Half a tier one's health and nearly twice its speed. It should die to
         one clean burst and be very hard to give one. */
      shieldMax: 55,
      resistance: 0,
      speed: 1.9,
      /* Fires often and lightly: a nuisance that adds up rather than a threat
         that lands once. */
      fireEvery: 1.1,
      fireRange: 60,
      shotSpeed: 1.35,
      damage: 0.6,
      worth: 1.5,
    },
    {
      id: "warden",
      name: "Warden",
      behaviour: "fighter",
      /* Cold steel blue, against the Shrike's spark. */
      colour: 0x7f93a8,
      fireColour: 0x9fe0ff,
      /* Four tier-sevens' health AND half damage taken, so about eight times
         the work. Slow enough to run away from, which is the point: it is an
         obstacle you choose to fight rather than one that catches you. */
      shieldMax: 1400,
      resistance: 0.5,
      speed: 0.55,
      /* Rarely, and it hurts. */
      fireEvery: 3.4,
      fireRange: 95,
      shotSpeed: 0.85,
      damage: 3,
      worth: 8,
    },
  ];
}

/* ================= TWO GAMES =================
   A progression, which is what was asked for. Read in order they are:

     Shakedown          five short rounds, Earth, nothing that fights back hard
     (Wave Defence)     the built-in: endless, escalating, the main event
     Descent            Spikeworld, eight rounds, ends on two Wardens

   Shakedown exists to be finished on the first try. Descent exists not to be.
   The built-in sits between them and is not touched. */

/** Rounds of the mixed wave, escalating, as the built-in does. */
const wave = (count: number, bias: [number, number]) =>
  ({ enemy: "fighters", count, arrive: "spread" as const, bias });

export function sampleGames(): GameType[] {
  return [
    {
      id: "shakedown",
      name: "Shakedown",
      place: "earth",
      crew: "multiplayer",
      published: true,
      /* Short rounds and few of them: a whole game inside seven minutes, so
         somebody can find out whether they like this at all without
         committing to an hour. */
      rounds: [
        /* Bias pinned LOW so the first round is almost all tier ones. A new
           pilot meeting a tier five in their first ninety seconds learns the
           wrong lesson. */
        { seconds: 90, spawns: [wave(6, [0.5, 0.8])] },
        { seconds: 90, spawns: [wave(8, [0.5, 1.0])] },
        { seconds: 90, spawns: [wave(10, [0.6, 1.4])], award: { divi: 5 } },
        /* The first Shrike, on its own, so it is met rather than survived. */
        { seconds: 90, spawns: [wave(10, [0.6, 1.4]), { enemy: "shrike", count: 2, arrive: "once" }] },
        { seconds: 120, spawns: [wave(12, [0.8, 1.8]), { enemy: "shrike", count: 4, arrive: "spread" }], award: { divi: 10 } },
      ],
      award: { divi: 25 },
    },
    {
      id: "descent",
      name: "Descent",
      /* Inside Spikeworld, which is the other place that exists. */
      place: "spike",
      crew: "multiplayer",
      published: true,
      rounds: [
        { seconds: 120, spawns: [wave(14, [1.0, 2.0])] },
        { seconds: 120, spawns: [wave(16, [1.2, 2.4]), { enemy: "shrike", count: 6, arrive: "spread" }] },
        /* The drones arrive: a different problem, and the first round that is
           about crowding rather than aim. */
        { seconds: 120, spawns: [wave(14, [1.2, 2.4]), { enemy: "drone3", count: 18, arrive: "clumps" }], award: { divi: 15 } },
        { seconds: 120, spawns: [wave(18, [1.5, 3.0]), { enemy: "shrike", count: 8, arrive: "spread" }] },
        /* The first Warden, alone, with nothing else to divide attention. */
        { seconds: 150, spawns: [{ enemy: "warden", count: 1, arrive: "once" }, wave(10, [1.0, 2.0])], award: { divi: 30 } },
        { seconds: 150, spawns: [wave(20, [2.0, 3.5]), { enemy: "drone5", count: 24, arrive: "clumps" }] },
        { seconds: 150, spawns: [{ enemy: "warden", count: 1, arrive: "once" }, { enemy: "shrike", count: 10, arrive: "spread" }], award: { divi: 40 } },
        /* Two Wardens and a hard wave. Whether this is beatable at all is
           exactly the kind of thing a sample is for. */
        { seconds: 180, spawns: [{ enemy: "warden", count: 2, arrive: "once" }, wave(22, [2.5, 4.0])], award: { divi: 60 } },
      ],
      award: { divi: 150 },
    },
  ];
}
