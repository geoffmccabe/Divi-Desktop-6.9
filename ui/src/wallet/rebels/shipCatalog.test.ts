// The market's numbers.
//
// Stats are data, and data that is only ever looked at by eye drifts. These
// check the two rules Geoff actually stated — every variant is in, and each
// tier is ten percent better — plus the things that would make the panel lie.
//
// Run: sh scripts/run-rebels-market-tests.sh

import { shipCatalog, atTier, SHIP_CLASSES, STAT_ROWS, type ShipStats } from "./shipCatalog";
import { chipColour, FACTORY, PARTS } from "./shipColours";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const all = shipCatalog();

// 1. Every ship in the pack is in the market.
//
//    The catalog on R2 has 32 ship models. Geoff: "if there's more than one
//    variety of each class of ship, then include them all."
{
  ok("all thirty-two hulls are listed", all.length === 32, `${all.length}`);
  const ids = new Set(all.map((s) => s.id));
  ok("and none is listed twice", ids.size === all.length, `${ids.size} unique`);
  ok("every one names a real model file", all.every((s) => /^space_SM_Ship_/.test(s.id)));
  ok("every one has a name and a role", all.every((s) => s.name.length > 0 && s.role.length > 20));
}

// 2. THE RULE: each tier is ten percent better than the one below it.
{
  /* Compared against the RULE rather than against the neighbouring ship.
     Ratios between neighbours are the obvious test and the wrong one: crew and
     cargo are whole numbers, so 1 -> 1 -> 1 -> 2 is correct rounding of a
     ten percent rule and looks like a broken one. Asking "is each ship exactly
     what the rule says it should be" has no such blind spot. */
  const wrong: string[] = [];
  for (const cls of SHIP_CLASSES) {
    const ships = all.filter((s) => s.className === cls.name);
    ships.forEach((ship, i) => {
      const want = atTier(cls.base, i + 1);
      for (const row of STAT_ROWS) {
        if (Number(ship.stats[row.key]) !== Number(want[row.key])) {
          wrong.push(`${ship.name} ${row.key} ${ship.stats[row.key]} != ${want[row.key]}`);
        }
      }
    });
  }
  ok("every ship is exactly what the tier rule says", wrong.length === 0, wrong.slice(0, 3).join("; "));

  /* And the rule really is ten percent, checked where rounding cannot hide it. */
  const big = all.filter((s) => s.className === "Fighter");
  const step = Number(big[1].stats.hull) / Number(big[0].stats.hull);
  ok("which is a ten percent step", Math.abs(step - 1.1) < 0.01, `${step.toFixed(4)}`);

  /* Compounding, not adding: tier 3 is 21% above tier 1, not 20%. */
  const f = all.filter((s) => s.className === "Fighter");
  ok("and it compounds", Math.abs(Number(f[2].stats.hull) / Number(f[0].stats.hull) - 1.21) < 0.02,
     `${(Number(f[2].stats.hull) / Number(f[0].stats.hull)).toFixed(3)}`);
  ok("tier 1 is exactly the class baseline",
     Number(f[0].stats.hull) === SHIP_CLASSES[0].base.hull, `${f[0].stats.hull}`);
}

// 3. A lower signature is a BETTER signature, and the market must not draw it
//    as a worse one.
{
  const stealth = all.filter((s) => s.className === "Stealth");
  ok("a better stealth hull is harder to see",
     Number(stealth[4].stats.signature) < Number(stealth[0].stats.signature),
     `${stealth[0].stats.signature} -> ${stealth[4].stats.signature}`);
  ok("and the panel knows which way to read it",
     STAT_ROWS.find((r) => r.key === "signature")?.lowerIsBetter === true);
}

