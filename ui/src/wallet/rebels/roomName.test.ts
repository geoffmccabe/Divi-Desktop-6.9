// Reading a room's name, which is the one thing three files used to each know
// a different part of.
//
// Run: sh scripts/run-rebels-roomname-tests.sh
//
// This exists because the old version of it was WRONG and had no symptom:
// `/^spike(?:-\d{1,2})?$/ ? "spike" : "earth"` reads `spike_descent` as EARTH,
// so a cockpit in a Spikeworld game room would subtract Earth's origin and
// report positions two hundred thousand units from where the room thought it
// was. Every one refused, the player snapped back for ever, and nothing
// logged. The parser replaces a rule that guessed with one that can say no.
export {};

import {
  parseRoom, roomNameOf, regionOfRoom, gameOfRoom, nextRoomName, OVERFLOW_MAX,
} from "./rebelsRegions";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= THE GRAMMAR ================= */
{
  const cases: Array<[string, string, number, string | null]> = [
    ["earth", "earth", 1, null],
    ["spike", "spike", 1, null],
    ["earth-2", "earth", 2, null],
    ["spike-16", "spike", 16, null],
    ["earth_shakedown", "earth", 1, "shakedown"],
    ["spike_descent", "spike", 1, "descent"],
    ["spike-3_descent", "spike", 3, "descent"],
    ["earth-2_wave-defence", "earth", 2, "wave-defence"],
  ];
  for (const [name, region, overflow, game] of cases) {
    const p = parseRoom(name);
    ok(`${name} reads as ${region}, room ${overflow}, game ${game ?? "the place's own"}`,
       !!p && p.region === region && p.overflow === overflow && p.game === game,
       JSON.stringify(p));
  }

  /* THE ONE THAT WAS WRONG. Worth its own line rather than being buried in
     the table above, because it is the whole reason this file exists. */
  ok("spike_descent is SPIKE, which the rule it replaced got wrong",
     regionOfRoom("spike_descent") === "spike", `${regionOfRoom("spike_descent")}`);
  ok("and gameOfRoom reads the game off it", gameOfRoom("spike-3_descent") === "descent");
  ok("a plain region room has no game", gameOfRoom("earth") === null);
}

/* ================= WHAT IS NOT A ROOM ================= */
{
  const bad = [
    ["mars", "a region nobody has"],
    ["earth-1", "room one written with a number, which would be a second name for one room"],
    ["earth-0", "room zero"],
    [`earth-${OVERFLOW_MAX + 1}`, "past the last overflow room"],
    ["earth_", "a trailing separator with no game"],
    ["earth_Shakedown", "a game id with a capital, which no id has"],
    ["earth_a", "a game id too short to be one"],
    ["earth shakedown", "a space"],
    ["", "nothing at all"],
    ["earth_shakedown_descent", "two games"],
  ];
  for (const [name, why] of bad) {
    ok(`refused: ${why}`, parseRoom(name) === null, `${JSON.stringify(name)} -> ${JSON.stringify(parseRoom(name))}`);
  }

  /* NULL AND NOT A GUESS is the point. The rule this replaced defaulted
     everything it did not understand to Earth, which is exactly how a wrong
     answer became a silent one. */
  ok("an unreadable name gives no region rather than defaulting to Earth",
     regionOfRoom("mars") === null, `${regionOfRoom("mars")}`);
}

/* ================= READING AND WRITING ARE INVERSES =================
   Two functions that must agree, with nothing making them, is the bug that
   caught us five times in a day. So: over every shape of name, round-trip. */
{
  let bad = "";
  let n = 0;
  for (const region of ["earth", "spike"] as const) {
    for (const overflow of [1, 2, 3, OVERFLOW_MAX]) {
      for (const game of [null, "shakedown", "wave-defence"]) {
        n++;
        const name = roomNameOf({ region, overflow, game });
        const back = parseRoom(name);
        if (!back || back.region !== region || back.overflow !== overflow || back.game !== game) {
          bad ||= `${JSON.stringify({ region, overflow, game })} -> "${name}" -> ${JSON.stringify(back)}`;
        }
      }
    }
  }
  ok(`writing a name and reading it back gives the same thing, over all ${n} shapes`, !bad, bad);
}

/* ================= OVERFLOW CARRIES THE GAME ================= */
{
  ok("a full plain room overflows to the next plain one",
     nextRoomName("earth") === "earth-2", nextRoomName("earth"));
  /* The one that matters: being pushed out of a full room must not put a
     player in a DIFFERENT GAME. Same class of silent wrong as the spike one. */
  ok("a full game room overflows to the same game",
     nextRoomName("earth_shakedown") === "earth-2_shakedown", nextRoomName("earth_shakedown"));
  ok("and keeps counting", nextRoomName("spike-3_descent") === "spike-4_descent",
     nextRoomName("spike-3_descent"));
  ok("the last room overflows nowhere", nextRoomName(`earth-${OVERFLOW_MAX}`) === "");
  ok("and a name that is not a room overflows nowhere", nextRoomName("mars") === "");
}

/* ================= WHAT A RECONNECT KEEPS AND DROPS =================
   The three-way answer, because the first attempt got one wrong in each
   direction and only the existing suite noticed. Keep the region or a player
   ends up two hundred thousand units from their ship; keep the game or a blip
   puts them in a different one; DROP the overflow room, because a disconnect
   is meant to put people back in the main room so the shared world refills
   rather than everyone staying scattered. */
{
  const afterBlip = (name: string) => {
    const p = parseRoom(name);
    return p ? roomNameOf({ ...p, overflow: 1 }) : null;
  };
  const cases: Array<[string, string]> = [
    ["earth", "earth"],
    ["earth-2", "earth"],
    ["spike-4", "spike"],
    ["earth_shakedown", "earth_shakedown"],
    ["earth-2_shakedown", "earth_shakedown"],
    ["spike-3_descent", "spike_descent"],
  ];
  for (const [from, want] of cases) {
    ok(`a blip in ${from} comes back to ${want}`, afterBlip(from) === want, `${afterBlip(from)}`);
  }
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
