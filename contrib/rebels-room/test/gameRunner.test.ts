// The game controller: does a described game actually happen?
//
// Run: sh scripts/run-rebels-gamerunner-tests.sh
//
// Every test here uses a fake Spawner, so what is being checked is the RULES -
// when a round ends, how things are spaced, what happens at the end - and not
// the simulation. The runner never learns what an enemy is, which is why this
// can be exhaustive without a room, a clock or three.js anywhere near it.
//
// THE ONE THAT MATTERS MOST is that Wave Defence, walked by this runner, sends
// the same number of enemies at the same moments as startWave does today. The
// built-in game is a description now rather than a special case, and a
// description that produces a different game is worse than the special case it
// replaced.

export {};
import { startGame, stepGame, gameLength, CLUMPS, type Spawner, type Run } from "../src/gameRunner";
import {
  waveDefence, waveDefenceSize,
  WAVE_DEFENCE_ROUNDS, WAVE_DEFENCE_SECONDS,
  type GameType,
} from "../../../ui/src/wallet/rebels/gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A spawner that writes down what it was asked for and when. */
function recorder() {
  const calls: Array<{ at: number; enemy: string; n: number }> = [];
  let now = 0;
  return {
    calls,
    at: (t: number) => { now = t; },
    total: (enemy?: string) =>
      calls.filter((c) => !enemy || c.enemy === enemy).reduce((a, c) => a + c.n, 0),
    spawner: { spawn: (enemy: string, n: number) => { calls.push({ at: now, enemy, n }); } } as Spawner,
  };
}

/** Run a game to its end at a fixed tick, feeding the recorder the clock. */
function play(game: GameType, dt = 0.05, limitSeconds = 60 * 90) {
  const r = recorder();
  const run = startGame(game);
  const events: string[] = [];
  let t = 0;
  while (!run.done && t < limitSeconds) {
    r.at(t);
    const e = stepGame(run, dt, r.spawner);
    if (e.roundStarted) events.push(`start:${e.roundStarted}@${t.toFixed(1)}`);
    if (e.roundFinished) events.push(`end:${e.roundFinished}@${t.toFixed(1)}`);
    if (e.gameFinished) events.push(`over@${t.toFixed(1)}`);
    t += dt;
  }
  return { run, rec: r, events, t };
}

/* ================= WAVE DEFENCE, AS THE RUNNER WALKS IT ================= */
{
  const game = waveDefence();
  const { run, rec, events, t } = play(game);

  ok("the built-in game finishes", run.done, `after ${t.toFixed(0)}s`);
  ok("it runs for exactly its described length",
     Math.abs(gameLength(game) - WAVE_DEFENCE_ROUNDS * WAVE_DEFENCE_SECONDS) < 1e-9,
     `${gameLength(game)}s`);

  /* ---- THE COUNT, ROUND BY ROUND ----
     Not just the total: a runner that sent all 1,170 in the first round would
     pass a total check and be a completely different game. */
  let wrong = 0;
  for (let n = 1; n <= WAVE_DEFENCE_ROUNDS; n++) {
    const from = (n - 1) * WAVE_DEFENCE_SECONDS;
    const to = n * WAVE_DEFENCE_SECONDS;
    const sent = rec.calls.filter((c) => c.at >= from && c.at < to).reduce((a, c) => a + c.n, 0);
    if (sent !== waveDefenceSize(n)) wrong++;
  }
  ok("every round sends exactly the number the description gives it",
     wrong === 0, `${wrong} of ${WAVE_DEFENCE_ROUNDS} rounds wrong`);

  const total = rec.total();
  const expected = Array.from({ length: WAVE_DEFENCE_ROUNDS }, (_, i) => waveDefenceSize(i + 1))
    .reduce((a, b) => a + b, 0);
  ok("and the whole game sends what the whole game describes",
     total === expected, `${total} of ${expected}`);

  /* ---- THE SPACING ----
     "spread" is the first at once and then one every window/count, which is
     what startWave does. Checked on round one, where the arithmetic is
     cleanest: ten enemies over 120 seconds is one every twelve. */
  const firstRound = rec.calls.filter((c) => c.at < WAVE_DEFENCE_SECONDS);
  ok("the first arrives at once", firstRound[0]?.at === 0, `${firstRound[0]?.at}`);
  const gaps = firstRound.slice(1).map((c, i) => c.at - firstRound[i].at);
  const want = WAVE_DEFENCE_SECONDS / waveDefenceSize(1);
  ok("and the rest are evenly spaced across the round",
     gaps.every((g) => Math.abs(g - want) < 0.1),
     `gaps ~${gaps[0]?.toFixed(1)}s, expected ${want}s`);

  /* Rounds are announced so the cockpit can show one. The wave number going
     blank after a death was a real bug; a round has to be something the room
     SAYS, not something a client infers. */
  ok("each round after the first is announced",
     events.filter((e) => e.startsWith("start:")).length === WAVE_DEFENCE_ROUNDS - 1,
     `${events.filter((e) => e.startsWith("start:")).length} announcements`);
  ok("and the end of the game is announced once",
     events.filter((e) => e.startsWith("over")).length === 1);
}

