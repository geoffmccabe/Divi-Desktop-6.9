// Reading a Kinetink launch file, and refusing one we should not trust.

import {
  readLaunchFile, mediaUrlOk, ultraRareSlot, normalsOf, ultraRaresOf, topTierOf,
  KINETINK_MEDIA_HOST, LAUNCH_FORMAT,
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
       slot 5  1 in 78,125       slot 10  1 in 244,140,625  */
  const gate = 0.01;
  const oneIn = (i: number) => Math.round(1 / (gate * want(i)));
  ok("the rarest slot is astronomically rare rather than merely rare",
     oneIn(count - 1) > 100_000_000,
     `slot ${count} is 1 in ${oneIn(count - 1).toLocaleString()} rolls`);
  ok("and how many slots are realistically reachable is stated, not assumed",
     true,
     [...Array(count).keys()].filter((i) => oneIn(i) <= 1_000_000).length
     + ` of ${count} come up at least once per million rolls`);
  /* Degenerate configs must not loop or land outside the set. */
  ok("one slot is always slot zero", ultraRareSlot(0.99, 0.2, 1) === 0);
  ok("a zero factor is always slot zero", ultraRareSlot(0.99, 0, 10) === 0);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
