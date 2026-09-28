// What a game pays, and what stops it paying too much.
//
// Run: sh scripts/run-rebels-rewards-tests.sh
//
// Every test here is about a number that becomes real DIVI, so they are written
// the way the payout tests are: the happy path is a line of it and the rest is
// what happens when somebody describes a game that would empty the treasury.
//
// The arithmetic that makes this necessary: a single award is capped at 500 by
// the validator, a game may have 60 rounds, and a room holds 24 players. Every
// one of those numbers is individually reasonable. Multiplied together they are
// 720,000 DIVI from one run of one game, against a float of about 1,880.

export {};
import {
  award, newPurse, mostAGameCouldPay, withinPurse, GAME_PURSE,
} from "../src/gameRewards";
import { MAX_REWARD_DIVI, MAX_ROUNDS, type GameType } from "../../../ui/src/wallet/rebels/gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const game = (rounds: number, per: number, finish = 0): GameType => ({
  id: "g", name: "G", place: "earth", crew: "multiplayer", published: true,
  ...(finish ? { award: { divi: finish } } : {}),
  rounds: Array.from({ length: rounds }, () => ({
    seconds: 60, spawns: [{ enemy: "fighters", count: 1, arrive: "once" as const }],
    ...(per ? { award: { divi: per } } : {}),
  })),
});

/* ================= PAYING ================= */
{
  const p = newPurse();
  const one = award(p, { divi: 10 }, 3);
  ok("an award pays every player who was there", one?.divi === 10, `${one?.divi}`);
  ok("and the purse is charged for all of them, not one",
     p.spent === 30, `${p.spent} for three players at ten`);

  ok("items come through with it",
     award(newPurse(), { divi: 0, items: ["recharge"] }, 1)?.items[0] === "recharge");
  ok("an award of nothing is not an award", award(newPurse(), { divi: 0 }, 2) === null);
  ok("and neither is no award at all", award(newPurse(), undefined, 2) === null);

  /* Nobody flying when the round ends: nothing is paid and nothing is spent,
     or an empty room would drain a game's purse by itself. */
  const empty = newPurse();
  ok("an empty sky is paid nothing", award(empty, { divi: 50 }, 0) === null);
  ok("and costs the purse nothing", empty.spent === 0);
}

/* ================= THE CEILING ================= */
{
  /* THE ARITHMETIC THIS EXISTS FOR. Each number is legal on its own. */
  const worst = MAX_REWARD_DIVI * MAX_ROUNDS * 24;
  ok("(context) the largest describable game would pay a fortune",
     worst > 500_000, `${worst.toLocaleString()} DIVI from one run`);
  ok("and the purse is a tiny fraction of it",
     GAME_PURSE < worst / 100, `${GAME_PURSE} against ${worst.toLocaleString()}`);

  /* It empties, and then it stays empty. */
  const p = newPurse();
  let paid = 0, refused = 0;
  for (let i = 0; i < 100; i++) {
    const a = award(p, { divi: MAX_REWARD_DIVI }, 4);
    if (a) paid += a.divi * 4; else refused++;
  }
  ok("a game stops paying once its purse is empty", p.spent <= GAME_PURSE,
     `${p.spent} of ${GAME_PURSE}`);
  ok("and everything after that is refused", refused > 0, `${refused} of 100 refused`);
  ok("the refusals are counted, so the room can say so once",
     p.refused === refused, `${p.refused}`);
  ok("nothing was paid beyond the purse", paid === p.spent, `${paid} against ${p.spent}`);

  /* ---- REFUSED WHOLE, NEVER IN PART ----
     Half an award is a number nobody chose. A player told a round pays fifty
     would rather be paid nothing and see why than be paid eleven. */
  const nearly = newPurse();
  nearly.spent = GAME_PURSE - 10;
  const part = award(nearly, { divi: 50 }, 1);
  ok("an award that does not fit is refused entirely, not part paid", part === null);
  ok("and the purse is untouched by the refusal", nearly.spent === GAME_PURSE - 10);
}

/* ================= WHAT THE PANEL SHOULD SHOW ================= */
{
  /* So a game that would hit the ceiling is a number before it is saved,
     rather than players quietly not being paid halfway through. */
  ok("a modest game is well inside the purse",
     withinPurse(game(10, 5), 4) && mostAGameCouldPay(game(10, 5), 4) === 200,
     `${mostAGameCouldPay(game(10, 5), 4)} DIVI`);

  ok("a game's finishing award counts toward it too",
     mostAGameCouldPay(game(10, 5, 100), 4) === 600,
     `${mostAGameCouldPay(game(10, 5, 100), 4)}`);

  const greedy = game(MAX_ROUNDS, MAX_REWARD_DIVI);
  ok("the largest describable game does NOT fit", !withinPurse(greedy, 24),
     `${mostAGameCouldPay(greedy, 24).toLocaleString()} DIVI wanted`);

  /* Room size matters, which is the part somebody writing a game is least
     likely to be thinking about. */
  const same = game(20, 20);
  ok("the same game costs more in a fuller room",
     mostAGameCouldPay(same, 24) > mostAGameCouldPay(same, 2),
     `${mostAGameCouldPay(same, 2)} for two, ${mostAGameCouldPay(same, 24)} for twenty-four`);
  ok("and one that fits for two may not fit for twenty-four",
     withinPurse(game(20, 20), 2) && !withinPurse(game(20, 20), 24),
     `${mostAGameCouldPay(game(20, 20), 2)} vs ${mostAGameCouldPay(game(20, 20), 24)}`);

  /* A game with no awards at all is the normal case: the enemies' own drops
     are the bulk of what anybody earns. */
  ok("a game that promises nothing extra costs nothing",
     mostAGameCouldPay(game(30, 0), 24) === 0 && withinPurse(game(30, 0), 24));
}

/* ================= AWKWARD NUMBERS ================= */
{
  const p = newPurse();
  ok("a negative award pays nothing", award(p, { divi: -100 }, 2) === null);
  ok("and does not credit the purse", p.spent === 0, `${p.spent}`);
  /* An items-only award is free of the purse, deliberately: items are bounded
     by the drop charts and are not DIVI. */
  const itemsOnly = newPurse();
  ok("an items-only award is paid", award(itemsOnly, { items: ["hull2"] }, 3)?.items.length === 1);
  ok("and spends none of the purse", itemsOnly.spent === 0);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
