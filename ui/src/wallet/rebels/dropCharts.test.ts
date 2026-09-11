// Drop charts and the inventory: the odds are the odds, and a count never
// goes backwards.
//
// Run: sh scripts/run-rebels-drops-tests.sh

import {
  DEFAULT_DROP_CONFIG, DROP_CHANCE_PER_TIER, chartTotal, weightedPick, rollDrop, dropChance,
  chartOdds, validateDropConfig, droppableKeys, type DropConfig,
} from "./dropCharts";
import {
  ALL_ITEMS, DROP_ITEMS, ITEMS, FORGED_ITEMS, itemByKey, itemMark, itemTierColour, ITEM_TIER_COLOURS,
  forgeable, forgeResult, hullMult, vstrafeMult, strafeMult, FORGE_ODDS,
} from "./itemCatalog";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* A browser's worth of storage, for the inventory. */
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const fired: string[] = [];
(globalThis as Record<string, unknown>).window = { dispatchEvent: (e: { type: string }) => { fired.push(e.type); return true; } };
(globalThis as Record<string, unknown>).Event = class { type: string; constructor(t: string) { this.type = t; } };

/* ---- the catalogue ---- */
{
  ok("the store still sells exactly what it sold", ITEMS.length === 7 && ITEMS.every((i) => !i.drop));
  ok("twenty-two found things", DROP_ITEMS.length === 22, `${DROP_ITEMS.length}`);
  ok("every found thing is priceless and needs nothing", DROP_ITEMS.every((i) => i.drop && i.points === 0 && i.needs === null));
  ok("keys are unique across both lists", new Set(ALL_ITEMS.map((i) => i.key)).size === ALL_ITEMS.length);
  ok("itemByKey finds a found thing", itemByKey("drone5")?.tier === 5 && itemByKey("vstrafe4")?.amount === 3);
  ok("strafe tiers are 1.5x, 2x, 2.5x, 3x", [1, 2, 3, 4].map((n) => itemByKey(`strafe${n}`)!.amount).join(",") === "1.5,2,2.5,3");
  ok("hull tiers are 20% a tier", [1, 2, 3, 4, 5].map((n) => Math.round(itemByKey(`hull${n}`)!.amount * 100)).join(",") === "20,40,60,80,100");
  ok("the two consumables say so", itemByKey("recharge")?.consumable === true && itemByKey("supercharge")?.consumable === true && !itemByKey("hull1")?.consumable);
  ok("seven tier colours, yellow first, red fifth", ITEM_TIER_COLOURS.length === 7 && itemTierColour(1) === 0xf2d94a && itemTierColour(5) === 0xff4d4d);
  ok("a tier past the end is the last colour", itemTierColour(9) === ITEM_TIER_COLOURS[6] && itemTierColour(0) === ITEM_TIER_COLOURS[0]);
  ok("marks tell the kinds apart", new Set(DROP_ITEMS.map((i) => itemMark(i))).size === 8, [...new Set(DROP_ITEMS.map((i) => itemMark(i)))].join(""));
  ok("forged by-name tiers exist for the four families up to seven", FORGED_ITEMS.length === 3 + 3 + 2 + 2, `${FORGED_ITEMS.length}`);
  ok("a by-name tier has the top tier's power and never drops", itemByKey("hull7")?.amount === itemByKey("hull5")?.amount && itemByKey("hull7")?.byName === true && !itemByKey("hull7")?.drop && itemByKey("strafe6")?.amount === 3);
  ok("only tiered families forge, and not at the top", forgeable(itemByKey("hull1")!) && forgeable(itemByKey("drone5")!) && !forgeable(itemByKey("hull7")!) && !forgeable(itemByKey("recharge")!) && !forgeable(itemByKey("portal")!));
  ok("the forge odds are 90 / 9 / 1", FORGE_ODDS.join(",") === "0.9,0.09,0.01");
  ok("a roll under 90% is one tier up", forgeResult(itemByKey("hull1")!, 0.5) === "hull2" && forgeResult(itemByKey("hull1")!, 0.899) === "hull2");
  ok("under 99% two, else three", forgeResult(itemByKey("hull1")!, 0.95) === "hull3" && forgeResult(itemByKey("hull1")!, 0.995) === "hull4");
  ok("capped at seven by name", forgeResult(itemByKey("vstrafe4")!, 0.995) === "vstrafe7" && forgeResult(itemByKey("hull6")!, 0.5) === "hull7");
  ok("the passives read the best tier held", Math.abs(hullMult(["hull2", "hull1"]) - 1.4) < 1e-9 && hullMult([]) === 1 && vstrafeMult(["vstrafe3"]) === 2.5 && vstrafeMult(["strafe4"]) === 1 && strafeMult(["strafe2"]) === 2);
  ok("a by-name tier applies the top's power", Math.abs(hullMult(["hull7"]) - 2) < 1e-9);
  ok("every droppable key is a found thing", droppableKeys().length === 22 && droppableKeys().every((k) => itemByKey(k)?.drop));
}

