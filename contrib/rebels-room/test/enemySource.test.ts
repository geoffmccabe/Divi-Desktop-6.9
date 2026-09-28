// Reading the enemies Geoff has designed, and the order that has to be right.
//
// Run: sh scripts/run-rebels-enemysource-tests.sh
//
// The failure-case half is the same shape as gameSource's, for the same reason:
// every path out of here has to end with a room that can still fly, and the
// only thing that varies is whether the enemies are his or the built-ins.
//
// THE PART THAT IS NOT A COPY, and the reason this file exists rather than a
// second call in the room, is the ORDERING RULE. validateGame only accepts an
// enemy name it has heard of. So a game naming a custom enemy is invalid unless
// the enemies were read FIRST and their ids handed over - and because one bad
// game condemns the whole set on purpose, getting that order wrong would drop
// every game in the room the moment Geoff used his first custom enemy. It would
// not crash, it would not log, it would just quietly go back to Wave Defence.

export {};
import { fetchEnemies, fetchWorld } from "../src/enemySource";
import {
  blankEnemy, builtInEnemies, builtInIds, RESERVED_ENEMY_IDS, type EnemyType,
} from "../../../ui/src/wallet/rebels/enemyTypes";
import {
  BUILT_IN_ENEMIES, DEFAULT_GAMES, GAME_MAX_PAYOUT, gamePayout, payoutRefusal, type GameType,
} from "../../../ui/src/wallet/rebels/gameTypes";
import { COIN_PER_KILL, COIN_VALUE } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { EARN_PER_DAY } from "../src/ledger";
import { sampleGames, sampleEnemies } from "../../../ui/src/wallet/rebels/sampleContent";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A fetch that answers the two tables separately, so the ordering rule can be
 *  tested at all: the whole point is that one read informs the other. */
const tables = (
  enemies: unknown, games: unknown, status = 200,
): typeof fetch => (async (url: string) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (String(url).includes("rebels_enemies") ? enemies : games),
})) as unknown as typeof fetch;

const answering = (body: unknown, status = 200): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

const brute = (over: Partial<EnemyType> = {}): EnemyType =>
  ({ ...blankEnemy("brute"), name: "Brute", ...over });

/** A game that flies against whatever it is told to. */
const gameWith = (enemy: string): GameType => ({
  id: "night-run", name: "Night Run", place: "earth", crew: "multiplayer", published: true,
  rounds: [{ seconds: 60, spawns: [{ enemy, count: 4, arrive: "spread" }] }],
});

/* ================= WHEN IT WORKS ================= */
{
  const r = await fetchEnemies(answering([{ enemy: brute() }]));
  ok("a saved enemy is read", r.live && r.enemies.some((e) => e.id === "brute"), `live ${r.live}`);
  ok("and nothing is reported wrong", r.error === undefined, r.error ?? "");

  /* ---- THE BUILT-INS ARE ADDED TO, NEVER REPLACED ----
     A game naming tier3 has to keep working whatever is in the table, and a
     custom set that hid the built-ins would break every game ever written the
     moment the first custom enemy was saved. */
  ok("every built-in is still there beside it",
     builtInIds().every((id) => r.enemies.some((e) => e.id === id)),
     `${r.enemies.length} enemies in all`);
}

/* ================= WHEN IT DOES NOT ================= */
{
  const cases: Array<[string, typeof fetch]> = [
    ["the table does not exist yet", answering({ message: "relation missing" }, 404)],
    ["the database is having a bad day", answering({}, 500)],
    ["the table is there but empty", answering([])],
    ["a row holds something that is not an enemy", answering([{ enemy: { id: "x" } }])],
    ["a row holds nothing at all", answering([{ enemy: null }])],
    ["something that is not the table answers", answering({ oops: true })],
    ["an enemy takes a built-in's name", answering([{ enemy: brute({ id: "tier3" }) }])],
    ["the network is simply gone", (async () => { throw new Error("offline"); }) as unknown as typeof fetch],
  ];
  for (const [what, fn] of cases) {
    const r = await fetchEnemies(fn);
    ok(`${what}: the built-ins still fly`,
       r.enemies.length === builtInIds().length && !r.live && typeof r.error === "string",
       `${r.enemies.length} enemies, error "${r.error ?? "none"}"`);
  }

  const empty = await fetchEnemies(answering([]));
  const wrong = await fetchEnemies(answering({ oops: true }));
  ok("an empty table and a wrong answer do not read the same",
     empty.error !== wrong.error, `"${empty.error}" vs "${wrong.error}"`);
}

