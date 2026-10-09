// Reading what a player owns off the chain, and refusing to invent a tier.
// Run: sh scripts/run-rebels-nfdowned-tests.sh

import {
  readOwned, readOwnedRow, ownedByCollection, sortOwned, topTier, itemForOwned,
  type OwnedNfd,
} from "./nfdOwned";
import { KINETINK_MEDIA_HOST, type NfdCollection, type NfdItem } from "./nfdCatalog";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const CHAIN_A = hex(0xaa);
const CHAIN_B = hex(0xbb);

const url = (p: string) => `https://${KINETINK_MEDIA_HOST}/storage/v1/object/public/character-images/${p}`;
const item = (edition: number, tier: number, ultra = false): NfdItem => ({
  edition, name: `Rebel ${edition}`, description: "", tier,
  rarity: "common", rarityLabel: "common", isUltraRare: ultra,
  media: { image: url(`${edition}.webp`), animation: null, mediaType: "image", isBoomerang: false },
  attributes: [],
});
const collection = (over: Partial<NfdCollection> = {}): NfdCollection => ({
  id: "divi-rebels", name: "Divi Rebels", description: "", aspectRatio: "5:7",
  packagedArt: url("sealed.webp"), ultraRare: { basicChance: 0.01, progressiveFactor: 0.2, count: 3 },
  logo: null, featured: null, banner: null,
  items: [item(1, 1), item(2, 2), item(3, 3), item(10, 1, true), item(11, 2, true)],
  enabled: true, chainId: CHAIN_A,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: hex(0x11), owner: "1:abc", collectionId: CHAIN_A, mintHeight: 100,
  arweavePtr: hex(0x22), contentHash: hex(0x33), thumbPtr: null,
  ...over,
});

/* ================= A ROW WE CANNOT NAME ================= */
{
  ok("a row that is not an object is dropped", readOwnedRow(null) === null);
  ok("a row with no id is dropped", readOwnedRow(row({ id: undefined })) === null);
  ok("a row whose id is not 64 hex is dropped", readOwnedRow(row({ id: "abc" })) === null);
  ok("an id in capitals is accepted and lowered",
     readOwnedRow(row({ id: hex(0x11).toUpperCase() }))?.id === hex(0x11));
}

/* ================= THE MISSING FIELD, WHICH IS THE WHOLE POINT =================
   Today's scanner serves no reveal state at all. A row therefore arrives with
   no tier, and the ONLY safe reading of that is "earns nothing": a default of
   1 would hand out a damage bonus nobody owns. */
{
  const o = readOwnedRow(row())!;
  ok("a row with no reveal state has NO tier, rather than a tier of one",
     o.tier === null, `${o.tier}`);
  ok("and is treated as a sealed pack", o.sealed === true);
  ok("so it grants nothing", topTier([o]) === 0, `${topTier([o])}`);

  ok("a tier of zero is not a tier", readOwnedRow(row({ tier: 0 }))!.tier === null);
  ok("a tier that is text is not a tier", readOwnedRow(row({ tier: "7" }))!.tier === null);
  ok("a fractional tier is not a tier", readOwnedRow(row({ tier: 2.5 }))!.tier === null);
  ok("a negative tier is not a tier", readOwnedRow(row({ tier: -3 }))!.tier === null);
}

/* ================= THE TWO SHAPES A REVEAL MAY ARRIVE IN ================= */
{
  const flat = readOwnedRow(row({ tier: 7, ultraRare: 2 }))!;
  ok("a flat tier is read", flat.tier === 7 && flat.ultraRare === 2);
  ok("and a revealed collectible is not sealed", flat.sealed === false);

  const tuple = readOwnedRow(row({ revealed: [9, 3] }))!;
  ok("the Rust tuple shape is read too", tuple.tier === 9 && tuple.ultraRare === 3,
     `${tuple.tier}/${tuple.ultraRare}`);
  const noUr = readOwnedRow(row({ revealed: [4, null] }))!;
  ok("a reveal with no ultra rare is a plain tier", noUr.tier === 4 && noUr.ultraRare === null);

  /* A tier is a harder fact than a flag, so it wins. A row that said "sealed"
     AND carried a tier used to be impossible; it will not stay impossible once
     two sides of this grow independently. */
  const both = readOwnedRow(row({ tier: 5, sealed: true, revealPending: true }))!;
  ok("a row carrying a tier is not sealed, whatever its flag says",
     both.sealed === false && both.revealPending === false && both.tier === 5);

  const pending = readOwnedRow(row({ sealed: true, revealPending: true }))!;
  ok("a pack waiting for its block says so", pending.revealPending === true && pending.sealed === true);
  ok("an ultra rare slot without a tier is not kept",
     readOwnedRow(row({ ultraRare: 2 }))!.ultraRare === null);
}

/* ================= THE WHOLE ANSWER ================= */
{
  const list = readOwned({ nfds: [row({ id: hex(0x11) }), row({ id: hex(0x12) })], sync: {} });
  ok("the scanner's wrapper is unwrapped", list.length === 2, `${list.length}`);
  ok("a bare array is read too", readOwned([row()]).length === 1);

  /* Two rows for one collectible would count its tier twice in anything that
     sums, and a reorg replay is exactly how that happens. */
  const dupes = readOwned({ nfds: [row({ tier: 3 }), row({ tier: 3 })] });
  ok("the same collectible twice is counted once", dupes.length === 1, `${dupes.length}`);

  for (const junk of [null, undefined, 42, "nfds", {}, { nfds: "lots" }, { nfds: [null, 7] }]) {
    ok(`${JSON.stringify(junk)} reads as nothing owned, not a crash`, readOwned(junk).length === 0);
  }
}

