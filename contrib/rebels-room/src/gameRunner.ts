// The game controller: walks a game's rounds on the clock and says what should
// arrive.
//
// Phase 4 of docs/DIVI-REBELS-GAME-BUILDER-PLAN.md, and the piece that makes an
// admin-defined game actually happen. A GameType (gameTypes.ts, owned by the
// gameplay session) describes a place and a sequence of rounds; this turns that
// description into "spawn three of these, now".
//
// IT DOES NOT KNOW HOW TO MAKE AN ENEMY, and that is the whole design. It asks
// a Spawner for "two tier3" and the room decides what that means. So every rule
// in here - when a round ends, how things are spaced, what happens when the last
// one finishes - is testable with a fake spawner and no simulation, no three.js,
// no room and no clock but the one it is handed.
//
// ROUNDS END ON THE CLOCK, ALWAYS. Geoff's answer when asked what ends one:
// "The clock, always." A round cleared early leaves the sky empty until its
// time is up; a round not cleared rolls its survivors into the next, which is
// what the waves already did. There is deliberately no "cleared" shortcut: it
// would make a round's length depend on how good the players are, and the
// length is the thing an admin sets.

import type { GameType, Round, Spawn } from "../../../ui/src/wallet/rebels/gameTypes";

/**
 * What the runner needs the world to be able to do.
 *
 * One method, taking the enemy name straight from the game description, because
 * the runner has no opinion about what "tier3" or "dragon" means. The room's
 * implementation does; a test's does not have to.
 */
export interface Spawner {
  /** Put `n` of this enemy into the world. Called with n >= 1. */
  spawn(enemy: string, n: number): void;
}

/** How many bursts a "clumps" arrival is broken into, at most. Four is enough
 *  to read as waves-within-a-round without being indistinguishable from
 *  "spread" at small counts. */
export const CLUMPS = 4;

/** One spawn's progress through its round. */
interface Pending {
  enemy: string;
  /** How many are still to come. */
  left: number;
  /** Seconds until the next arrival. Counts down. */
  nextIn: number;
  /** Seconds between arrivals after the first. */
  every: number;
  /** How many arrive at a time. */
  each: number;
}

export interface Run {
  game: GameType;
  /** Which round is running, from zero. Equals rounds.length when finished. */
  round: number;
  /** Seconds left in the current round. */
  left: number;
  /** What is still to arrive in the current round. */
  pending: Pending[];
  /** True once the last round's clock has run out. */
  done: boolean;
}

/** What happened in a step, for the room to put on the wire. */
export interface RunEvents {
  /** A round just started; its number, from one. */
  roundStarted?: number;
  /** A round just finished; its number, from one. Its award is the caller's
   *  business, because paying is not this module's job. */
  roundFinished?: number;
  /** The last round finished and the game is over. */
  gameFinished?: boolean;
}

/**
 * Lay out one round's arrivals.
 *
 * "spread" reproduces exactly what startWave does today: the first at once, and
 * then one every window divided by the count. That arithmetic is copied rather
 * than approximated, including the detail that the interval is added to rather
 * than recomputed, so a long tick cannot let a round drift late.
 */
function planRound(round: Round): Pending[] {
  const out: Pending[] = [];
  for (const s of round.spawns) {
    const count = Math.max(0, Math.floor(s.count));
    if (count <= 0) continue;
    if (s.arrive === "once") {
      out.push({ enemy: s.enemy, left: count, nextIn: 0, every: 0, each: count });
      continue;
    }
    if (s.arrive === "clumps") {
      /* Broken into at most CLUMPS bursts, the last one carrying any
         remainder so the count is always exactly right. */
      const bursts = Math.max(1, Math.min(CLUMPS, count));
      const each = Math.ceil(count / bursts);
      out.push({
        enemy: s.enemy, left: count, nextIn: 0,
        every: round.seconds / bursts, each,
      });
      continue;
    }
    /* "spread": one at a time, evenly, the window divided by the count. */
    out.push({
      enemy: s.enemy, left: count, nextIn: 0,
      every: round.seconds / Math.max(1, count), each: 1,
    });
  }
  return out;
}

/** Begin a game at its first round. */
export function startGame(game: GameType): Run {
  const first = game.rounds[0];
  return {
    game,
    round: 0,
    left: first ? first.seconds : 0,
    pending: first ? planRound(first) : [],
    /* A game with no rounds is over before it starts, rather than running
       forever on an empty clock. */
    done: !first,
  };
}

/**
 * Advance a game by `dt` seconds, spawning whatever is due.
 *
 * Returns what changed, so the room can announce it. Safe to call on a finished
 * run: it does nothing and says nothing.
 */
export function stepGame(run: Run, dt: number, spawner: Spawner): RunEvents {
  const events: RunEvents = {};
  if (run.done || !(dt > 0)) return events;

  /* ---- what arrives ----
     Before the clock, so a spawn due at the last instant of a round still
     happens. A round that ends owing arrivals has simply run out of time, and
     the ones it never sent are gone rather than carried. */
  for (const p of run.pending) {
    if (p.left <= 0) continue;
    p.nextIn -= dt;
    /* A loop rather than a single test: one long tick can cover several
       intervals, and swallowing them would quietly shorten the round. */
    let guard = 0;
    while (p.left > 0 && p.nextIn <= 0 && guard++ < 1000) {
      const n = Math.min(p.each, p.left);
      spawner.spawn(p.enemy, n);
      p.left -= n;
      if (p.every <= 0) break;          /* "once": everything, and no more */
      p.nextIn += p.every;
    }
  }

  /* ---- the clock ---- */
  run.left -= dt;
  if (run.left > 0) return events;

  /* The round is over. On the clock, always. */
  events.roundFinished = run.round + 1;
  run.round += 1;
  const next = run.game.rounds[run.round];
  if (!next) {
    run.done = true;
    run.left = 0;
    run.pending = [];
    events.gameFinished = true;
    return events;
  }
  /* Carry the overshoot into the next round rather than dropping it, for the
     same reason the spawn interval accumulates: a long tick must not make the
     game as a whole run late. */
  run.left += next.seconds;
  run.pending = planRound(next);
  events.roundStarted = run.round + 1;
  return events;
}

/** How long the whole game lasts, in seconds. */
export function gameLength(game: GameType): number {
  return game.rounds.reduce((a, r) => a + r.seconds, 0);
}