/* ---- the default chart ---- */
{
  const chart = DEFAULT_DROP_CONFIG.charts[0];
  ok("Geoff's chart totals 313,951", chartTotal(chart) === 313_951, `${chartTotal(chart)}`);
  ok("every entry is a real found thing", chart.entries.every((e) => itemByKey(e.key)?.drop));
  ok("all twenty-two are on it", chart.entries.length === 22);
  const odds = new Map(chartOdds(chart).map((o) => [o.key, o.share]));
  ok("Instant Recharge is about 32%", Math.abs((odds.get("recharge") ?? 0) - 100_000 / 313_951) < 1e-9);
  ok("a T5 drone is one in eight thousand", Math.abs((odds.get("drone5") ?? 0) - 39 / 313_951) < 1e-9);
  ok("shares sum to one", Math.abs(chartOdds(chart).reduce((s, o) => s + o.share, 0) - 1) < 1e-9);
  ok("one rule, every enemy, every tier, 10% a tier", DEFAULT_DROP_CONFIG.rules.length === 1 && DEFAULT_DROP_CONFIG.rules[0].chancePerTier === DROP_CHANCE_PER_TIER);
  ok("a tier-one wreck drops one time in ten", dropChance(DEFAULT_DROP_CONFIG, "fighter", 1) === 0.1);
  ok("a tier-seven flock member seven in ten", Math.abs(dropChance(DEFAULT_DROP_CONFIG, "flock", 7) - 0.7) < 1e-9);
  ok("it validates as it is", "ok" in validateDropConfig(DEFAULT_DROP_CONFIG));
}

/* ---- the pick ---- */
{
  const chart = { id: "t", name: "t", entries: [{ key: "hull1", weight: 1 }, { key: "hull2", weight: 3 }, { key: "hull3", weight: 0 }] };
  ok("r under the first weight is the first", weightedPick(chart, 0) === "hull1" && weightedPick(chart, 0.249) === "hull1");
  ok("r over it is the second", weightedPick(chart, 0.25) === "hull2" && weightedPick(chart, 0.999) === "hull2");
  ok("a zero weight is never picked", weightedPick(chart, 0.9999999) === "hull2");
  ok("r of one does not fall off the end", weightedPick(chart, 1) === "hull2" && weightedPick(chart, 5) === "hull2");
  ok("an empty chart is nothing", weightedPick({ id: "e", name: "e", entries: [] }, 0.5) === null);

  /* Ten thousand rolls land within a few percent of the weights. */
  let seed = 12345;
  const rand = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const n = 100_000;
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const k = weightedPick(DEFAULT_DROP_CONFIG.charts[0], rand())!; counts[k] = (counts[k] ?? 0) + 1; }
  const share = (counts.recharge ?? 0) / n;
  ok("a hundred thousand picks track the weights", Math.abs(share - 100_000 / 313_951) < 0.01, share.toFixed(4));
  ok("the rare things are rare", (counts.drone5 ?? 0) < 60 && (counts.portal ?? 0) < 100, `${counts.drone5} ${counts.portal}`);

  /* rollDrop: whether, then what. */
  const cfg = DEFAULT_DROP_CONFIG;
  ok("under the chance is a drop", rollDrop(cfg, "fighter", 1, 0.099, 0) === "recharge");
  ok("at the chance is not", rollDrop(cfg, "fighter", 1, 0.1, 0) === null);
  ok("a higher tier widens it", rollDrop(cfg, "fighter", 3, 0.29, 0) === "recharge" && rollDrop(cfg, "fighter", 3, 0.31, 0) === null);
  const strict: DropConfig = { charts: cfg.charts, rules: [{ enemy: "flock", tierMin: 1, tierMax: 7, chart: "chart1", chancePerTier: 1 }] };
  ok("a rule for flocks leaves fighters with nothing", rollDrop(strict, "fighter", 7, 0, 0) === null && rollDrop(strict, "flock", 1, 0.99, 0) === "recharge");
}

/* ---- the validator ---- */
{
  const bad = validateDropConfig({ charts: [{ id: "c", entries: [{ key: "deathray", weight: 5 }] }], rules: [] });
  ok("an unknown item is named", "errors" in bad && bad.errors.some((e) => e.includes("deathray")), JSON.stringify(bad));
  const bad2 = validateDropConfig({ charts: [{ id: "c", entries: [{ key: "hull1", weight: 5 }] }], rules: [{ enemy: "any", tierMin: 1, tierMax: 7, chart: "nope", chancePerTier: 0.1 }] });
  ok("a rule pointing nowhere is refused", "errors" in bad2 && bad2.errors.some((e) => e.includes("nope")));
  const bad3 = validateDropConfig({ charts: [{ id: "c", entries: [{ key: "hull1", weight: 5 }] }], rules: [{ enemy: "any", tierMin: 1, tierMax: 7, chart: "c", chancePerTier: 2 }] });
  ok("a chance over one is refused", "errors" in bad3);
  const good = validateDropConfig({ charts: [{ id: "c", name: "x", entries: [{ key: "hull1", weight: "5" }] }], rules: [{ enemy: "fighter", tierMin: "2", tierMax: 4, chart: "c", chancePerTier: "0.5" }] });
  ok("strings from a form are read as numbers", "ok" in good && good.ok.charts[0].entries[0].weight === 5 && good.ok.rules[0].tierMin === 2 && good.ok.rules[0].chancePerTier === 0.5);
  ok("nothing at all is refused", "errors" in validateDropConfig(null) && "errors" in validateDropConfig({ charts: [], rules: [] }));
}

