// What a game pays, and the ceiling on it.
//
// Phase 6's server half. A Round may carry an award for surviving it and a
// GameType one for finishing it (gameTypes.ts, the gameplay session's). This
// decides who gets them and how much is allowed to be got.
//
// WHO GETS PAID: whoever is flying when the round ends.
//
// Not who was there when it started, not who killed the most, not everyone who
// has ever been in the room. Flying at the moment the clock runs out. A player
// who joins at round twenty-nine collects round twenty-nine and nothing before
// it, a player who dies in round three collects nothing for round three, and
// somebody sitting on the launch card collects nothing at all. That is the
// simplest rule that cannot be gamed by arriving late and it is the one a
// player would guess.
//
// WHY THERE IS A CEILING HERE AS WELL AS IN THE VALIDATOR
// ------------------------------------------------------
// gameTypes.ts already refuses a single award over MAX_REWARD_DIVI, which stops
// somebody typing a silly number into one box. It does NOT stop the total: sixty
// rounds each paying the maximum is thirty thousand DIVI from one game, every
// game, and each of those numbers is individually legal.
//
// So this counts what a game has actually paid and stops when the game's whole
// purse is empty. Three layers now, and they bound different things:
//
//   the validator   one award cannot be absurd          (gameTypes.ts)
//   this            one GAME cannot pay out a fortune   (GAME_PURSE)
//   EARN_PER_DAY    one PLAYER cannot earn one a day    (ledger.ts)
//   the daily cap   the treasury cannot be drained      (payout service)
//
// Only the last one bounds money actually leaving. The three above it bound the
// DEBT, which at a DIVI a sphere now grows faster than the float does.

import type { GameType, Reward, Round } from "../../../ui/src/wallet/rebels/gameTypes";

/**
 * The most one run of one game may pay out in awards, across every round and
 * every player in it.
 *
 * Not a per-player number: a full room of twenty-four collecting a 500 DIVI
 * round award is twelve thousand DIVI from a single round, and the room size is
 * not something the person writing the game is thinking about. The purse is the
 * whole run's, shared, and it empties.
 *
 * Two thousand because that is the payout service's entire daily cap: a game
 * that could promise more than the treasury can pay in a day is a game that
 * promises what nobody will ever receive, which is worse than one that promises
 * less. Awards are ON TOP of what the enemies themselves dropped, which is
 * already the bulk of what a player earns.
 */
export const GAME_PURSE = 2000;

/** What one run of one game has paid so far. */
export interface Purse {
  /** DIVI paid out in awards, across every round and every player. */
  spent: number;
  /** How many awards have been refused because the purse was empty, so the
   *  room can say so once rather than silently paying nothing. */
  refused: number;
}

export function newPurse(): Purse {
  return { spent: 0, refused: 0 };
}

/** What one player is to be given. */
export interface Payment {
  divi: number;
  items: string[];
}

/**
 * Work out what an award pays each of `players`, and take it out of the purse.
 *
 * Returns the payment ONE player gets; the caller applies it to each of them.
 * The purse is charged for all of them together, because the ceiling is on what
 * the game pays and not on what any one player receives.
 *
 * An award that does not fit is refused ENTIRELY rather than paid in part: half
 * an award is a number nobody chose, and a player who was told a round pays
 * fifty would rather be paid nothing and see why than be paid eleven.
 */
export function award(
  purse: Purse,
  reward: Reward | undefined,
  players: number,
): Payment | null {
  if (!reward || players <= 0) return null;
  const divi = Math.max(0, reward.divi ?? 0);
  const items = reward.items ?? [];
  if (divi <= 0 && items.length === 0) return null;

  const cost = divi * players;
  if (purse.spent + cost > GAME_PURSE) {
    purse.refused += 1;
    return null;
  }
  purse.spent += cost;
  return { divi, items: [...items] };
}

/**
 * The most a game COULD pay if every round were survived by a full room.
 *
 * For the admin panel to show before anything is saved, so a game that would
 * hit the ceiling is visible as a number rather than as players quietly not
 * being paid halfway through. Worth showing even when it is under, because the
 * distance from the ceiling is the useful part.
 */
export function mostAGameCouldPay(game: GameType, players: number): number {
  const rounds = game.rounds.reduce((a: number, r: Round) => a + Math.max(0, r.award?.divi ?? 0), 0);
  const finish = Math.max(0, game.award?.divi ?? 0);
  return (rounds + finish) * Math.max(1, players);
}

/** Whether a game can pay everything it promises to a room of this size. */
export function withinPurse(game: GameType, players: number): boolean {
  return mostAGameCouldPay(game, players) <= GAME_PURSE;
}
