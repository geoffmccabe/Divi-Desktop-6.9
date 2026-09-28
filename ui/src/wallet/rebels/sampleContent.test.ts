// The sample enemies and games: are they valid, and are they a PROGRESSION?
//
// Run: sh scripts/run-rebels-samples-tests.sh
//
// Geoff asked for samples that "make a nice progression". Checking they merely
// parse would miss the entire point - a sample set that validates and is
// flat, or unbeatable, or names an enemy that does not exist, is worse than
// none, because it looks like a worked example and teaches the wrong thing.
// So most of this checks the DESIGN, not the syntax.
export {};

import { sampleEnemies, sampleGames } from "./sampleContent";
import { validateEnemies, builtInIds, builtInEnemies } from "./enemyTypes";
import { COIN_PER_KILL, COIN_VALUE } from "./rebelsCombat";
import {
  validateGames, validateGame, gameSeconds, gameMaxAward, gamePayout, payoutRefusal,
  GAME_MAX_PAYOUT, waveDefence,
  PLACES_LIVE, MAX_REWARD_DIVI, type GameType,
} from "./gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const enemies = sampleEnemies();
const games = sampleGames();
const known = [...builtInIds(), "fighters", ...enemies.map((e) => e.id)];
const enemyCount = (g: GameType) =>
  g.rounds.reduce((n, r) => n + r.spawns.reduce((m, s) => m + s.count, 0), 0);

/* ================= THEY ARE VALID ================= */
{
  const v = validateEnemies(enemies);
  ok("the sample enemies pass their own validator", "ok" in v,
     "errors" in v ? v.errors.join("; ") : "");
  const g = validateGames(games, known);
  ok("the sample games pass theirs", "ok" in g, "errors" in g ? g.errors.join("; ") : "");

  /* The trap a sample set walks into: naming an enemy that does not exist.
     It would validate in a test that passed its own names in and fail the
     moment it reached a panel that did not. */
  const withoutSamples = validateGames(games, [...builtInIds(), "fighters"]);
  ok("and they REFUSE to validate without the sample enemies, which proves they use them",
     "errors" in withoutSamples);

  ok("nothing shadows a built-in enemy", enemies.every((e) => !builtInIds().includes(e.id)));
  ok("nothing shadows the built-in game", games.every((g) => g.id !== waveDefence().id));
  ok("every game is somewhere players can actually go",
     games.every((g) => PLACES_LIVE.includes(g.place)),
     games.map((g) => `${g.id}@${g.place}`).join(", "));
  ok("and they use BOTH places, not the same one twice",
     new Set(games.map((g) => g.place)).size === 2,
     games.map((g) => g.place).join(", "));
}

/* ================= THE ENEMIES ARE DIFFERENT PROBLEMS ================= */
{
  const shrike = enemies.find((e) => e.id === "shrike")!;
  const warden = enemies.find((e) => e.id === "warden")!;

  /* A sample enemy earns its place by being something the built-in tiers are
     not. Two more mid-range fighters would be decoration. */
  ok("the Shrike is faster and flimsier than anything built in",
     shrike.speed > 1.8 && shrike.shieldMax < 100,
     `${shrike.speed}x speed, ${shrike.shieldMax} health`);
  ok("the Warden is slower and far harder",
     warden.speed < 0.7 && warden.shieldMax > 1000 && warden.resistance >= 0.5,
     `${warden.speed}x speed, ${warden.shieldMax} health, ${warden.resistance * 100}% resistance`);
  ok("so the two of them are opposites rather than variations",
     shrike.speed > warden.speed * 3 && warden.shieldMax > shrike.shieldMax * 20);

  /* Effective health, which is the number that decides how long something
     takes to kill: resistance makes the bar longer than it looks. */
  const effective = (e: typeof warden) => e.shieldMax / (1 - e.resistance);
  ok("the Warden takes about fifty times the shooting the Shrike does",
     effective(warden) / effective(shrike) > 40,
     `${Math.round(effective(warden))} against ${Math.round(effective(shrike))}`);

  /* And is paid for accordingly, without breaking the ceiling. */
  ok("what they drop rises with how hard they are",
     warden.worth > shrike.worth && shrike.worth > 1);
  ok("and both stay inside the payout ceiling", enemies.every((e) => e.worth <= 10));
}