/* ================= ONLY WHAT AN ENABLED COLLECTION CLAIMS =================
   Geoff: "only specific NFD collections would be useful in the game and
   anything else will not show." */
{
  const mine = readOwned({ nfds: [row({ tier: 2 })] });
  const other = readOwned({ nfds: [row({ id: hex(0x44), collectionId: CHAIN_B, tier: 30 })] });
  const loose = readOwned({ nfds: [row({ id: hex(0x55), collectionId: null, tier: 30 })] });

  const live = ownedByCollection([collection()], [...mine, ...other, ...loose]);
  ok("a holding from our set is shown", live.length === 1 && live[0].owned.length === 1);
  ok("and nothing else is, however high its tier", live[0].owned[0].tier === 2);

  const off = ownedByCollection([collection({ enabled: false })], mine);
  ok("a collection switched off shows nothing", off.length === 0);

  const unlaunched = ownedByCollection([collection({ chainId: null })], mine);
  ok("a collection with no chain id shows nothing", unlaunched.length === 0);

  /* An admin may type the chain id in capitals; the chain answers lowercase. */
  const shouty = ownedByCollection([collection({ chainId: CHAIN_A.toUpperCase() })], mine);
  ok("the chain id matches whatever case it was recorded in", shouty.length === 1);

  const none = ownedByCollection([collection()], []);
  ok("owning nothing is an empty answer, not a group with nothing in it", none.length === 0);
}

/* ================= BEST FIRST, AND THE BENEFIT COMES OFF THE SAME CARD =================
   The card at the top is the one the benefits come from, so "best" has to mean
   exactly what topTier means or the panel highlights one card and buffs from
   another. */
{
  const o = (over: Partial<OwnedNfd>): OwnedNfd => ({
    id: hex(0x11), chainCollection: CHAIN_A, sealed: false, revealPending: false,
    tier: 1, ultraRare: null, mintHeight: 1, ...over,
  });
  const sorted = sortOwned([
    o({ id: hex(0x01), tier: 3 }),
    o({ id: hex(0x02), tier: null }),
    o({ id: hex(0x03), tier: 12 }),
    o({ id: hex(0x04), tier: 12, ultraRare: 2 }),
    o({ id: hex(0x05), tier: 12, mintHeight: 9 }),
  ]);
  ok("the highest tier is first", sorted[0].tier === 12);
  ok("an ultra rare leads its plain twin", sorted[0].ultraRare === 2);
  ok("equal tiers go oldest first", sorted[1].mintHeight === 1 && sorted[2].mintHeight === 9,
     sorted.map((x) => x.mintHeight).join(","));
  ok("a sealed pack sinks to the bottom", sorted[sorted.length - 1].tier === null);
  ok("the top card is the one the benefit comes from",
     sorted[0].tier === topTier(sorted), `${sorted[0].tier} / ${topTier(sorted)}`);

  /* ⚠ An ultra rare slot is NOT a tier. Slot 3 of ten is rarer than anything,
     but the chain keeps a base tier for it too, and reading the slot as the
     tier would make it worth less than a plain tier 20. */
  ok("an ultra rare slot is never read as a tier",
     topTier([o({ tier: 2, ultraRare: 3 })]) === 2);
  ok("owning nothing is tier zero", topTier([]) === 0);
}

/* ================= WHICH PICTURE ================= */
{
  const c = collection();
  const o = (over: Partial<OwnedNfd>): OwnedNfd => ({
    id: hex(0x11), chainCollection: CHAIN_A, sealed: false, revealPending: false,
    tier: 2, ultraRare: null, mintHeight: 1, ...over,
  });
  ok("a plain collectible wears the item at its tier",
     itemForOwned(c, o({ tier: 3 }))?.edition === 3);
  ok("an ultra rare wears the ultra rare at its slot",
     itemForOwned(c, o({ tier: 1, ultraRare: 2 }))?.edition === 11,
     `${itemForOwned(c, o({ tier: 1, ultraRare: 2 }))?.edition}`);
  ok("a sealed pack has no picture of its own", itemForOwned(c, o({ tier: null })) === null);
  ok("a tier the set does not have has no picture",
     itemForOwned(c, o({ tier: 99 })) === null);
  ok("an ultra rare slot the set does not have has no picture",
     itemForOwned(c, o({ tier: 1, ultraRare: 9 })) === null);

  /* Several items at one tier: the chain says a tier, not which. The choice
     must be the same every time, for everyone, or a collectible changes face
     between two players looking at it. */
  const wide = collection({ items: [item(1, 5), item(2, 5), item(3, 5), item(4, 5)] });
  const picks = [hex(0x11), hex(0x12), hex(0x13), hex(0x14), hex(0x15)]
    .map((id) => itemForOwned(wide, o({ id, tier: 5 }))?.edition);
  ok("a tier with several items still picks one", picks.every((p) => p != null), picks.join(","));
  ok("and picks the SAME one every time for one collectible",
     [1, 2, 3].every(() => itemForOwned(wide, o({ tier: 5 }))?.edition === picks[0]));
  ok("while different collectibles can differ", new Set(picks).size > 1, `${new Set(picks).size} faces`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
