// Whether a kill drops a sealed pack, and which set it came from.
// Run: sh scripts/run-rebels-nfddrop-tests.sh

import {
  nfdDropSets, nfdDropProblems, nfdDropChance, rollNfdDrop, nfdDropOdds,
  NFD_DROP_CHANCE_PER_TIER,
} from "./nfdDrop";
import type { NfdCollection } from "./nfdCatalog";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

const hash = (c: string) => c.repeat(64);
const set = (over: Partial<NfdCollection> = {}): NfdCollection => ({
  id: "divi-rebels", name: "Divi Rebels", description: "", aspectRatio: "5:7",
  packagedArt: "https://example.test/sealed.webp",
  ultraRare: null, logo: null, featured: null, banner: null,
  items: [], enabled: true, chainId: hash("a"),
  ...over,
});

/* ================= WHICH SETS CAN ACTUALLY DROP ================= */
{
  ok("a switched-on, launched set with art can drop", nfdDropSets([set()]).length === 1);
  ok("a switched-off set cannot", nfdDropSets([set({ enabled: false })]).length === 0);
  /* ⚠ THE ONE THAT MATTERS. Capture has to mint, and a set with no on-chain
     id has nowhere to mint to. Letting it drop would put a cube in the sky
     that the player chases, catches, and loses. */
  ok("a set that has not been launched cannot, because capture could not mint",
     nfdDropSets([set({ chainId: null })]).length === 0);
  ok("a set with no packaged art cannot, because the cube would be invisible",
     nfdDropSets([set({ packagedArt: null })]).length === 0);

  /* Two players watching the same kill must see the same cube, so a given
     random number has to pick the same set on every machine. Insertion order
     comes from a database query and is not a promise; the id is. */
  const unsorted = [set({ id: "zeta", chainId: hash("c") }), set({ id: "alpha", chainId: hash("b") })];
  ok("the order is stable regardless of how they arrived",
     nfdDropSets(unsorted).map((s) => s.id).join(",") === "alpha,zeta",
     nfdDropSets(unsorted).map((s) => s.id).join(","));

  const mixed = [set({ id: "good" }), set({ id: "off", enabled: false }), set({ id: "unlaunched", chainId: null })];
  ok("and the good one survives a bad crowd",
     nfdDropSets(mixed).map((s) => s.id).join(",") === "good");
}

/* ================= WHY A SET IS NOT DROPPING ================= */
/* Silence is the enemy here: the symptom of every one of these is "NFDs never
   drop", which looks identical to a broken roll. */
{
  ok("a good set reports no problem", nfdDropProblems([set()]).length === 0);
  ok("a switched-off set is not a problem, it is a decision",
     nfdDropProblems([set({ enabled: false })]).length === 0);

  const unlaunched = nfdDropProblems([set({ chainId: null })]);
  ok("an unlaunched set is named, with the reason", unlaunched.length === 1, unlaunched[0]?.why);
  ok("and the reason mentions minting, not a field name",
     /mint/i.test(unlaunched[0]?.why ?? ""), unlaunched[0]?.why);

  const artless = nfdDropProblems([set({ packagedArt: null })]);
  ok("an artless set is named too", artless.length === 1, artless[0]?.why);

  /* An unlaunched AND artless set is ONE problem, not two: fixing the art
     would change nothing while it is unlaunched, so naming both would send an
     admin to the wrong field first. */
  const both = nfdDropProblems([set({ chainId: null, packagedArt: null })]);
  ok("a set with two faults reports the blocking one only", both.length === 1, both[0]?.why);
}

/* ================= THE RATE ================= */
{
  ok("one percent per tier is one percent per tier", NFD_DROP_CHANCE_PER_TIER === 0.01);
  ok("tier 1 is one in a hundred", Math.abs(nfdDropChance(1) - 0.01) < 1e-12);
  /* Geoff chose the full 1% per tier with no cap. At the top of the set that
     is a very large number and he should see it rather than infer it. */
  ok("tier 30 is nearly a third of all kills", Math.abs(nfdDropChance(30) - 0.3) < 1e-12,
     `${(nfdDropChance(30) * 100).toFixed(0)}% of tier 30 kills drop a pack`);
  ok("tier 0 drops nothing", nfdDropChance(0) === 0);
  ok("a negative tier drops nothing rather than throwing", nfdDropChance(-5) === 0);
  ok("a fractional tier is floored, not rounded up", nfdDropChance(2.9) === nfdDropChance(2));

  /* ⚠ A probability above one is not "always": it is a number that silently
     breaks every comparison downstream of it. */
  ok("tier 100 is certain and not 1.0-and-a-bit", nfdDropChance(100) === 1);
  ok("tier 500 is still exactly certain", nfdDropChance(500) === 1);

  ok("a drop bonus multiplies it", Math.abs(nfdDropChance(10, 1.3) - 0.13) < 1e-12);
  ok("a bonus cannot push it past certain", nfdDropChance(90, 1.3) === 1);
  ok("a nonsense bonus drops nothing rather than everything", nfdDropChance(30, NaN) === 0);
  ok("a negative bonus drops nothing", nfdDropChance(30, -2) === 0);

  /* ---- THE TABLE, PRINTED, BECAUSE THE RATE IS GEOFF'S TO JUDGE ---- */
  const rows = nfdDropOdds([1, 5, 10, 20, 30]);
  out.push("");
  out.push("     NFD drop rate per kill, at the chosen 1% per tier:");
  for (const r of rows) {
    out.push(`       tier ${String(r.tier).padStart(2)}  ${(r.chance * 100).toFixed(0).padStart(3)}%   1 in ${r.oneIn.toFixed(1)} kills`);
  }
  out.push("");
  ok("the odds table agrees with the function it describes",
     rows.every((r) => r.chance === nfdDropChance(r.tier)));
  ok("tier zero is never-not-one-in-zero", nfdDropOdds([0])[0].oneIn === Infinity);
}

