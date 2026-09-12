// The help card's table: the groups Geoff asked for, and nothing written
// twice.
//
// Run: sh scripts/run-rebels-controls-tests.sh
//
// Geoff's words, which this checks line by line: "show the keyboard layout on
// the top, and when mouse-over the various keys, it puts in bold the
// explanations below. The explanations should be in groups like WASD all
// highlight together. QE together, RC together, and TAB/SHIFT as 2x and 1x
// Boost." And: "Don't hardcode anything because we will add items such as a
// 3x boost item to buy or 1.5x or 2x strafe."

import { CONTROL_GROUPS, GROUP_OF_KEY, GAME_KEYS, KEYBOARD_CAPS, controlLines } from "./RebelsControls";
import { NO_EXTRAS, BOOST, STRAFE_SPEED } from "./orbitFlight";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const groupOf = (key: string) => GROUP_OF_KEY[key];

/* ---- the groups he named ---- */
{
  ok("WASD all highlight together",
     new Set(["w", "a", "s", "d"].map(groupOf)).size === 1 && groupOf("w") !== undefined,
     ["w", "a", "s", "d"].map(groupOf).join(","));
  ok("QE together", groupOf("q") === groupOf("e") && groupOf("q") !== undefined);
  ok("RC together", groupOf("r") === groupOf("c") && groupOf("r") !== undefined);
  ok("TAB and SHIFT together, as one boost", groupOf("tab") === groupOf("shift") && groupOf("tab") !== undefined);
  ok("and they are four different groups",
     new Set([groupOf("w"), groupOf("q"), groupOf("r"), groupOf("tab")]).size === 4);
  const boost = CONTROL_GROUPS.find((g) => g.id === groupOf("tab"))!;
  ok("the boost line gives both multipliers", /1x/.test(boost.what({ extras: NO_EXTRAS })) && /2x/.test(boost.what({ extras: NO_EXTRAS })),
     boost.what({ extras: NO_EXTRAS }));
}

/* ---- every line can be reached from the picture above it ---- */
{
  const capKeys = new Set(KEYBOARD_CAPS.filter((c) => c[1]).map((c) => c[1] as string));
  const unreachable = CONTROL_GROUPS.filter((g) => !g.keys.some((k) => capKeys.has(k)));
  ok("every explanation has a cap on the keyboard that lights it",
     unreachable.length === 0, unreachable.map((g) => g.id).join(","));
  const orphan = [...capKeys].filter((k) => !GROUP_OF_KEY[k]);
  ok("and no cap lights nothing", orphan.length === 0, orphan.join(","));
  ok("the mouse is on it, since the mouse is a control", capKeys.has("MOUSE"));
}

/* ---- nothing hardcoded: the words follow what the ship carries ---- */
{
  const plain = { extras: NO_EXTRAS };
  const kitted = { extras: { ...NO_EXTRAS, strafeMult: 2, vstrafeMult: 3, superMult: 3 } };
  const line = (id: string, ctx: typeof plain) => CONTROL_GROUPS.find((g) => g.id === id)!.what(ctx);

  const move = groupOf("a")!, lift = groupOf("r")!, boost = groupOf("tab")!;
  ok("a 2x strafe item changes the sideways figure",
     line(move, kitted).includes(`${STRAFE_SPEED * 2}`) && !line(move, plain).includes(`${STRAFE_SPEED * 2}`),
     line(move, kitted));
  ok("a 3x vertical strafe changes the up and down figure, on its own",
     line(lift, kitted).includes(`${STRAFE_SPEED * 3}`) && line(lift, kitted) !== line(move, kitted),
     line(lift, kitted));
  ok("the vertical line does NOT quote the horizontal multiplier",
     !line(lift, kitted).includes(`${STRAFE_SPEED * 2} units`), line(lift, kitted));
  ok("a 3x boost item changes the boost figures",
     line(boost, kitted).includes(`${BOOST * 3}`) && line(boost, kitted).includes("3x"),
     line(boost, kitted));
}

/* ---- the table is the one source ---- */
{
  ok("every group has a label and a sentence",
     CONTROL_GROUPS.every((g) => g.label.length > 0 && /\.$/.test(g.what({ extras: NO_EXTRAS }))),
     CONTROL_GROUPS.filter((g) => !/\.$/.test(g.what({ extras: NO_EXTRAS }))).map((g) => g.id).join(","));
  ok("no key belongs to two groups",
     Object.keys(GROUP_OF_KEY).length === CONTROL_GROUPS.flatMap((g) => g.keys).length);
  ok("the keys the game swallows come from the same table",
     GAME_KEYS.includes("w") && GAME_KEYS.includes("7") && GAME_KEYS.includes("i")
     && !GAME_KEYS.includes("MOUSE") && !GAME_KEYS.includes("LEFT CLICK"));
  ok("the launch card reads the same table", controlLines({ extras: NO_EXTRAS }).length >= CONTROL_GROUPS.length);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
