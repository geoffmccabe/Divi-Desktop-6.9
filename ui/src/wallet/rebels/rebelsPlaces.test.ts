// The places: is every one of them somewhere a ship can actually be?
//
// Run: sh scripts/run-rebels-places-tests.sh
//
// Two kinds of test here. The first kind checks the table against the things it
// has to agree with - the list of places a game may name, and the sky the
// player is looking at - because a place that disagrees with either is a game
// pointed at nowhere.
//
// The second kind is one invariant, and it is the one that matters: A SHIP MUST
// ARRIVE INSIDE THE WORLD IT IS ARRIVING IN. That sounds too obvious to test.
// It is exactly what went wrong the first time Spikeworld was made a region:
// the room judged every position by Earth's floor, so an arriving pilot was
// "outside the world", got snapped back to their pad, and the room then read
// that as a ship sitting inside the heart. Nothing threw. The check below is
// four lines and would have caught it before anyone flew.

export {};
import {
  PLACES, PLACE_IDS, NAMED_PLACE_IDS, LIVE_PLACE_IDS, placeById, withinPlace,
  PLANET_BUBBLE, PLANET_ARRIVAL, PLANET_FLOOR,
} from "./rebelsPlaces";
import { PLACES_LIVE } from "./gameTypes";
import { R, MIN_ALT, MAX_ALT, PLANET_COUNT, planetCentre, planetDiameter } from "./orbitWorld";
import { SPIKEWORLD_CENTRE } from "./rebelsRegions";
import { furnitureLayout } from "./spaceEnvironment";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= THE TABLE AGREES WITH THE CONTRACT ================= */
{
  /* gameTypes.ts owns WHICH places exist; this table owns where they are. A
     game may name any of them, so every one needs geometry or the room has
     nowhere to put the players. */
  const missing = NAMED_PLACE_IDS.filter((id) => !placeById(id));
  ok("every place a game may name has geometry", missing.length === 0,
     missing.length ? `no geometry for ${missing.join(", ")}` : `all ${NAMED_PLACE_IDS.length}`);

  const extra = PLACE_IDS.filter((id) => !NAMED_PLACE_IDS.includes(id));
  ok("and nothing here is a place a game could never name", extra.length === 0,
     extra.join(", "));

  /* Which are playable has to agree too, or the panel offers a game that the
     room will refuse. */
  ok("the playable places match the contract's list",
     LIVE_PLACE_IDS.length === PLACES_LIVE.length
       && LIVE_PLACE_IDS.every((id) => PLACES_LIVE.includes(id)),
     `${LIVE_PLACE_IDS.join(", ")} against ${PLACES_LIVE.join(", ")}`);
}

/* ================= A SHIP ARRIVES INSIDE ITS OWN WORLD ================= */
{
  /* THE ONE THAT MATTERS. See the note at the top of this file. */
  let bad = 0;
  const why: string[] = [];
  for (const p of PLACES) {
    ok(`${p.id}: the floor is below the ceiling`, p.floor < p.ceiling,
       `${p.floor.toFixed(1)} to ${p.ceiling.toFixed(1)}`);
    if (!p.arrival) continue;                 /* Earth: the player's own pad */
    const at = p.arrival.length();
    if (!withinPlace(p, at)) {
      bad++;
      why.push(`${p.id} arrives at ${at.toFixed(1)}, world is ${p.floor.toFixed(1)}..${p.ceiling.toFixed(1)}`);
    }
  }
  ok("every place puts an arriving ship INSIDE its own bounds", bad === 0,
     why.join("; ") || `${PLACES.filter((p) => p.arrival).length} checked`);

  /* Earth alone has no fixed arrival, because a player belongs at their own
     tower and no two players share one. */
  ok("Earth has no fixed arrival, because everyone has their own pad",
     placeById("earth")!.arrival === null);
  ok("and everywhere else does have one",
     PLACES.filter((p) => p.id !== "earth").every((p) => p.arrival !== null));
}

