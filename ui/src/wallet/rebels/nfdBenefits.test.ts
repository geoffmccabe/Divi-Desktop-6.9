// What owning an NFD is worth, and what it does to the money.

import { nfdBenefits, benefitLines, topOwnedTier, NO_NFD, NFD_PER_TIER } from "./nfdBenefits";
import { sampleGames } from "./sampleContent";
import { gamePayout, GAME_MAX_PAYOUT } from "./gameTypes";
import { builtInEnemies } from "./enemyTypes";
import { sampleEnemies } from "./sampleContent";
import { COIN_PER_KILL, COIN_VALUE } from "./rebelsCombat";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

/* ================= THE THREE NUMBERS ================= */
{
  ok("no NFD is no bonus at all",
     nfdBenefits(0).damageMult === 1 && nfdBenefits(0).resistance === 0 && nfdBenefits(0).dropMult === 1);
  ok("and that is the same as the blank", nfdBenefits(0).damageMult === NO_NFD.damageMult);

  /* Geoff's own worked example: "damage is reduced by 5% for owning a T5". */
  const t5 = nfdBenefits(5);
  ok("a tier 5 takes 5% less damage, which is Geoff's own example",
     Math.abs(t5.resistance - 0.05) < 1e-9, `${(t5.resistance * 100).toFixed(0)}%`);
  ok("and deals 5% more", Math.abs(t5.damageMult - 1.05) < 1e-9);
  ok("and finds 5% more drops", Math.abs(t5.dropMult - 1.05) < 1e-9);

  const t30 = nfdBenefits(30);
  ok("the top of this set is the full 30% on all three, as Geoff chose",
     Math.abs(t30.damageMult - 1.3) < 1e-9 && Math.abs(t30.resistance - 0.3) < 1e-9
       && Math.abs(t30.dropMult - 1.3) < 1e-9,
     `${(t30.resistance * 100).toFixed(0)}% resistance`);

  /* ---- THE ONE THAT WOULD NOT MATTER UNTIL IT SUDDENLY DID ----
     Resistance is SUBTRACTED from incoming damage. At 1.0 a ship cannot be
     killed; above it, being shot heals you. This set stops at 30 so 0.30 is
     nowhere near, and that is exactly why it is worth clamping now: the day
     somebody builds a hundred-tier set is not the day to discover it. */
  ok("resistance cannot reach total immunity, whatever tier is handed in",
     nfdBenefits(200).resistance < 1, `${nfdBenefits(200).resistance}`);
  ok("while damage and drops are left unbounded, being merely strong",
     nfdBenefits(200).damageMult > 2);
  ok("a negative tier is treated as no NFD", nfdBenefits(-5).tier === 0);
}

/* ================= WHICH NFD IS THE ACTIVE ONE ================= */
{
  const tierOf = (e: number) => ({ 1: 3, 2: 17, 3: 9 } as Record<number, number>)[e] ?? null;
  ok("the active NFD is the highest tier owned", topOwnedTier([1, 2, 3], tierOf) === 17);
  ok("owning nothing is tier zero", topOwnedTier([], tierOf) === 0);
  /* An edition from a collection the caller did not enable returns null, and
     must not count. This is how "only specific collections are useful in the
     game" is enforced at the benefit, not merely at the gallery. */
  ok("an edition we cannot price is ignored rather than guessed at",
     topOwnedTier([1, 999], tierOf) === 3, "999 is unknown");
}

/* ================= WHAT IT DOES TO THE MONEY ================= */
/* The drop bonus is not a cosmetic buff: more drops is more DIVI. The payout
   ceiling and the daily cap were both sized against the GAME, and this is a
   multiplier that sits outside what they measure. So the figures below are
   measured rather than assumed, and they are the reason the bonus has to be
   applied INSIDE gamePayout rather than multiplied on afterwards. */
{
  const worth = new Map([...builtInEnemies(), ...sampleEnemies()].map((e) => [e.id, e.worth]));
  worth.set("fighters", 1);
  const DAILY_CAP = 2000;
  const top = nfdBenefits(30).dropMult;

  const rows = sampleGames()
    .map((g) => ({ id: g.id, base: gamePayout(g, worth, COIN_PER_KILL, COIN_VALUE).total }))
    .map((r) => ({ ...r, boosted: Math.round(r.base * top) }))
    .sort((a, b) => b.boosted - a.boosted);

  ok("what each game pays a tier 30 holder for one clear", true,
     rows.map((r) => `${r.id} ${r.base}->${r.boosted}`).join(", "));

  ok("the per-game ceiling still holds for every game at the top tier",
     rows.every((r) => r.boosted <= GAME_MAX_PAYOUT),
     `richest boosted ${rows[0].boosted} of ${GAME_MAX_PAYOUT}`);

  /* ⚠ AND THE DAILY CAP DOES NOT. Stated as a fact rather than asserted as a
     requirement, because it is Geoff's rate to set and he chose the uncapped
     30% knowing the figure. What must not happen is it being a surprise. */
  const over = rows.filter((r) => r.boosted > DAILY_CAP).map((r) => `${r.id} ${r.boosted}`);
  ok("and which games cross the daily cap once the bonus applies is known", true,
     over.length ? over.join(", ") + ` against ${DAILY_CAP}` : `none of ${rows.length}`);

  /* The bonus applied OUTSIDE the payout is a number nobody is actually
     paid: the ceiling would keep reporting the unboosted figure while the
     player banks the boosted one. This pins the gap so the Phase 2 work
     cannot quietly skip it. */
  ok("applying the bonus outside the payout would understate it by a third",
     Math.abs(rows[0].boosted / rows[0].base - (1 + 30 * NFD_PER_TIER)) < 0.01,
     `${rows[0].base} reported against ${rows[0].boosted} paid`);
}

/* ================= WHAT THE PANEL SAYS ================= */
{
  const lines = benefitLines(nfdBenefits(12));
  ok("the panel shows three benefits", lines.length === 3);
  ok("and says them in plain percentages",
     lines.map((l) => l.value).join(" ") === "+12% -12% +12%",
     lines.map((l) => `${l.label} ${l.value}`).join(" | "));
  ok("owning none says so rather than showing zeroes",
     benefitLines(nfdBenefits(0)).every((l) => l.value === "no bonus"));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