/* ================= THE ORDERING RULE ================= */
{
  /* A game that names a custom enemy. This is the case that breaks if the
     games are read before the enemies, and it breaks SILENTLY. */
  const w = await fetchWorld(tables([{ enemy: brute() }], [{ game: gameWith("brute") }]));
  ok("a game naming a custom enemy is accepted",
     w.games.live && w.games.games[0]?.id === "night-run",
     `live ${w.games.live}, error "${w.games.error ?? "none"}"`);
  ok("and the enemy it names came through with it",
     w.enemies.live && w.enemies.enemies.some((e) => e.id === "brute"));

  /* ---- THE PROOF THAT THE ORDER IS WHAT DID IT ----
     The same game, with the enemies table empty. Now "brute" is a name nobody
     has heard of, the game is invalid, and the room falls back. If this passed
     as well, the test above would be proving nothing. */
  const alone = await fetchWorld(tables([], [{ game: gameWith("brute") }]));
  ok("the same game is REFUSED when its enemy was not read first",
     !alone.games.live && alone.games.games[0].id === DEFAULT_GAMES[0].id,
     `error "${(alone.games.error ?? "").slice(0, 70)}"`);
  ok("and the reason names the enemy, so it is findable",
     (alone.games.error ?? "").includes("brute"), alone.games.error ?? "");

  /* A game naming a BUILT-IN needs no help from the enemies table at all, so
     a broken enemies table must not take the ordinary games down with it. */
  const builtIn = await fetchWorld(tables({}, [{ game: gameWith("tier3") }], 200));
  ok("a game naming a built-in survives an enemies table that is nonsense",
     builtIn.games.live && !builtIn.enemies.live,
     `games live ${builtIn.games.live}, enemies live ${builtIn.enemies.live}`);
}

/* ================= WHAT THE ROOM ENDS UP WITH ================= */
{
  /* Both halves always present and never empty, whatever happened. */
  const w = await fetchWorld(answering({}, 500));
  ok("a total failure still leaves a room that can fly",
     w.enemies.enemies.length > 0 && w.games.games.length > 0,
     `${w.enemies.enemies.length} enemies, ${w.games.games.length} games`);
  ok("and both halves say why", !!w.enemies.error && !!w.games.error);
}

/* ================= THE TWO NAME LISTS MUST AGREE =================
   There are three lists of enemy names in this codebase and they are not the
   same list:

     BUILT_IN_ENEMIES  (gameTypes.ts)   what a GAME may name
     builtInIds()      (enemyTypes.ts)  what the PANEL offers
     the spawner's ifs (room.ts)        what the ROOM can actually build

   Nothing made them agree, and both ways of disagreeing are silent. A name the
   panel offers but a game may not use gets the game REFUSED, which condemns
   every other game in the room. A name the spawner handles itself but nothing
   reserves can be taken by a custom enemy, which then never spawns as itself.

   Both had actually drifted when this test was written. */
{
  const game = new Set<string>(BUILT_IN_ENEMIES as readonly string[]);
  const panel = builtInIds();

  const unnameable = panel.filter((id) => !game.has(id));
  ok("every enemy the panel offers can be named in a game",
     unnameable.length === 0,
     unnameable.length ? `${unnameable.join(" ")} cannot be put in a round` : "");

  /* The reserved names are the other direction: handled by the spawner itself,
     so a saved enemy must not be able to take one. */
  for (const id of RESERVED_ENEMY_IDS) {
    const r = await fetchEnemies(answering([{ enemy: brute({ id }) }]));
    ok(`a custom enemy cannot be called "${id}"`,
       !r.live && (r.error ?? "").includes(id), r.error ?? "it was accepted");
    ok(`and "${id}" is still a name a game may use`, game.has(id));
  }
}


