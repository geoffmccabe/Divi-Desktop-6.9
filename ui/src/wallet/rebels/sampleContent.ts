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

/* ================= FIVE ENEMIES =================
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

    /* ---- THE THREE BEHAVIOURS, NOT JUST ONE ----
       Shrike and Warden are both fighters: two speeds of the same problem.
       These three exist so every behaviour the engine has is represented by
       something Geoff can look at and change, and so a game can escalate by
       changing WHAT is coming rather than only how much of it. */
    {
      id: "lamprey",
      name: "Lamprey",
      behaviour: "drone",
      /* Sickly green, and there are always too many of them. */
      colour: 0x86d16a,
      fireColour: 0xc8ff9a,
      /* Individually pathetic. The threat is the count and the crowding: a
         swarm that is trivial to kill and expensive to ignore, because it
         fills the space you wanted to fly through. */
      shieldMax: 26,
      resistance: 0,
      speed: 1.35,
      fireEvery: 2.4,
      fireRange: 34,
      shotSpeed: 0.9,
      damage: 0.35,
      worth: 0.4,
    },
    {
      id: "kestrel",
      name: "Kestrel",
      behaviour: "fighter",
      /* Pale violet: the one you see late. */
      colour: 0xa98cff,
      fireColour: 0xe0d0ff,
      /* The opposite problem to the Shrike. It will not come to you, it hits
         hard from a long way off, and it dies quickly once reached. It is
         there to punish sitting still, which nothing else in the set does. */
      shieldMax: 140,
      resistance: 0.1,
      speed: 0.85,
      fireEvery: 3.2,
      fireRange: 165,
      shotSpeed: 2.2,
      damage: 2.4,
      worth: 2.5,
    },
    {
      id: "hollow-sovereign",
      name: "Hollow Sovereign",
      behaviour: "dragon",
      /* Dull gold going to rust. It should look like something old. */
      colour: 0xc9a227,
      fireColour: 0xffca45,
      /* An ending. More health than two Wardens, heavily resistant, and slow
         enough that the fight is about position rather than reflex. Worth
         the cap, because killing it is the whole of a long game. */
      shieldMax: 4200,
      resistance: 0.62,
      speed: 0.5,
      fireEvery: 1.6,
      fireRange: 120,
      shotSpeed: 1.2,
      damage: 3.2,
      worth: 10,
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
      /* ---- EARTH'S FRONT DOOR, SAID OUT LOUD ----
         What a player gets for pressing LAUNCH without opening the picker.
         It used to be decided by whichever published Earth game sorted first
         by id, which is how adding "scavengers-run" silently moved every new
         pilot off the tutorial and onto the second rung. Marked rather than
         inferred, so the next game added cannot move it by accident. */
      main: true,
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
      /* Spikeworld's front door. Marked for the same reason as Shakedown's,
         and BEFORE it is needed: today the alphabet happens to agree, since
         "descent" precedes both "the-" games, so nothing changes. That is
         exactly when to write it down. The Earth one was learned the other
         way round. */
      main: true,
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

    /* ---- THE LADDER ----
       Six games now, and the order is the point. Each one introduces exactly
       one new idea and then the next assumes you met it:

         Shakedown      earth  5   learn to fly and shoot        (the Shrike)
         Scavenger's Run earth 6   crowding                      (the Lamprey)
         The Long Dark  spike  7   range, and not sitting still  (the Kestrel)
         Descent        spike  8   a hard single target          (the Warden)
         Warden's Gate  earth  8   several hard targets at once
         The Hollow Crown spike 10 all of it, then the Sovereign

       Difficulty climbs by changing WHAT arrives, not only how much, which is
       the thing a pure count cannot do: twenty more tier ones is the same
       fight for longer, while one Kestrel is a different fight. */
    {
      id: "scavengers-run",
      name: "Scavenger's Run",
      place: "earth",
      crew: "multiplayer",
      published: true,
      rounds: [
        { seconds: 90, spawns: [wave(10, [0.8, 1.4])] },
        /* The swarm, alone the first time, so it is understood as crowding
           rather than as a harder wave. */
        { seconds: 90, spawns: [{ enemy: "lamprey", count: 20, arrive: "clumps" }] },
        { seconds: 105, spawns: [wave(10, [0.8, 1.6]), { enemy: "lamprey", count: 24, arrive: "clumps" }], award: { divi: 8 } },
        { seconds: 105, spawns: [wave(12, [1.0, 2.0]), { enemy: "shrike", count: 5, arrive: "spread" }] },
        /* Swarm and sparks together: the first round where the crowd hides
           something that actually hurts. */
        { seconds: 120, spawns: [{ enemy: "lamprey", count: 30, arrive: "clumps" }, { enemy: "shrike", count: 7, arrive: "spread" }], award: { divi: 12 } },
        { seconds: 120, spawns: [wave(14, [1.2, 2.2]), { enemy: "lamprey", count: 26, arrive: "clumps" }], award: { divi: 18 } },
      ],
      award: { divi: 45 },
    },
    {
      id: "the-long-dark",
      name: "The Long Dark",
      place: "spike",
      crew: "multiplayer",
      published: true,
      rounds: [
        { seconds: 105, spawns: [wave(12, [1.0, 1.8])] },
        /* One Kestrel, at range, with nothing else to do. Either you go to it
           or it keeps hitting you, and that lesson is the whole game. */
        { seconds: 105, spawns: [{ enemy: "kestrel", count: 1, arrive: "once" }, wave(8, [0.8, 1.4])] },
        { seconds: 120, spawns: [{ enemy: "kestrel", count: 2, arrive: "once" }, wave(10, [1.0, 1.8])], award: { divi: 10 } },
        { seconds: 120, spawns: [{ enemy: "kestrel", count: 2, arrive: "spread" }, { enemy: "lamprey", count: 22, arrive: "clumps" }] },
        /* Snipers behind a swarm: the crowd is now cover for the thing
           shooting you, which is the first genuinely awkward round in the
           ladder. */
        { seconds: 135, spawns: [{ enemy: "kestrel", count: 3, arrive: "spread" }, { enemy: "lamprey", count: 26, arrive: "clumps" }], award: { divi: 20 } },
        { seconds: 135, spawns: [wave(16, [1.5, 2.6]), { enemy: "kestrel", count: 3, arrive: "spread" }] },
        { seconds: 150, spawns: [{ enemy: "kestrel", count: 4, arrive: "spread" }, { enemy: "shrike", count: 8, arrive: "spread" }], award: { divi: 35 } },
      ],
      award: { divi: 90 },
    },
    {
      id: "wardens-gate",
      name: "Warden's Gate",
      place: "earth",
      crew: "multiplayer",
      published: true,
      rounds: [
        { seconds: 120, spawns: [wave(16, [1.5, 2.5])] },
        { seconds: 120, spawns: [{ enemy: "warden", count: 1, arrive: "once" }, wave(10, [1.0, 2.0])] },
        { seconds: 135, spawns: [{ enemy: "warden", count: 1, arrive: "once" }, { enemy: "kestrel", count: 2, arrive: "spread" }], award: { divi: 20 } },
        { seconds: 135, spawns: [wave(18, [2.0, 3.0]), { enemy: "lamprey", count: 24, arrive: "clumps" }] },
        /* Two, and they do not arrive together: the second lands while the
           first is still alive, which is a different fight from meeting two. */
        { seconds: 150, spawns: [{ enemy: "warden", count: 2, arrive: "spread" }, wave(12, [1.5, 2.5])], award: { divi: 35 } },
        { seconds: 150, spawns: [{ enemy: "warden", count: 2, arrive: "spread" }, { enemy: "kestrel", count: 3, arrive: "spread" }] },
        { seconds: 165, spawns: [{ enemy: "warden", count: 3, arrive: "spread" }, { enemy: "shrike", count: 10, arrive: "spread" }], award: { divi: 55 } },
        { seconds: 180, spawns: [{ enemy: "warden", count: 3, arrive: "once" }, wave(20, [2.5, 4.0])], award: { divi: 80 } },
      ],
      award: { divi: 200 },
    },
    {
      id: "the-hollow-crown",
      name: "The Hollow Crown",
      place: "spike",
      crew: "multiplayer",
      published: true,
      rounds: [
        { seconds: 120, spawns: [wave(18, [2.0, 3.0])] },
        { seconds: 120, spawns: [{ enemy: "lamprey", count: 30, arrive: "clumps" }, { enemy: "shrike", count: 8, arrive: "spread" }] },
        { seconds: 135, spawns: [{ enemy: "kestrel", count: 3, arrive: "spread" }, wave(14, [1.5, 2.5])], award: { divi: 20 } },
        { seconds: 135, spawns: [{ enemy: "warden", count: 1, arrive: "once" }, { enemy: "lamprey", count: 26, arrive: "clumps" }] },
        { seconds: 150, spawns: [{ enemy: "warden", count: 2, arrive: "spread" }, { enemy: "kestrel", count: 3, arrive: "spread" }], award: { divi: 40 } },
        { seconds: 150, spawns: [wave(22, [2.5, 4.0]), { enemy: "shrike", count: 10, arrive: "spread" }] },
        { seconds: 165, spawns: [{ enemy: "warden", count: 2, arrive: "once" }, { enemy: "kestrel", count: 4, arrive: "spread" }], award: { divi: 60 } },
        /* A quiet round before the end, deliberately. Everything else in the
           ladder escalates monotonically, and an ending reads as an ending
           only if something lets up just before it. */
        { seconds: 90, spawns: [wave(8, [1.0, 1.8])] },
        /* The Sovereign, alone. Nothing else, because anything else would be
           a distraction from the only thing happening. */
        { seconds: 240, spawns: [{ enemy: "hollow-sovereign", count: 1, arrive: "once" }], award: { divi: 120 } },
        /* And what is left of its escort, so the game ends on a fight you
           can win rather than on a health bar hitting zero. */
        { seconds: 120, spawns: [{ enemy: "kestrel", count: 4, arrive: "spread" }, { enemy: "shrike", count: 12, arrive: "spread" }], award: { divi: 80 } },
      ],
      award: { divi: 400 },
    },
  ];
}