/* ================= THE ROLL ================= */
{
  const one = nfdDropSets([set()]);
  const three = nfdDropSets([set({ id: "a" }), set({ id: "b", chainId: hash("b") }), set({ id: "c", chainId: hash("c") })]);

  ok("no droppable set means no drop, however good the roll",
     rollNfdDrop([], 30, 0, 0) === null);
  ok("a certain roll on a certain tier drops",
     rollNfdDrop(one, 100, 0, 0)?.id === "divi-rebels");
  ok("a hopeless roll does not", rollNfdDrop(one, 30, 0.99, 0) === null);

  /* ⚠ THE FENCEPOST. The chance is an EXCLUSIVE upper bound: a roll of
     exactly 0.30 on a 30% chance must miss. If it hit, the real rate would be
     a hair over the stated one, forever, and no play session would ever
     reveal it. */
  ok("a roll exactly at the chance misses", rollNfdDrop(one, 30, 0.3, 0) === null);
  ok("and a roll a whisker under it hits", rollNfdDrop(one, 30, 0.2999999, 0) !== null);

  /* Sampled rather than asserted from the formula: a test that restates the
     implementation's arithmetic passes when both are wrong together. A fixed
     sweep, so the number does not wobble between runs. */
  const N = 200_000;
  let hits = 0;
  for (let i = 0; i < N; i++) if (rollNfdDrop(one, 30, (i + 0.5) / N, 0.5)) hits++;
  ok("over a full sweep the real rate is the stated rate",
     Math.abs(hits / N - 0.3) < 0.001, `${((hits / N) * 100).toFixed(2)}%`);

  /* Which set, given it dropped, must be even: a set launched later should not
     be rarer than one launched first. */
  const tally = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const got = rollNfdDrop(three, 100, 0, (i + 0.5) / N);
    if (got) tally.set(got.id, (tally.get(got.id) ?? 0) + 1);
  }
  ok("every droppable set turns up", tally.size === 3, [...tally.keys()].sort().join(","));
  ok("and they turn up equally often",
     [...tally.values()].every((n) => Math.abs(n / N - 1 / 3) < 0.001),
     [...tally.entries()].sort().map(([k, n]) => `${k} ${((n / N) * 100).toFixed(1)}%`).join("  "));

  /* The two ends of the second random number. Both of these would be an
     undefined set reaching the game as a cube with no texture. */
  ok("the very top of the range is the last set, not nothing",
     rollNfdDrop(three, 100, 0, 0.9999999)?.id === "c");
  ok("a random number of exactly one is still a real set",
     rollNfdDrop(three, 100, 0, 1)?.id === "c");
  ok("a nonsense second number is still a real set",
     rollNfdDrop(three, 100, 0, NaN)?.id === "a");

  /* ⚠ A DROP CARRIES NO TIER, AND THAT IS THE WHOLE DESIGN. Geoff chose
     "rolled at reveal, blind". If this object ever grew a tier, the tier
     would be decided here, on this machine, by this random number, instead of
     provably-fairly from a future block. */
  const got = rollNfdDrop(one, 100, 0, 0);
  ok("what dropped is a sealed pack with no tier in it",
     got !== null && Object.keys(got).sort().join(",") === "chainId,id,name,packagedArt",
     got ? Object.keys(got).sort().join(",") : "null");

  /* The killer's own bonus is opt-in. Owning NFDs making NFDs likelier is a
     design decision, not a default. */
  ok("the killer's drop bonus is not applied unless asked for",
     rollNfdDrop(one, 10, 0.12, 0) === null && rollNfdDrop(one, 10, 0.12, 0, 1.3) !== null);
}

console.log(out.join("\n"));
const checks = out.filter((l) => l.startsWith("PASS") || l.startsWith("FAIL")).length;
console.log(`\n${checks - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
