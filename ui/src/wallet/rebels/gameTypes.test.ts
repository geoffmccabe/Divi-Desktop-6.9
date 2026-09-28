// The shape of a game: does today's game survive being described in it, and
// does the validator refuse what it should?
//
// Run: sh scripts/run-rebels-gametypes-tests.sh
//
// Phase one of docs/DIVI-REBELS-GAME-BUILDER-PLAN.md. The claim this file has
// to stand on is the one the plan calls out as the thing that will bite: the
// built-in game must keep behaving EXACTLY as it does today through every phase
// that follows, or every wire test and every player's expectations move at
// once. So the first block compares the description against the simulation's
// own constants rather than against numbers typed in here.
export {};

import {
  waveDefence, waveDefenceSize, validateGame, validateGames, gameSeconds, gameMaxAward,
  DEFAULT_GAMES, PLACES, PLACES_LIVE, MAX_REWARD_DIVI, ROUND_MAX_ENEMIES,
  ROUND_MAX_SECONDS, MAX_ROUNDS, BIAS_MAX, WAVE_DEFENCE_BIAS,
  WAVE_DEFENCE_FIRST, WAVE_DEFENCE_STEP, WAVE_DEFENCE_SECONDS, WAVE_DEFENCE_ROUNDS,
  type GameType,
} from "./gameTypes";
import { WAVE_FIRST, WAVE_STEP, WAVE_SECONDS, waveSize, WAVE_BIAS_MIN, WAVE_BIAS_MAX, rollTier } from "./rebelsCombat";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= TODAY'S GAME, UNCHANGED =================
   gameTypes.ts imports nothing, on purpose, so its copies of these numbers
   cannot be checked by the compiler. They are checked here instead. If
   somebody retunes the waves and does not retune the description, this is what
   says so. */
{
  ok("the built-in's first wave matches the simulation",
     WAVE_DEFENCE_FIRST === WAVE_FIRST, `${WAVE_DEFENCE_FIRST} against ${WAVE_FIRST}`);
  ok("and its step", WAVE_DEFENCE_STEP === WAVE_STEP, `${WAVE_DEFENCE_STEP} against ${WAVE_STEP}`);
  ok("and its round length",
     WAVE_DEFENCE_SECONDS === WAVE_SECONDS, `${WAVE_DEFENCE_SECONDS}s against ${WAVE_SECONDS}s`);

  /* And every round of it, against the function the fight actually uses. */
  const g = waveDefence();
  let same = true;
  let firstBad = "";
  for (let n = 1; n <= WAVE_DEFENCE_ROUNDS; n++) {
    const described = g.rounds[n - 1];
    const real = waveSize(n);
    const count = described.spawns[0]?.count;
    if (count !== real || described.seconds !== WAVE_SECONDS) {
      if (same) firstBad = `round ${n}: described ${count} in ${described.seconds}s, real ${real} in ${WAVE_SECONDS}s`;
      same = false;
    }
  }
  ok("every round of the built-in matches the wave the fight would send", same, firstBad);
  ok("and it escalates, which is the whole point",
     g.rounds[0].spawns[0].count < g.rounds[29].spawns[0].count,
     `${g.rounds[0].spawns[0].count} -> ${g.rounds[29].spawns[0].count}`);
  ok("the thirtieth wave is sixty-eight fighters", waveDefenceSize(30) === 68, `${waveDefenceSize(30)}`);

  /* The arrival rule has to be the one startWave uses: evenly across the
     round, not all at once. */
  ok("they arrive spread across the round, as the waves do",
     g.rounds.every((r) => r.spawns.every((s) => s.arrive === "spread")));

  /* ---- AND WHAT ARRIVES, WHICH THIS TEST USED TO BE SILENT ABOUT ----
     The first draft described the built-in as pure tier1. The real waves are
     a MIX: every wave rolls a bias and the seven tiers are weighted by it, so
     roughly three in ten of an average wave are not tier one. Pinning count
     and timing while saying nothing about WHAT is how a description can be
     precisely right and still describe a different, flatter game. */
  ok("the built-in sends a MIX of fighters, not a wall of tier ones",
     g.rounds.every((r) => r.spawns.every((s) => s.enemy === "fighters")));
  ok("across the same difficulty range the waves roll",
     WAVE_DEFENCE_BIAS[0] === WAVE_BIAS_MIN && WAVE_DEFENCE_BIAS[1] === WAVE_BIAS_MAX,
     `${WAVE_DEFENCE_BIAS.join("-")} against the simulation's ${WAVE_BIAS_MIN}-${WAVE_BIAS_MAX}`);
  ok("and every round carries it", g.rounds.every((r) => r.spawns[0].bias?.[0] === WAVE_BIAS_MIN));

  /* And that the mix is really a mix, measured through the roll the fight
     uses rather than argued about. */
  {
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(rollTier(WAVE_BIAS_MAX).tier);
    ok("a biased roll really does send more than one tier", seen.size >= 3,
       `${seen.size} different tiers in 4000 rolls at bias ${WAVE_BIAS_MAX}`);
  }
  ok("it is played in Earth orbit", g.place === "earth");
  ok("and it is the shared game, not a solo one", g.crew === "multiplayer");
  ok("thirty rounds is an hour",
     gameSeconds(g) === 3600, `${gameSeconds(g)} seconds`);
  ok("the default set is exactly it", DEFAULT_GAMES.length === 1 && DEFAULT_GAMES[0].id === "wave-defence");
  ok("and the default set passes its own validator", "ok" in validateGames(DEFAULT_GAMES));
}