// 4. The classes are actually different from each other.
//
//    Ten numbers that are the same shape for every hull would make the market a
//    list rather than a choice.
{
  const byClass = new Map(SHIP_CLASSES.map((c) => [c.name, c.base]));
  const fighter = byClass.get("Fighter") as ShipStats;
  const bomber = byClass.get("Bomber") as ShipStats;
  const stealth = byClass.get("Stealth") as ShipStats;
  const station = byClass.get("Station") as ShipStats;

  ok("a fighter turns harder than a bomber", fighter.agility > bomber.agility * 1.5,
     `${fighter.agility} vs ${bomber.agility}`);
  ok("a bomber hits harder than a fighter", bomber.firepower > fighter.firepower * 2,
     `${bomber.firepower} vs ${fighter.firepower}`);
  ok("a stealth hull is the quietest thing flying",
     stealth.signature < Math.min(fighter.signature, bomber.signature),
     `${stealth.signature}`);
  ok("and it cannot take a hit", stealth.hull < fighter.hull, `${stealth.hull} vs ${fighter.hull}`);
  ok("a station does not move at all", station.speed === 0 && station.agility === 0);
  ok("but nothing else is immobile",
     all.filter((s) => s.className !== "Station").every((s) => Number(s.stats.speed) > 0));
}

// 5. Nothing on the panel can be blank, NaN or negative.
{
  let bad: string[] = [];
  for (const s of all) {
    for (const row of STAT_ROWS) {
      const v = Number(s.stats[row.key]);
      if (!Number.isFinite(v) || v < 0) bad.push(`${s.name}.${row.key}=${v}`);
    }
  }
  ok("every number is a real number", bad.length === 0, bad.slice(0, 4).join("; "));
  ok("all ten stats are shown", STAT_ROWS.length === 10, `${STAT_ROWS.length}`);
}

// 6. The swatch chip has to agree with the ship.
//
//    Geoff: "it changes on the ship, but it doesn't change on the swatches by
//    the names of each of the 5." The chip is a promise about what the hull
//    will look like, and the shader keeps the pixel's own brightness rather
//    than replacing it, so a chip that ignores that brightness lies at exactly
//    the settings a player is most likely to try.
{
  const paint = { ...FACTORY };
  const first = chipColour("hull1", paint);
  ok("the factory chip is a real colour", /^hsl\(\d+ \d+% \d+%\)$/.test(first), first);

  /* Every slider has to move it. */
  const hue = chipColour("hull1", { ...paint, hull1: { ...paint.hull1, hue: 12 } });
  ok("hue moves the chip", hue !== first, `${first} -> ${hue}`);
  const sat = chipColour("hull1", { ...paint, hull1: { ...paint.hull1, sat: 0 } });
  ok("saturation moves the chip", sat !== first, `${first} -> ${sat}`);
  const dim = chipColour("hull1", { ...paint, hull1: { ...paint.hull1, bright: 0.3 } });
  ok("brightness moves the chip", dim !== first, `${first} -> ${dim}`);

  /* And it has to move the RIGHT way: dimmer is darker, brighter is lighter. */
  const lum = (c: string) => Number(c.match(/(\d+)%\)$/)?.[1] ?? -1);
  const bright = chipColour("hull1", { ...paint, hull1: { ...paint.hull1, bright: 2 } });
  ok("turning brightness down darkens it", lum(dim) < lum(first), `${lum(dim)} vs ${lum(first)}`);
  ok("and turning it up lightens it", lum(bright) > lum(first), `${lum(bright)} vs ${lum(first)}`);

  /* The five parts do not all start the same, because the swatches they stand
     for do not: the engine is a bright cyan and the panelling is nearly black.
     A chip set that ignored that would show five identical squares. */
  const chips = PARTS.map((p) => chipColour(p.key, FACTORY));
  ok("the five factory chips are all different", new Set(chips).size === 5, chips.join(" "));
  /* Compared by SATURATION rather than by lightness. A fully saturated colour
     sits at 50% lightness by definition, so the cyan engine reads as "darker"
     than the softer orange on that scale even though it is the most vivid
     thing on the ship. Lightness is the wrong measure for "which of these
     stands out", and the first version of this check used it and was wrong. */
  const satOf = (c: string) => Number(c.match(/(\d+)% \d+%\)$/)?.[1] ?? -1);
  ok("the engine is the most vivid of them",
     satOf(chipColour("engine", FACTORY)) === Math.max(...chips.map(satOf)),
     chips.map((c) => satOf(c)).join(", "));
  ok("and the dark panelling is the darkest",
     lum(chipColour("hull2", FACTORY)) === Math.min(...chips.map(lum)),
     chips.map((c) => lum(c)).join(", "));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
