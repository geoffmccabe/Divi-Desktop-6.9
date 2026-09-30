// Reading the games Geoff has built, and what happens when that goes wrong.
//
// Run: sh scripts/run-rebels-gamesource-tests.sh
//
// Almost every test here is a failure case, and on purpose. The happy path -
// the table holds good games and the room plays them - is one line. Everything
// else is the question that actually matters: WHEN THIS GOES WRONG, DOES THE
// GAME STILL RUN?
//
// It has to. A room that will not start because a table is missing, or because
// somebody saved a game with a typo in it, is a worse outcome than a room
// playing the game it has always played. So every path out of here ends with
// playable games, and the only thing that varies is whether they are his or the
// built-in - and `error` always says which and why.

export {};
import { fetchGames, gameForPlace, hasGameFor, mainIsGuessed } from "../src/gameSource";
import { waveDefence, DEFAULT_GAMES, validateGames, type GameType } from "../../../ui/src/wallet/rebels/gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A fetch that answers with whatever is handed to it. */
const answering = (body: unknown, status = 200): typeof fetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;

const good = (over: Partial<GameType> = {}): GameType => ({
  id: "night-run", name: "Night Run", place: "earth", crew: "multiplayer",
  published: true,
  rounds: [{ seconds: 60, spawns: [{ enemy: "fighters", count: 4, arrive: "spread" }] }],
  ...over,
});

/* ================= WHEN IT WORKS ================= */
{
  const r = await fetchGames(answering([{ game: good() }]));
  ok("a saved game is read and played", r.live && r.games[0]?.id === "night-run",
     `${r.games.length} games, live ${r.live}`);
  ok("and nothing is reported wrong", r.error === undefined, r.error ?? "");
}

/* ================= WHEN IT DOES NOT ================= */
{
  /* Every one of these must end with playable games. */
  const cases: Array<[string, typeof fetch]> = [
    ["the table does not exist yet", answering({ message: "relation missing" }, 404)],
    ["the database is having a bad day", answering({}, 500)],
    ["the table is there but empty", answering([])],
    ["a row holds something that is not a game", answering([{ game: { id: "x" } }])],
    ["a row holds nothing at all", answering([{ game: null }])],
    ["something that is not the table answers", answering({ oops: true })],
    ["the network is simply gone", (async () => { throw new Error("offline"); }) as unknown as typeof fetch],
  ];
  for (const [what, fn] of cases) {
    const r = await fetchGames(fn);
    ok(`${what}: the built-in still runs`,
       r.games.length > 0 && !r.live && r.games[0].id === DEFAULT_GAMES[0].id,
       `${r.games.length} games, error "${r.error ?? "none"}"`);
  }

  /* And the reason is always carried, because "it is playing the built-in" is
     only useful with "because the table 404s" beside it. */
  const r = await fetchGames(answering({}, 500));
  ok("the reason is always said, never just swallowed",
     typeof r.error === "string" && r.error.length > 0, r.error);

  /* ---- AND THE REASONS ARE TOLD APART ----
     "Nothing saved yet" is Tuesday. "Something that is not the table answered"
     means a problem. Reporting both the same way sends whoever is debugging to
     look at an empty table that is perfectly fine. */
  const empty = await fetchGames(answering([]));
  const wrong = await fetchGames(answering({ oops: true }));
  ok("an empty table and a wrong answer do not read the same",
     empty.error !== wrong.error, `"${empty.error}" vs "${wrong.error}"`);
}

/* ================= ONE BAD GAME CONDEMNS THE SET ================= */
{
  /* Deliberate, and worth being sure about: a partially loaded list means some
     games silently missing and nobody knowing which. "The list is wrong" is
     easier to act on than "the list is short". */
  const r = await fetchGames(answering([{ game: good() }, { game: { id: "broken" } }]));
  ok("one unreadable game means the built-in, not a quietly short list",
     !r.live && r.games[0].id === DEFAULT_GAMES[0].id,
     `${r.games.length} games, error "${(r.error ?? "").slice(0, 60)}"`);
}

