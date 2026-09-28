// The game picker: does it always leave a player able to fly?
//
// Run: sh scripts/run-rebels-gamepicker-tests.sh
//
// The picker is the one screen between a player and the game, so the property
// that matters is not "does it render" but "can this ever be a dead end". Most
// of this drives the DATA side - what fetchGameCards keeps, drops and defaults
// - because that is where a dead end would come from: a card with no name, a
// game that is not published being offered, or the whole list vanishing
// because one row was malformed.
export {};

import { PLACE_NAMES, PLACES } from "./gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* A stand-in for the table, so the reader can be driven without a network. */
function serve(rows: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status === 200,
    status,
    json: async () => rows,
  })) as unknown as typeof fetch;
}

async function main() {
  const { fetchGameCards } = await import("./gameTypesRemote");
  const { setPlatform, HEADLESS } = await import("./platform/current");
  setPlatform(HEADLESS);

  /* ================= WHAT REACHES THE PICKER ================= */
  {
    const cards = await fetchGameCards(serve([
      { id: "shakedown", game: { name: "Shakedown", place: "earth", crew: "multiplayer", published: true }, image: "data:image/webp;base64,AAAA" },
      { id: "descent", game: { name: "Descent", place: "spike", crew: "multiplayer", published: true }, image: null },
      { id: "wip", game: { name: "Half Built", place: "earth", crew: "solo", published: false }, image: null },
    ]));
    ok("published games reach the picker", cards.length === 2, `${cards.length} of 3 rows`);
    ok("and a DRAFT does not, which is the whole point of the draft flag",
       !cards.some((c) => c.id === "wip"), cards.map((c) => c.id).join(", "));
    ok("a card keeps its picture", cards.find((c) => c.id === "shakedown")?.image !== undefined);
    ok("and one without a picture is still offered rather than dropped",
       cards.find((c) => c.id === "descent") !== undefined);
    ok("solo and multiplayer survive the trip",
       cards.every((c) => c.crew === "solo" || c.crew === "multiplayer"));
    ok("every card has a place a player can read",
       cards.every((c) => typeof (PLACE_NAMES[c.place] ?? c.place) === "string"));
  }

  /* ================= IT CANNOT BECOME A DEAD END ================= */
  {
    ok("a server error gives an empty list rather than throwing",
       (await fetchGameCards(serve([], 500))).length === 0);
    ok("nonsense instead of rows gives an empty list rather than throwing",
       (await fetchGameCards(serve({ not: "an array" }))).length === 0);
    const thrower = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    ok("and being offline does too", (await fetchGameCards(thrower)).length === 0);

    /* A row missing everything must not take the others down with it: the
       picker showing one game is better than showing none. */
    const mixed = await fetchGameCards(serve([
      { id: "broken", game: null, image: null },
      { id: "fine", game: { name: "Fine", place: "earth", crew: "solo", published: true }, image: null },
    ]));
    ok("one malformed row does not hide the good ones",
       mixed.some((c) => c.id === "fine"), mixed.map((c) => c.id).join(", ") || "nothing came back");
    ok("and the malformed one is not offered, since it is not published",
       !mixed.some((c) => c.id === "broken"));

    /* A published row with no name still has to be clickable and labelled -
       falling back to its id is ugly and a blank card is broken. */
    const nameless = await fetchGameCards(serve([
      { id: "no-name", game: { place: "earth", published: true }, image: null },
    ]));
    ok("a game with no name falls back to its id rather than a blank card",
       nameless[0]?.name === "no-name", JSON.stringify(nameless[0]));
    ok("and one with no place is treated as Earth rather than nowhere",
       nameless[0]?.place === "earth");
  }

  /* ================= THE PLACE A CARD NAMES ================= */
  {
    ok("every place the builder allows has a readable name",
       PLACES.every((p) => (PLACE_NAMES[p] ?? "").length > 0));
    ok("and an unknown place falls back to its id rather than to nothing",
       (PLACE_NAMES["p99"] ?? "p99") === "p99");
  }

  console.log(out.join("\n"));
  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