/* ================= WHAT THE VALIDATOR REFUSES ================= */
{
  const good = (): GameType => JSON.parse(JSON.stringify(waveDefence())) as GameType;
  const bad = (f: (g: GameType) => void, why: string) => {
    const g = good();
    f(g);
    const v = validateGame(g);
    ok(why, "errors" in v, "errors" in v ? v.errors[0] : "ACCEPTED, and should not have been");
  };

  ok("a good game passes", "ok" in validateGame(good()));
  bad((g) => { (g as { id: unknown }).id = "Not A Slug"; }, "an id with spaces and capitals is refused");
  bad((g) => { g.name = ""; }, "an empty name is refused");
  bad((g) => { (g as { place: unknown }).place = "mars"; }, "a place that does not exist is refused");
  bad((g) => { (g as { crew: unknown }).crew = "duo"; }, "a crew size that is not one of the two is refused");
  bad((g) => { g.rounds = []; }, "a game with no rounds is refused");
  bad((g) => { g.rounds[0].seconds = 0; }, "a round of no seconds is refused");
  bad((g) => { g.rounds[0].seconds = ROUND_MAX_SECONDS + 1; }, "an absurdly long round is refused");
  bad((g) => { g.rounds[0].spawns = []; }, "an empty round is refused");
  bad((g) => { g.rounds[0].spawns[0].enemy = "nothing-like-this"; }, "an enemy nobody has defined is refused");
  bad((g) => { g.rounds[0].spawns[0].count = 0; }, "a spawn of nothing is refused");
  bad((g) => { g.rounds[0].spawns[0].count = 2.5; }, "half an enemy is refused");
  bad((g) => { (g.rounds[0].spawns[0] as { arrive: unknown }).arrive = "eventually"; }, "an arrival nobody implements is refused");
  bad((g) => { g.rounds[0].spawns[0].count = ROUND_MAX_ENEMIES + 1; }, "a round holding more enemies than allowed is refused");
  bad((g) => { g.rounds[0].spawns[0].bias = [3, 1]; }, "a bias range written backwards is refused");
  bad((g) => { g.rounds[0].spawns[0].bias = [0, BIAS_MAX + 1]; }, "a bias past the top of the range is refused");
  bad((g) => { g.rounds[0].spawns[0].enemy = "tier3"; }, "a bias on ONE kind of ship is refused, because it means nothing there");
  {
    const one = good();
    one.rounds[0].spawns[0].enemy = "tier3";
    delete one.rounds[0].spawns[0].bias;
    ok("and asking for one named tier, with no bias, is fine", "ok" in validateGame(one));
  }
  bad((g) => { g.rounds = new Array(MAX_ROUNDS + 1).fill(g.rounds[0]); }, "a game with too many rounds is refused");
  bad((g) => { (g as { image: unknown }).image = "https://example.com/a.png"; }, "a card image by link rather than by upload is refused");
  bad((g) => { (g as { published: unknown }).published = "yes"; }, "published must be a real true or false");

  /* ---- THE MONEY GUARD ----
     An enemy worth a lot times a round holding a thousand of them is a money
     printer. The ceiling is enforced in the validator rather than in the panel
     because the panel is the one thing that cannot be trusted to have run. */
  bad((g) => { g.award = { divi: MAX_REWARD_DIVI + 1 }; }, "a game award over the ceiling is refused");
  bad((g) => { g.rounds[0].award = { divi: MAX_REWARD_DIVI + 1 }; }, "a round award over the ceiling is refused");
  bad((g) => { g.award = { divi: -5 }; }, "a negative award is refused");
  const paid = good();
  paid.award = { divi: 100, items: ["hull1"] };
  paid.rounds[0].award = { divi: 20 };
  ok("an award inside the ceiling is allowed", "ok" in validateGame(paid));
  ok("and the panel can be shown what it could cost",
     gameMaxAward(paid) === 120, `${gameMaxAward(paid)} DIVI at most`);

  /* ---- A PLACE THAT HAS NO ROOM YET ----
     Writable, so a game can be built for a planet before the planet is
     reachable; not publishable, because publishing it would offer players a
     door into nowhere. */
  const future = good();
  future.place = "p7";
  future.published = true;
  ok("a game cannot be published into a place that does not exist yet", "errors" in validateGame(future));
  future.published = false;
  ok("but it can be written and saved for later", "ok" in validateGame(future));
  ok("the live places are the two that have rooms",
     PLACES_LIVE.length === 2 && PLACES_LIVE.includes("earth") && PLACES_LIVE.includes("spike"),
     PLACES_LIVE.join(", "));
  ok("and every live place is a real place", PLACES_LIVE.every((p) => PLACES.includes(p)));

  /* ---- A CUSTOM ENEMY IS KNOWN ONCE IT EXISTS ----
     Phase three lets Geoff define his own. The validator must accept a name it
     has never heard of IF the enemy table has it, and refuse it otherwise. */
  const custom = good();
  custom.rounds[0].spawns[0].enemy = "geoffs-reaper";
  /* One named kind of ship, so no mix bias: it would mean nothing here. */
  delete custom.rounds[0].spawns[0].bias;
  ok("an unknown custom enemy is refused", "errors" in validateGame(custom));
  ok("and the same one is accepted once it has been defined",
     "ok" in validateGame(custom, ["geoffs-reaper"]));
}

/* ================= A SET OF THEM ================= */
{
  const a = waveDefence();
  const b = { ...waveDefence(), id: "heart-assault", name: "Heart Assault", place: "spike" as const };
  ok("two different games are fine", "ok" in validateGames([a, b]));
  const clash = validateGames([a, { ...b, id: a.id }]);
  ok("two games sharing an id are refused",
     "errors" in clash && clash.errors.some((e) => e.includes("share the id")),
     "errors" in clash ? clash.errors.join("; ") : "accepted");
  ok("something that is not a list is refused", "errors" in validateGames({ id: "x" }));
  ok("and the error names WHICH game is wrong",
     (() => { const v = validateGames([a, { ...b, name: "" }]); return "errors" in v && v.errors[0].startsWith("game 2:"); })());
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