/* ================= THE TWO THAT ALREADY EXISTED ================= */
{
  const earth = placeById("earth")!;
  /* Exactly what the room has always checked a position against, so turning
     the branch into a row changed no behaviour. */
  ok("Earth's bounds are the flight model's own",
     Math.abs(earth.floor - (R + MIN_ALT - 2)) < 1e-9
       && Math.abs(earth.ceiling - (R + MAX_ALT + 2)) < 1e-9,
     `${earth.floor.toFixed(2)} to ${earth.ceiling.toFixed(2)}`);
  ok("and it is centred on the globe itself", earth.centre.length() === 0);

  const spike = placeById("spike")!;
  ok("Spikeworld is centred on its heart",
     spike.centre.distanceTo(SPIKEWORLD_CENTRE) < 1e-9);
  /* Floor zero, and that is the whole point: there is no ground out there, and
     judging it by Earth's floor is what put arriving pilots inside the heart. */
  ok("Spikeworld has no floor, because it has no ground", spike.floor === 0);
  ok("and a ship arrives outside its shell, not inside it",
     spike.arrival!.length() > 0 && spike.arrival!.length() < spike.ceiling,
     `${spike.arrival!.length().toFixed(0)} of ${spike.ceiling.toFixed(0)}`);
}

/* ================= THE FOURTEEN ================= */
{
  ok("there is a row for every planet",
     PLACE_IDS.filter((id) => id.startsWith("p")).length === PLANET_COUNT,
     `${PLACE_IDS.filter((id) => id.startsWith("p")).length} of ${PLANET_COUNT}`);

  /* A game at a planet has to happen at the planet the player can SEE, not at
     a number that resembles it. */
  let wrong = 0;
  for (let n = 1; n <= PLANET_COUNT; n++) {
    const p = placeById(`p${n}`)!;
    if (p.centre.distanceTo(planetCentre(n)) > 1e-9) wrong++;
  }
  ok("each planet place sits exactly where the sky draws that planet",
     wrong === 0, `${wrong} in the wrong place`);

  /* Sized from the model, because the planets are the one thing that was never
     shrunk when everything else halved. */
  const p1 = placeById("p1")!, p14 = placeById("p14")!;
  ok("a planet's bubble is sized from its own radius",
     Math.abs(p1.ceiling - (planetDiameter(1) / 2) * PLANET_BUBBLE) < 1e-9
       && Math.abs(p14.ceiling - (planetDiameter(14) / 2) * PLANET_BUBBLE) < 1e-9,
     `p1 ${p1.ceiling.toFixed(0)}, p14 ${p14.ceiling.toFixed(0)}`);
  ok("and the floor clears the surface", PLANET_FLOOR > 1 && PLANET_ARRIVAL > PLANET_FLOOR,
     `floor x${PLANET_FLOOR}, arrival x${PLANET_ARRIVAL}`);

  /* Not reachable yet: a game can be written for one, but publishing it waits
     for somebody to decide what a planet actually has in it. */
  ok("no planet is playable yet",
     PLACES.filter((p) => p.kind === "planet").every((p) => !p.live));

  /* The names are a second copy of the sky's, which is a thing that drifts. */
  const sky = furnitureLayout();
  ok("(context) the sky still draws its own furniture", sky.length > 0, `${sky.length} objects`);
  const named = PLACES.filter((p) => p.kind === "planet").map((p) => p.name);
  ok("every planet place is named, and no two share a name",
     named.every((n) => n.length > 0) && new Set(named).size === named.length,
     named.slice(0, 3).join(", ") + "...");
}

/* ================= ASKING FOR A PLACE ================= */
{
  ok("a known place comes back", placeById("spike")?.id === "spike");
  /* A game pointed at nowhere must be answerable, not throw: the caller has to
     be able to refuse it politely. */
  ok("an unknown one is null rather than an exception", placeById("atlantis") === null);
  ok("and so is nonsense", placeById("") === null);

  const spike = placeById("spike")!;
  ok("a position inside the world is inside", withinPlace(spike, 1000));
  ok("one past the ceiling is not", !withinPlace(spike, spike.ceiling + 1));
  const earth = placeById("earth")!;
  ok("and one below Earth's floor is not", !withinPlace(earth, R - 10));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