/* ================= ROUNDS END ON THE CLOCK, ALWAYS ================= */
{
  /* Geoff: "The clock, always." Nothing the players do shortens a round, and
     nothing lengthens it either. */
  const game: GameType = {
    id: "t", name: "T", place: "earth", crew: "solo", published: true,
    rounds: [
      { seconds: 10, spawns: [{ enemy: "tier1", count: 2, arrive: "once" }] },
      { seconds: 5, spawns: [{ enemy: "tier2", count: 1, arrive: "once" }] },
    ],
  };
  const { rec, t, run } = play(game, 0.05, 120);
  ok("a two-round game lasts the sum of its rounds",
     Math.abs(t - 15) < 0.2 && run.done, `${t.toFixed(2)}s`);
  ok("an empty sky does not end a round early", rec.total("tier1") === 2);
  ok("and the second round's enemies arrive in the second round",
     rec.calls.find((c) => c.enemy === "tier2")!.at >= 10,
     `${rec.calls.find((c) => c.enemy === "tier2")!.at.toFixed(1)}s`);
}

/* ================= THE THREE ARRIVALS ================= */
{
  const one = (arrive: "once" | "spread" | "clumps") => ({
    id: "a", name: "A", place: "earth" as const, crew: "solo" as const, published: true,
    rounds: [{ seconds: 60, spawns: [{ enemy: "tier1", count: 12, arrive }] }],
  });

  const atOnce = play(one("once"), 0.05, 120);
  ok("'once' sends everything at the start",
     atOnce.rec.calls.length === 1 && atOnce.rec.total() === 12,
     `${atOnce.rec.calls.length} arrivals`);

  const spread = play(one("spread"), 0.05, 120);
  ok("'spread' sends them one at a time",
     spread.rec.calls.length === 12 && spread.rec.calls.every((c) => c.n === 1),
     `${spread.rec.calls.length} arrivals`);

  const clumps = play(one("clumps"), 0.05, 120);
  ok("'clumps' sends them in bursts",
     clumps.rec.calls.length > 1 && clumps.rec.calls.length <= CLUMPS
       && clumps.rec.calls.some((c) => c.n > 1),
     `${clumps.rec.calls.length} bursts of ${clumps.rec.calls.map((c) => c.n).join(",")}`);
  ok("and all three send exactly the count asked for",
     atOnce.rec.total() === 12 && spread.rec.total() === 12 && clumps.rec.total() === 12,
     `${atOnce.rec.total()}/${spread.rec.total()}/${clumps.rec.total()}`);
}

/* ================= A LONG TICK MUST NOT LOSE ANYTHING ================= */
{
  /* A stalled frame, a slow tick, a room catching up: the runner must not
     quietly send fewer enemies because the clock jumped. The interval
     accumulates rather than resetting, exactly as startWave's does. */
  const game: GameType = {
    id: "l", name: "L", place: "earth", crew: "solo", published: true,
    rounds: [{ seconds: 60, spawns: [{ enemy: "tier1", count: 30, arrive: "spread" }] }],
  };
  for (const dt of [0.05, 0.5, 2, 7]) {
    const { rec, run } = play(game, dt, 200);
    ok(`a ${dt}s tick still sends all thirty`, rec.total() === 30 && run.done,
       `${rec.total()} sent`);
  }
}

/* ================= AWKWARD GAMES ================= */
{
  const bare: GameType = {
    id: "e", name: "E", place: "earth", crew: "solo", published: true, rounds: [],
  };
  const r = startGame(bare);
  ok("a game with no rounds is over rather than running for ever", r.done);
  const rec = recorder();
  const ev = stepGame(r, 1, rec.spawner);
  ok("and stepping a finished game does nothing and says nothing",
     rec.calls.length === 0 && Object.keys(ev).length === 0);

  const zero: GameType = {
    id: "z", name: "Z", place: "earth", crew: "solo", published: true,
    rounds: [{ seconds: 30, spawns: [{ enemy: "tier1", count: 0, arrive: "spread" }] }],
  };
  const quiet = play(zero, 0.5, 90);
  ok("a round that spawns nothing still takes its time",
     quiet.rec.total() === 0 && Math.abs(quiet.t - 30) < 1, `${quiet.t.toFixed(1)}s`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