/* ================= THE GAMES ARE A PROGRESSION ================= */
{
  const shakedown = games.find((g) => g.id === "shakedown")!;
  const descent = games.find((g) => g.id === "descent")!;

  ok("Shakedown is the short one", gameSeconds(shakedown) < gameSeconds(descent),
     `${Math.round(gameSeconds(shakedown) / 60)} min against ${Math.round(gameSeconds(descent) / 60)} min`);
  ok("and short enough to finish in one sitting", gameSeconds(shakedown) <= 600,
     `${Math.round(gameSeconds(shakedown) / 60)} minutes`);
  ok("Descent sends far more", enemyCount(descent) > enemyCount(shakedown) * 3,
     `${enemyCount(shakedown)} against ${enemyCount(descent)}`);
  ok("and pays far more", gameMaxAward(descent) > gameMaxAward(shakedown) * 3,
     `${gameMaxAward(shakedown)} against ${gameMaxAward(descent)} DIVI`);

  /* WITHIN each game, it has to get harder. A "progression" that is flat
     inside each game is not one. */
  for (const g of [shakedown, descent]) {
    const first = g.rounds[0].spawns.reduce((n, s) => n + s.count, 0);
    const last = g.rounds[g.rounds.length - 1].spawns.reduce((n, s) => n + s.count, 0);
    ok(`${g.name} sends more at the end than at the start`, last > first, `${first} -> ${last}`);
    /* And the mix gets harder, not just bigger. */
    const biasOf = (r: GameType["rounds"][number]) =>
      Math.max(...r.spawns.map((s) => s.bias?.[1] ?? 0));
    ok(`${g.name} gets nastier as well as busier`,
       biasOf(g.rounds[g.rounds.length - 1]) >= biasOf(g.rounds[0]),
       `${biasOf(g.rounds[0])} -> ${biasOf(g.rounds[g.rounds.length - 1])}`);
  }

  /* The first round of the easy one must be gentle. A new pilot meeting a
     tier five in their first ninety seconds learns the wrong lesson. */
  ok("Shakedown's first round is pinned to the easy end of the mix",
     (shakedown.rounds[0].spawns[0].bias?.[1] ?? 9) <= 1,
     `up to ${shakedown.rounds[0].spawns[0].bias?.[1]}`);

  /* The hard enemies are introduced ALONE before they are used in numbers -
     the difference between a fight that teaches and one that ambushes. */
  const firstWarden = descent.rounds.findIndex((r) => r.spawns.some((s) => s.enemy === "warden"));
  ok("Descent introduces the Warden partway through, not at the start", firstWarden >= 3,
     `round ${firstWarden + 1} of ${descent.rounds.length}`);
  ok("and only one of them the first time",
     descent.rounds[firstWarden].spawns.find((s) => s.enemy === "warden")!.count === 1);
  const lastWardens = descent.rounds[descent.rounds.length - 1].spawns
    .find((s) => s.enemy === "warden")?.count ?? 0;
  ok("with more of them by the end", lastWardens > 1, `${lastWardens} at the finish`);

  /* Awards stay inside the ceiling per round and per game. */
  ok("no single award breaks the ceiling",
     games.every((g) => (g.award?.divi ?? 0) <= MAX_REWARD_DIVI
       && g.rounds.every((r) => (r.award?.divi ?? 0) <= MAX_REWARD_DIVI)));

  /* ---- WHAT A CLEAR ACTUALLY CREDITS, drops included ----
     The awards are the small half. Checking them alone is how a sample set
     ends up crediting 63% of the treasury's whole daily payout cap to one
     player while every individual award sits inside its ceiling. Found by the
     payouts session multiplying it out; these numbers are the record of it so
     nobody has to rediscover them. */
  const worth = new Map([...builtInEnemies(), ...enemies].map((e) => [e.id, e.worth]));
  worth.set("fighters", 1);
  const pay = (g: GameType) => gamePayout(g, worth, COIN_PER_KILL, COIN_VALUE);
  const shake = pay(shakedown), desc = pay(descent);

  ok("Shakedown credits what it credits", shake.total === 318,
     `${shake.drops} dropped + ${shake.awards} awarded = ${shake.total}`);
  ok("Descent credits what it credits", desc.total === 1259,
     `${desc.drops} dropped + ${desc.awards} awarded = ${desc.total}`);
  ok("and the DROPS are the big half, which is the part that surprised us",
     desc.drops > desc.awards * 3, `${desc.drops} against ${desc.awards}`);
  ok("so counting awards alone understates a game several times over",
     desc.total > gameMaxAward(descent) * 3,
     `${gameMaxAward(descent)} counted, ${desc.total} real`);

  /* ---- AND THE NUMBER THAT MATTERS TO THE TREASURY ----
     Not a pass/fail on the design - Geoff owns the rate - but a tripwire, so
     a future edit that makes a sample richer cannot pass unnoticed. If this
     fails, somebody has changed the economy and should say so out loud. */
  /* And the hard ceiling a game may not exceed at all, which the panel now
     refuses at save and the room refuses at load. The samples must sit well
     inside it, or the content we shipped would be the first thing the new
     bound rejected. */
  ok("neither sample is over the ceiling a game may pay",
     payoutRefusal(shakedown, worth, COIN_PER_KILL, COIN_VALUE) === null
       && payoutRefusal(descent, worth, COIN_PER_KILL, COIN_VALUE) === null,
     `${desc.total} of ${GAME_MAX_PAYOUT}`);
  /* ---- AND THE BUILT-IN IS THE RICHEST THING IN THE GAME ----
     Which nobody chose and everybody plays. Worth pinning rather than
     leaving as a surprise: it is 4.6 times Descent and more than half the
     ceiling, so if the ceiling is ever lowered this is what it hits first. */
  const builtIn = pay(waveDefence());
  ok("the built-in pays more than either sample, by a distance",
     builtIn.total > desc.total * 3, `${builtIn.total} against ${desc.total}`);
  ok("and is still inside the ceiling", payoutRefusal(waveDefence(), worth, COIN_PER_KILL, COIN_VALUE) === null,
     `${builtIn.total} of ${GAME_MAX_PAYOUT}`);

  const DAILY_PAYOUT_CAP = 2000;
  ok("no sample has quietly grown past the daily cap on a single clear",
     desc.total < DAILY_PAYOUT_CAP,
     `${desc.total} of ${DAILY_PAYOUT_CAP}, which is ${Math.round(desc.total / DAILY_PAYOUT_CAP * 100)}%`);
}

/* ================= AND THEY ARE EDITABLE, NOT BUILT IN ================= */
{
  ok("no sample enemy claims to be built in", enemies.every((e) => e.builtIn === undefined));
  ok("and every sample game is published, so they show up to be tested",
     games.every((g) => g.published), games.map((g) => `${g.id}:${g.published}`).join(" "));
  /* Editing one must not need anything special: it has to pass the same
     validator a hand-made game passes. */
  const edited: GameType = { ...games[0], name: "Renamed", rounds: games[0].rounds.slice(0, 2) };
  ok("a sample can be edited and still be valid", "ok" in validateGame(edited, known));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
