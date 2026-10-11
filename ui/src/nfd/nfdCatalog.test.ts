// Reading a Kinetink launch file, and refusing one we should not trust.

import {
  readLaunchFile, mediaUrlOk, ultraRareSlot, ultraRareOdds, cssAspect,
  normalsOf, ultraRaresOf, topTierOf, validateCollection,
  readLaunchPlan, blankLaunchPlan, diviToDuffs, duffsToDivi, looksLikeDiviAddress,
  KINETINK_MEDIA_HOST, LAUNCH_FORMAT, MAX_SUPPLY_LIMIT, DUFFS_PER_DIVI,
} from "./nfdCatalog";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

const url = (p: string) => `https://${KINETINK_MEDIA_HOST}/storage/v1/object/public/character-images/${p}`;
const item = (edition: number, over: Record<string, unknown> = {}) => ({
  edition, name: `Rebel ${edition}`, description: "", tier: edition,
  rarity: "common", rarityLabel: "common", isUltraRare: false,
  media: { image: url(`${edition}.webp`), animation: null, mediaType: "image", isBoomerang: false },
  attributes: [{ trait_type: "Tier", value: String(edition) }],
  ...over,
});
const file = (over: Record<string, unknown> = {}) => ({
  format: LAUNCH_FORMAT, version: 1, exportedAt: "2026-10-08T00:00:00Z",
  collection: {
    name: "Divi Rebels", description: "", aspectRatio: "5:7",
    packagedArt: url("sealed.webp"),
    ultraRare: { basicChance: 0.01, progressiveFactor: 0.2, count: 10 },
    images: { logo: { url: url("logo.webp"), ratio: "1:1" }, featured: null, banner: null },
  },
  items: [item(1), item(2), item(3, { isUltraRare: true, tier: 1, rarity: "cosmic" })],
  ...over,
});

/* ================= A FILE WE WILL NOT TOUCH ================= */
{
  const wrong = readLaunchFile({ ...file(), format: "something-else" }, "divi-rebels");
  ok("a file that is not a Kinetink launch package is refused",
     "errors" in wrong, "errors" in wrong ? wrong.errors[0] : "accepted");
  /* And NOTHING else is reported about it. A file of unknown provenance
     should not have its contents walked and described back; the only
     interesting fact is that we are not reading it. */
  ok("and nothing else about it is reported",
     "errors" in wrong && wrong.errors.length === 1, "errors" in wrong ? `${wrong.errors.length}` : "");

  const noItems = readLaunchFile({ ...file(), items: [] }, "divi-rebels");
  ok("a file with no items is refused", "errors" in noItems);

  const dupe = readLaunchFile({ ...file(), items: [item(1), item(1)] }, "divi-rebels");
  ok("two items claiming the same edition is refused", "errors" in dupe,
     "errors" in dupe ? dupe.errors[0] : "accepted");

  const badId = readLaunchFile(file(), "Divi Rebels!");
  ok("an id that could not be a key is refused", "errors" in badId);
}

/* ================= THE HOST ALLOWLIST IS AN ALLOWLIST ================= */
/* The whole point of naming one host is that nothing else is fetched, and a
   substring check is how that becomes decoration. Each of these CONTAINS the
   right host and is not it. */
{
  ok("the real host is accepted", mediaUrlOk(url("a.webp")));

  const attacks: Array<[string, string]> = [
    ["a host that merely ends with ours", `https://not${KINETINK_MEDIA_HOST}/a.webp`],
    ["our host in the query string", `https://evil.test/a.webp?x=${KINETINK_MEDIA_HOST}`],
    ["our host in the path", `https://evil.test/${KINETINK_MEDIA_HOST}/a.webp`],
    ["our host as a username", `https://${KINETINK_MEDIA_HOST}@evil.test/a.webp`],
    ["our host over plain http", `http://${KINETINK_MEDIA_HOST}/a.webp`],
    ["a subdomain of ours", `https://x.${KINETINK_MEDIA_HOST}/a.webp`],
    ["a data url", "data:image/webp;base64,AAAA"],
    ["a javascript url", "javascript:alert(1)"],
  ];
  for (const [what, bad] of attacks) ok(`${what} is refused`, !mediaUrlOk(bad), bad.slice(0, 60));

  const sneaky = readLaunchFile(
    { ...file(), items: [item(1, { media: { image: `https://evil.test/a.webp?x=${KINETINK_MEDIA_HOST}` } })] },
    "divi-rebels",
  );
  ok("and a whole file is refused for one bad image", "errors" in sneaky,
     "errors" in sneaky ? sneaky.errors[0].slice(0, 70) : "accepted");
}