/* ================= WHICH GAME A PLACE RUNS ================= */
{
  const earthGame = good({ id: "earth-one", place: "earth" });
  const spikeGame = good({ id: "spike-one", place: "spike" });
  const games = [earthGame, spikeGame];

  ok("a place runs the game written for it",
     gameForPlace(games, "spike").id === "spike-one");
  ok("and not one written for somewhere else",
     gameForPlace(games, "earth").id === "earth-one");

  /* ---- UNPUBLISHED IS INVISIBLE ----
     A half-finished game must not become the thing everybody is flying
     against because somebody saved it and went to lunch. */
  const draft = [good({ id: "draft", place: "earth", published: false })];
  ok("an unpublished game is not run", gameForPlace(draft, "earth").id !== "draft",
     gameForPlace(draft, "earth").id);
  ok("and does not count as a game for that place", !hasGameFor(draft, "earth"));

  /* Earth always has something to play, because it has the built-in. */
  ok("Earth with nothing saved still plays the built-in",
     gameForPlace([], "earth").id === waveDefence().id);

  /* Elsewhere, no game means no game: Spikeworld's fight is a heart and its
     guards, not a sequence of rounds. */
  ok("a place nobody has written for has no game of its own",
     !hasGameFor([], "spike") && !hasGameFor(games, "p7"));
  ok("but one that has been written for does", hasGameFor(games, "spike"));
}


/* ================= WHICH GAME A PLACE RUNS BY DEFAULT =================
   ⚠ THIS SHIPPED AND BROKE THE TUTORIAL. gameForPlace ended `return here[0]`
   over a list fetched `order=id`, so the default Earth fight was whichever
   published game's id sorted first. Adding "scavengers-run" silently replaced
   "shakedown" as the fight every new player lands in, because "sc" precedes
   "sh". Measured on the live room before the fix: /room/earth ran
   scavengers-run, six rounds, which assumes you have already met a Shrike.

   Nobody wrote that policy; it fell out of a sort, and it would have returned
   the first time somebody named a game "adventure-one". */
{
  const g = (id: string, over: Partial<GameType> = {}): GameType =>
    good({ id, name: id, place: "earth", ...over });

  /* The exact shape of the live failure, in the order the query returns. */
  const asFetched = [g("scavengers-run"), g("shakedown"), g("wardens-gate")];

  ok("(the bug) without a marked main, the alphabet decides",
     gameForPlace(asFetched, "earth").id === "scavengers-run",
     gameForPlace(asFetched, "earth").id);

  /* ---- AND THE FIX ---- */
  const marked = [g("scavengers-run"), g("shakedown", { main: true }), g("wardens-gate")];
  ok("a place runs the game that says it is the main fight",
     gameForPlace(marked, "earth").id === "shakedown",
     gameForPlace(marked, "earth").id);

  ok("even when its name sorts last",
     gameForPlace([g("aaa"), g("zzz", { main: true })], "earth").id === "zzz");

  /* An unpublished game cannot be the main fight, however it is marked: it is
     invisible to players, and a place whose default nobody can reach is a
     place with no default. */
  ok("an unpublished game cannot be the main fight",
     gameForPlace([g("aaa"), g("zzz", { main: true, published: false })], "earth").id === "aaa");

  /* The marker is per PLACE: Earth's main must not be chosen for Spikeworld. */
  ok("one place's main fight is not another's",
     gameForPlace([g("e", { main: true }), g("s", { place: "spike" })], "spike").id === "s");

  /* ---- AND WHEN IT IS STILL THE ALPHABET, THE ROOM SAYS SO ----
     A silent arbitrary pick looks exactly like a deliberate one, which is the
     whole reason this went unnoticed. */
  ok("the room knows when it had to guess", mainIsGuessed(asFetched, "earth"));
  ok("and knows when it did not", !mainIsGuessed(marked, "earth"));
  ok("one game alone is not a guess", !mainIsGuessed([g("only")], "earth"));
  ok("and no games at all is not a guess either", !mainIsGuessed([], "earth"));

  /* ---- TWO MAINS IS SOMEBODY'S MISTAKE, AND IT IS NAMED ---- */
  const twice = validateGames([g("alpha-one", { main: true }), g("beta-two", { main: true })]);
  ok("two main fights in one place is refused",
     "errors" in twice && twice.errors.some((e) => e.includes("more than one main")),
     "errors" in twice ? twice.errors.join("; ") : "accepted");
  ok("and one main is perfectly fine",
     "ok" in validateGames([g("alpha-one", { main: true }), g("beta-two")]));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