/* ---- the inventory ---- */
{
  const INV = await import("./rebelsInventory");
  INV.resetInventoryForTests();
  ok("empty to start", Object.keys(INV.heldItems()).length === 0);
  ok("a pickup is one more", INV.addHeld("hull2") && INV.heldCount("hull2") === 1);
  ok("and again", INV.addHeld("hull2") && INV.heldCount("hull2") === 2);
  ok("an unknown key is refused", !INV.addHeld("deathray") && Object.keys(INV.heldItems()).length === 1);
  ok("a change is announced on the armoury's channel", fired.includes("dd69-rebels-armoury"));
  ok("taking more than held takes nothing", !INV.takeHeld("hull2", 3) && INV.heldCount("hull2") === 2);
  ok("taking what is held works and clears the stack", INV.takeHeld("hull2", 2) && INV.heldCount("hull2") === 0 && !("hull2" in INV.heldItems()));
  INV.addHeld("drone1", 1); INV.addHeld("hull5", 2); INV.addHeld("recharge", 4); INV.addHeld("drone5", 1);
  ok("sorted best tier first, then by name", INV.heldSorted().map((x) => x.key).join(",") === "drone5,hull5,drone1,recharge", INV.heldSorted().map((x) => x.key).join(","));
  ok("merge takes the larger count and never less", INV.mergeHeld({ hull5: 1, recharge: 9, junk: 3 }) && INV.heldCount("hull5") === 2 && INV.heldCount("recharge") === 9 && INV.heldCount("junk") === 0);
  ok("merging nothing new moves nothing", !INV.mergeHeld({ hull5: 2 }) && !INV.mergeHeld(null));
  store.set("dd69.rebels.items", "{not json");
  ok("a broken saved copy reads as empty", Object.keys(INV.heldItems()).length === 0);

  /* ---- sealed spheres ----
     A pickup is a sphere; opening it in the inventory is what makes it the
     item. Sold unopened one day, so the two are counted apart. */
  INV.resetInventoryForTests();
  ok("a pickup is a sealed sphere, not the item", INV.addSphere("hull2") && INV.heldCount("sphere:hull2") === 1 && INV.heldCount("hull2") === 0);
  ok("spheres are listed by the item inside, best first", (INV.addSphere("drone1"), INV.addSphere("hull2"), INV.spheresSorted().map((s) => `${s.key}x${s.count}`).join(",")) === "hull2x2,drone1x1", INV.spheresSorted().map((s) => `${s.key}x${s.count}`).join(","));
  ok("and are not among the opened items", INV.heldSorted().length === 0);
  ok("opening one moves it", INV.openSphere("hull2") && INV.heldCount("sphere:hull2") === 1 && INV.heldCount("hull2") === 1);
  ok("opening what you do not have does nothing", !INV.openSphere("drone5") && !INV.openSphere("hull1") && INV.heldCount("drone5") === 0);
  ok("a sphere of a bought-only thing is refused", !INV.addSphere("vip") && !INV.addHeld("sphere:mini"));
  ok("a sphere of nothing is refused", !INV.addSphere("deathray"));
  ok("the account copy merges spheres too", INV.mergeHeld({ "sphere:drone5": 2, "sphere:deathray": 1 }) && INV.heldCount("sphere:drone5") === 2 && INV.heldCount("sphere:deathray") === 0);
  ok("keyInside reads through the seal", INV.keyInside("sphere:hull3") === "hull3" && INV.keyInside("hull3") === "hull3");

  /* ---- gained and used ----
     Using something must survive a merge with a stale, richer copy. */
  INV.resetInventoryForTests();
  INV.addHeld("recharge", 3);
  ok("using one leaves two", INV.takeHeld("recharge", 1) && INV.heldCount("recharge") === 2);
  ok("the raw counters show three gained, one used", INV.rawHeld().recharge === 3 && INV.rawHeld()["used:recharge"] === 1);
  ok("a stale copy with three gained brings nothing back", !INV.mergeHeld({ recharge: 3 }) && INV.heldCount("recharge") === 2);
  ok("a copy that used more takes it away", INV.mergeHeld({ recharge: 3, "used:recharge": 3 }) && INV.heldCount("recharge") === 0);
  ok("a used counter cannot be added to directly", !INV.addHeld("used:recharge", 5));
  ok("opened items are the gear the flight reads", (INV.addHeld("hull3"), INV.addSphere("hull4"), INV.heldKeys().join(",")) === "hull3", INV.heldKeys().join(","));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