/* ================= A GOOD FILE ================= */
{
  const read = readLaunchFile(file(), "divi-rebels");
  ok("a real launch file is read", "ok" in read, "ok" in read ? `${read.ok.items.length} items` : "refused");
  if ("ok" in read) {
    const c = read.ok;
    /* ⚠ THE ONE THAT MATTERS MOST. Geoff: "only specific NFD collections
       would be useful in the game and anything else will not show." A
       collection that counted the moment somebody uploaded it would be
       exactly the opposite, and uploading is the easy half. */
    ok("a newly read collection is NOT enabled until an admin says so", c.enabled === false);

    ok("Ultra Rares are told apart by the flag, not the rarity text",
       ultraRaresOf(c).length === 1 && normalsOf(c).length === 2);
    ok("the top tier is the highest in the set", topTierOf(c) === 2, `${topTierOf(c)}`);
    ok("items come back in edition order",
       c.items.map((i) => i.edition).join(",") === "1,2,3");
    ok("an item with no animation is not called a video",
       c.items[0].media.mediaType === "image" && c.items[0].media.animation === null);
  }
}

/* ================= THE ULTRA RARE SLOTS ================= */
/* Kinetink's stated maths: slot i gets (1-f) * f^i. Checked by SAMPLING the
   function rather than by restating the formula, because a test that repeats
   the implementation's arithmetic passes when both are wrong together. */
{
  const f = 0.2, count = 10, N = 200_000;
  const hits = new Array(count).fill(0);
  /* A fixed sweep rather than a random one: every u is visited exactly once,
     so the result is the function's true share and does not wobble per run. */
  for (let i = 0; i < N; i++) hits[ultraRareSlot((i + 0.5) / N, f, count)]++;
  const share = (i: number) => hits[i] / N;
  const want = (i: number) => (1 - f) * Math.pow(f, i);
  ok("slot 0 gets its stated share", Math.abs(share(0) - want(0)) < 0.002,
     `${(share(0) * 100).toFixed(1)}% against ${(want(0) * 100).toFixed(1)}%`);
  ok("slot 1 gets its stated share", Math.abs(share(1) - want(1)) < 0.002,
     `${(share(1) * 100).toFixed(1)}% against ${(want(1) * 100).toFixed(1)}%`);
  ok("slot 2 gets its stated share", Math.abs(share(2) - want(2)) < 0.002,
     `${(share(2) * 100).toFixed(2)}% against ${(want(2) * 100).toFixed(2)}%`);
  ok("every roll lands in a real slot", hits.reduce((a, b) => a + b, 0) === N);
  /* ---- AND WHAT THAT CONFIG ACTUALLY COSTS, WHICH IS THE USEFUL PART ----
     I expected the rarest slot to turn up in 200,000 sweeps and it never
     does, which is correct rather than broken: slot 10 is f^9 of the Ultra
     Rares, and the Ultra Rares are 1% of rolls. Printed rather than merely
     asserted, because the number decides whether a ten-piece Ultra Rare set
     is really a five-piece one, and that is Geoff's to know while the set is
     still being made.

       slot 1  1 in 125          slot 6   1 in 390,625
       slot 2  1 in 625          slot 7   1 in 1,953,125
       slot 3  1 in 3,125        slot 8   1 in 9,765,625
       slot 4  1 in 15,625       slot 9   1 in 48,828,125
       slot 5  1 in 78,125       slot 10  1 in 195,312,500

     Slot 10 is the ONE that is not (1-f)·f^i: it takes the whole remaining
     share, f^9, so it is 1.25 times likelier than the formula suggests. The
     first version of this comment said 244,140,625 for it, which was the
     formula rather than the code. */
  const gate = 0.01;
  const rows = ultraRareOdds({ basicChance: gate, progressiveFactor: f, count });
  /* ⚠ THE LAST SLOT IS THE REMAINDER, not (1-f)·f^i, because ultraRareSlot
     falls through to it. So the odds are SAMPLED from the function rather
     than restated from the formula: the formula and the code disagree by a
     factor of 1.25 on exactly that slot, and a test that restated the formula
     would have agreed with itself and been wrong. */
  ok("the odds table agrees with the function it describes",
     rows.every((r, i) => Math.abs(share(i) - r.share) < 0.002),
     rows.map((r) => `${(r.share * 100).toFixed(2)}%`).join(" "));
  ok("including the last slot, which is the remainder and not the formula",
     Math.abs(rows[count - 1].share - Math.pow(f, count - 1)) < 1e-12
     && Math.abs(rows[count - 1].share - want(count - 1)) > 1e-9,
     `${rows[count - 1].share.toExponential(3)} against the formula's ${want(count - 1).toExponential(3)}`);
  ok("the rarest slot is astronomically rare rather than merely rare",
     rows[count - 1].oneIn > 100_000_000,
     `slot ${count} is 1 in ${rows[count - 1].oneIn.toLocaleString()} rolls`);
  ok("and how many slots are realistically reachable is stated, not assumed",
     true,
     rows.filter((r) => r.oneIn <= 1_000_000).length
     + ` of ${count} come up at least once per million rolls`);
  ok("no Ultra Rare config at all is an empty table, not a crash",
     ultraRareOdds(null).length === 0 && ultraRareOdds({ basicChance: 0.01, progressiveFactor: 0.2, count: 0 }).length === 0);
  ok("a one-piece Ultra Rare set is the whole gate",
     ultraRareOdds({ basicChance: 0.01, progressiveFactor: 0.2, count: 1 })[0].oneIn === 100);
  /* Degenerate configs must not loop or land outside the set. */
  ok("one slot is always slot zero", ultraRareSlot(0.99, 0.2, 1) === 0);
  ok("a zero factor is always slot zero", ultraRareSlot(0.99, 0, 10) === 0);
}