/* ================= AND WHAT A GAME PAYS =================
   The last unbounded number in the game. Every other ceiling was in place and
   each bounded a fraction: one award, a run's awards, a player's day, what
   leaves the treasury. The DROPS had nothing, and they are three quarters of
   what a game pays. Each number in the worst case is individually legal and
   individually validated already. */
{
  const rich = (count: number, enemy = "brute"): GameType => ({
    id: "goldmine", name: "Goldmine", place: "earth", crew: "multiplayer",
    published: true,
    rounds: [{ seconds: 60, spawns: [{ enemy, count, arrive: "spread" }] }],
  });

  /* (context) the size of the hole this closes. */
  const worst = 60 * 400 * COIN_PER_KILL * 10 * COIN_VALUE;
  ok("(context) the largest describable game pays a fortune in DROPS alone",
     worst > 1_000_000, `${worst.toLocaleString()} DIVI from one clear`);
  ok("and the ceiling is a small fraction of it",
     GAME_MAX_PAYOUT < worst / 100, `${GAME_MAX_PAYOUT} against ${worst.toLocaleString()}`);

  /* ---- THE TWO NUMBERS THAT MUST AGREE ----
     The ceiling is EARN_PER_DAY because past that the ledger silently refuses
     the remainder. Asserted rather than left to the comment. */
  ok("the game ceiling is exactly what a player may be credited in a day",
     GAME_MAX_PAYOUT === EARN_PER_DAY, `${GAME_MAX_PAYOUT} against ${EARN_PER_DAY}`);

  /* ---- A GREEDY GAME IS REFUSED, AND SO ARE THE REST ---- */
  const greedy = await fetchWorld(tables(
    [{ enemy: brute({ worth: 10 }) }],
    [{ game: rich(400) }],
  ));
  ok("a game paying more than a player can earn in a day is refused",
     !greedy.games.live && greedy.games.games[0].id === DEFAULT_GAMES[0].id,
     `error "${(greedy.games.error ?? "").slice(0, 90)}"`);
  ok("and the reason says the DROPS, the number nobody expects",
     (greedy.games.error ?? "").includes("drops"), greedy.games.error ?? "");
  ok("and names the game, so it is findable",
     (greedy.games.error ?? "").includes("Goldmine"));

  /* ---- AN ORDINARY GAME IS NOT ---- */
  const fine = await fetchWorld(tables(
    [{ enemy: brute({ worth: 1 }) }],
    [{ game: rich(20) }],
  ));
  ok("an ordinary game passes untouched",
     fine.games.live && fine.games.games[0].id === "goldmine",
     `error "${fine.games.error ?? "none"}"`);

  /* ---- THE REAL SAMPLES MUST PASS ----
     A ceiling that refuses the content we shipped is a ceiling set wrong. */
  const worthOf = new Map<string, number>([
    ...builtInEnemies().map((e) => [e.id, e.worth] as [string, number]),
    ...sampleEnemies().map((e) => [e.id, e.worth] as [string, number]),
    ["fighters", 1],
  ]);
  for (const g of sampleGames()) {
    const p = gamePayout(g, worthOf, COIN_PER_KILL, COIN_VALUE);
    ok(`the sample game "${g.name}" is inside the ceiling`,
       payoutRefusal(g, worthOf, COIN_PER_KILL, COIN_VALUE) === null,
       `${p.total.toLocaleString()} of ${GAME_MAX_PAYOUT.toLocaleString()}`);
  }

  /* ---- AND THE BUILT-IN, WHICH NOBODY CHOSE AND EVERYBODY PLAYS ---- */
  ok("the built-in game is inside it too",
     payoutRefusal(DEFAULT_GAMES[0], worthOf, COIN_PER_KILL, COIN_VALUE) === null,
     `${gamePayout(DEFAULT_GAMES[0], worthOf, COIN_PER_KILL, COIN_VALUE).total.toLocaleString()}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