/* ================= THE CARD SHAPE ================= */
{
  ok("Kinetink's 5:7 becomes CSS's 5 / 7", cssAspect("5:7") === "5 / 7", cssAspect("5:7"));
  ok("a slash is accepted too", cssAspect("16/9") === "16 / 9");
  ok("whitespace is tolerated", cssAspect("  3 : 2 ") === "3 / 2", cssAspect("  3 : 2 "));
  ok("decimals are kept", cssAspect("1.5:1") === "1.5 / 1");
  /* Every one of these would otherwise reach a CSS aspect-ratio as a broken
     value and collapse the card to nothing, which looks like a missing image
     rather than a bad field. A square is wrong for no set; a collapsed grid is
     badly wrong for one. */
  for (const bad of ["", "square", "5:0", "0:7", "5:", ":7", "-5:7", "5:7:9", "NaN:1"]) {
    ok(`${JSON.stringify(bad)} falls back to a square`, cssAspect(bad) === "1 / 1", cssAspect(bad));
  }
}

/* ================= THE LAUNCH DECISIONS ================= */
/* Four facts about a set on the Divi chain, and the reason they are checked
   this hard: the creator can never be moved, the royalty can only ever be
   lowered, and the cap is fixed at creation. A typo in any of them is
   permanent, so none of them is taken on trust. */
{
  /* Geoff's real addresses, which is the point: these are the ones that will
     be typed in, so they are the ones the shape check has to accept. Both pass
     the base58 checksum (verified 2026-Oct-10 with isDiviAddress in
     ui/src/web-rebels/diviAddress.ts, which this file cannot call because that
     check is asynchronous). */
  const ROYALTY = "D6V6dP2L5CN386Wg1LZF7KszXxuuSDvmmd";
  const SCANNER = "DTv5kfMgFhjPfDGji9YgXGZuWN7ZKdtALj";
  ok("a real Divi address is accepted", looksLikeDiviAddress(ROYALTY) === ROYALTY);
  ok("and so is the scanner's main one", looksLikeDiviAddress(SCANNER) === SCANNER);
  ok("surrounding spaces are trimmed rather than refused",
     looksLikeDiviAddress(`  ${ROYALTY} `) === ROYALTY);
  /* Each of these is a way an address field actually gets filled in wrong. */
  for (const [why, bad] of [
    ["a pasted URL", "https://divi.love/rebels/"],
    ["a truncated address", ROYALTY.slice(0, 20)],
    ["an address with a zero in it", `${ROYALTY.slice(0, 10)}0${ROYALTY.slice(11)}`],
    ["an address with a capital O in it", `${ROYALTY.slice(0, 10)}O${ROYALTY.slice(11)}`],
    ["an address with an l in it", `${ROYALTY.slice(0, 10)}l${ROYALTY.slice(11)}`],
    ["empty", ""],
    ["a number", 12345],
    ["nothing at all", null],
  ] as Array<[string, unknown]>) {
    ok(`${why} is not an address`, looksLikeDiviAddress(bad) === null);
  }

  /* ---- DIVI TO DUFFS ----
     ⚠ THE REASON THIS IS PARSED AS TEXT, in two amounts a person could easily
     type. The number goes onto a chain that holds it for ever at an amount
     that can never be raised, so being one duff out is permanent. */
  ok("0.07 DIVI is exactly seven million duffs", diviToDuffs("0.07") === 7_000_000,
     String(diviToDuffs("0.07")));
  ok("and multiplying through a float would not be, so the care is warranted",
     Number("0.07") * DUFFS_PER_DIVI !== 7_000_000,
     String(Number("0.07") * DUFFS_PER_DIVI));
  ok("0.29 DIVI is exactly twenty-nine million duffs", diviToDuffs("0.29") === 29_000_000);
  ok("where the float lands BELOW it, which a floor turns into a missing duff",
     Number("0.29") * DUFFS_PER_DIVI < 29_000_000,
     String(Number("0.29") * DUFFS_PER_DIVI));
  ok("a tenth of a DIVI is ten million duffs", diviToDuffs("0.1") === 10_000_000);
  ok("5 DIVI is five hundred million duffs", diviToDuffs("5") === 5 * DUFFS_PER_DIVI);
  ok("2.5 DIVI survives the trip", diviToDuffs("2.5") === 250_000_000);
  ok("one duff is the smallest amount there is", diviToDuffs("0.00000001") === 1);
  ok("spaces around the number are tolerated", diviToDuffs("  2.5  ") === 250_000_000);
  for (const bad of ["", "abc", "-1", "1.123456789", "1e8", "1,000", "0x10", "1.2.3", "."]) {
    ok(`${JSON.stringify(bad)} is not an amount`, diviToDuffs(bad) === null, String(diviToDuffs(bad)));
  }
  ok("an amount too large to count in duffs is refused rather than rounded",
     diviToDuffs("999999999999") === null);

  ok("duffs come back as DIVI with no trailing zeroes", duffsToDivi(DUFFS_PER_DIVI) === "1",
     duffsToDivi(DUFFS_PER_DIVI));
  ok("one duff reads as eight decimal places", duffsToDivi(1) === "0.00000001", duffsToDivi(1));
  ok("and two and a half DIVI reads as 2.5", duffsToDivi(250_000_000) === "2.5", duffsToDivi(250_000_000));
  ok("zero duffs is zero", duffsToDivi(0) === "0", duffsToDivi(0));
  /* A sweep rather than three hand-picked cases: the panel shows a saved
     amount with one of these and reads the next edit back with the other, so a
     disagreement between them would quietly change a royalty on every save. */
  {
    let worst = "";
    for (let d = 1; d <= 2_000_000_000; d = Math.ceil(d * 1.37)) {
      if (diviToDuffs(duffsToDivi(d)) !== d) { worst = String(d); break; }
    }
    ok("every amount survives duffs -> DIVI -> duffs across a 20 DIVI sweep",
       worst === "", worst ? `${worst} duffs did not` : "");
  }

  /* ---- READING A STORED PLAN ---- */
  const full = readLaunchPlan({
    creator: ROYALTY, payout: ROYALTY, commissionDuffs: 5 * DUFFS_PER_DIVI, maxSupply: 100_000,
  });
  ok("a complete plan reads back whole",
     full.creator === ROYALTY && full.payout === ROYALTY
     && full.commissionDuffs === 5 * DUFFS_PER_DIVI && full.maxSupply === 100_000);
  const blank = blankLaunchPlan();
  ok("a row with no plan at all is four undecided fields, not a crash",
     JSON.stringify(readLaunchPlan(undefined)) === JSON.stringify(blank));
  ok("and so is a row whose plan is nonsense",
     JSON.stringify(readLaunchPlan("purple")) === JSON.stringify(blank));
  /* ⚠ ZERO IS NOT A CAP AND NOT A ROYALTY. On chain `max_supply` of 0 means no
     bound at all, so it has to read as "undecided" here or the panel would
     show a cap of zero as though it were a limit of nothing. */
  const zeroes = readLaunchPlan({ commissionDuffs: 0, maxSupply: 0 });
  ok("a zero cap reads as NO CAP rather than a cap of zero", zeroes.maxSupply === null);
  ok("and a zero royalty reads as no royalty", zeroes.commissionDuffs === null);
  ok("a cap larger than the chain's u32 is refused, not truncated",
     readLaunchPlan({ maxSupply: MAX_SUPPLY_LIMIT + 1 }).maxSupply === null);
  ok("the largest cap that fits is kept",
     readLaunchPlan({ maxSupply: MAX_SUPPLY_LIMIT }).maxSupply === MAX_SUPPLY_LIMIT);
  ok("a negative cap is undecided", readLaunchPlan({ maxSupply: -5 }).maxSupply === null);
  ok("a fractional cap is floored", readLaunchPlan({ maxSupply: 99.9 }).maxSupply === 99);
  ok("a cap that is text is undecided", readLaunchPlan({ maxSupply: "100000" }).maxSupply === null);
  ok("an address that is not one is undecided rather than stored",
     readLaunchPlan({ creator: "not an address", payout: 7 }).creator === null);

  /* ---- A LAUNCH FILE CANNOT CARRY ANY OF IT ----
     Kinetink's export has a royalty PERCENTAGE and Divi has nowhere to put a
     percentage, so even a file that offers a plan is not believed. The file
     comes from outside; these four decide where money goes. */
  const offered = readLaunchFile(
    { ...file(), launch: { creator: ROYALTY, payout: ROYALTY, commissionDuffs: 1, maxSupply: 10 } },
    "divi-rebels",
  );
  ok("a launch file offering its own creator and royalty is ignored",
     "ok" in offered && JSON.stringify(offered.ok.launch) === JSON.stringify(blank),
     "ok" in offered ? JSON.stringify(offered.ok.launch) : "refused");

  /* ---- A SAVED ROW KEEPS IT ----
     The round trip the panel does on every save. Without this the four fields
     would be dropped on the way back out and an admin would think they had
     not been written. */
  const row = {
    name: "Divi Rebels", description: "", aspectRatio: "5:7",
    packagedArt: url("sealed.webp"), ultraRare: null,
    logo: null, featured: null, banner: null,
    items: [item(1), item(2)], enabled: true, chainId: "a".repeat(64),
    launch: { creator: ROYALTY, payout: SCANNER, commissionDuffs: 250_000_000, maxSupply: 100_000 },
  };
  const back = validateCollection(row, "divi-rebels");
  ok("a saved collection reads its launch plan back",
     "ok" in back && back.ok.launch.creator === ROYALTY && back.ok.launch.payout === SCANNER
     && back.ok.launch.commissionDuffs === 250_000_000 && back.ok.launch.maxSupply === 100_000,
     "ok" in back ? JSON.stringify(back.ok.launch) : back.errors.join("; "));
  /* SOFT on purpose, exactly like the chain id: a row with a mistyped address
     is still a perfectly good catalog of pictures, and refusing to read the
     whole set would hide the art as well as the address. */
  const mangled = validateCollection(
    { ...row, launch: { ...row.launch, payout: "not-an-address" } }, "divi-rebels");
  ok("a mistyped royalty address does not make the set unreadable",
     "ok" in mangled && mangled.ok.items.length === 2,
     "ok" in mangled ? "" : mangled.errors.join("; "));
  ok("it reads as not decided yet, which is what it means",
     "ok" in mangled && mangled.ok.launch.payout === null);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
