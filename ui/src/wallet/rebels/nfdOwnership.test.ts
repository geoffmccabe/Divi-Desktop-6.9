// Joining three answers into one, and never inventing a benefit.
// Run: sh scripts/run-rebels-nfdownership-tests.sh

import { readNfdOwnership, nfdWhyText } from "./nfdOwnership";
import { HEADLESS, setPlatform } from "./platform/current";
import { KINETINK_MEDIA_HOST } from "../../nfd/nfdCatalog";
import type { RebelsPlatform } from "./platform/platform";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const CHAIN = hex(0xaa);
const url = (p: string) => `https://${KINETINK_MEDIA_HOST}/storage/v1/object/public/character-images/${p}`;
const item = (edition: number, tier: number) => ({
  edition, name: `Rebel ${edition}`, description: "", tier,
  rarity: "common", rarityLabel: "common", isUltraRare: false,
  media: { image: url(`${edition}.webp`), animation: null, mediaType: "image", isBoomerang: false },
  attributes: [],
});
/** One row as the database returns it: the id beside the jsonb. */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "divi-rebels",
  enabled: true,
  collection: {
    name: "Divi Rebels", description: "", aspectRatio: "5:7",
    packagedArt: url("sealed.webp"), ultraRare: null,
    logo: null, featured: null, banner: null,
    items: [item(1, 1), item(2, 5), item(3, 20)],
    chainId: CHAIN,
    ...over,
  },
});
const chainRow = (over: Record<string, unknown> = {}) => ({
  id: hex(0x11), collectionId: CHAIN, mintHeight: 10, ...over,
});

/** A door with whatever answers this case needs. */
function door(over: {
  addresses?: Array<{ address: string; isMain: boolean }>;
  ownedNfds?: () => Promise<unknown>;
}): RebelsPlatform {
  return {
    ...HEADLESS,
    account: { ...HEADLESS.account, url: "https://db.test" },
    money: {
      ...HEADLESS.money,
      ownAddresses: () => Promise.resolve(over.addresses ?? []),
      ...(over.ownedNfds ? { ownedNfds: over.ownedNfds } : {}),
    },
  };
}

/** The database's answer to the collections read, and nothing else. */
function serveCollections(rows: unknown) {
  (globalThis as { fetch: unknown }).fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }))) as typeof fetch;
}

async function run() {
  /* ================= THE TWO SILENCES =================
     Telling a player in the desktop app to "open it in the desktop app" would
     be nonsense, and telling a browser player that we have a missing piece
     would be a lie. The two are told apart by whether the door has a wallet. */
  {
    serveCollections([dbRow()]);
    setPlatform(door({ addresses: [] }));
    const web = await readNfdOwnership();
    ok("a door with no wallet is told it has no wallet", web.why === "no-wallet", web.why);
    ok("and the sets that count are still listed", web.collections.length === 1);

    setPlatform(door({ addresses: [{ address: "DTest", isMain: true }] }));
    const app = await readNfdOwnership();
    ok("a door WITH a wallet and no chain reader says so instead",
       app.why === "not-wired", app.why);
    ok("neither invents a benefit", web.tier === 0 && app.tier === 0 && web.benefits.damageMult === 1);
  }

  /* ================= THE HOLDING ================= */
  {
    serveCollections([dbRow()]);
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.resolve({ nfds: [chainRow({ tier: 5 }), chainRow({ id: hex(0x12), tier: 20 })] }),
    }));
    const s = await readNfdOwnership();
    ok("a wallet holding two of a live set reports owning", s.why === "owned", s.why);
    ok("the best tier is the best of them, not the first", s.tier === 20, `${s.tier}`);
    ok("and it is worth one percent per tier",
       Math.abs(s.benefits.damageMult - 1.2) < 1e-9 && Math.abs(s.benefits.resistance - 0.2) < 1e-9,
       `${s.benefits.damageMult}`);
    ok("the best card is first in its group", s.groups[0].owned[0].tier === 20);
  }

  /* ================= WHAT A WALLET HOLDS THAT DOES NOT COUNT ================= */
  {
    serveCollections([dbRow()]);
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.resolve({ nfds: [chainRow({ collectionId: hex(0xbb), tier: 30 })] }),
    }));
    const s = await readNfdOwnership();
    ok("a holding from another collection counts for nothing", s.why === "none-owned", s.why);
    ok("and buys no damage at all", s.tier === 0 && s.benefits.damageMult === 1);
  }

  /* ================= EACH HALF FAILS ON ITS OWN ================= */
  {
    /* The database is unreachable; the chain is fine. There is nothing to
       match a holding against, so nothing counts, and the panel should not
       claim the wallet is empty. */
    (globalThis as { fetch: unknown }).fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.resolve({ nfds: [chainRow({ tier: 20 })] }),
    }));
    const noDb = await readNfdOwnership();
    ok("no database means no collection counts, and no benefit",
       noDb.why === "no-collections" && noDb.tier === 0, noDb.why);

    /* The chain reader throws. Nothing owned is KNOWN, which is not the same
       as owning nothing, and the player is told the difference. */
    serveCollections([dbRow()]);
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.reject(new Error("no node")),
    }));
    const noChain = await readNfdOwnership();
    ok("a chain reader that throws is reported, not read as empty",
       noChain.why === "no-chain", noChain.why);
    ok("and still earns nothing", noChain.tier === 0);

    /* Junk from the chain reader is not a crash either. */
    serveCollections([dbRow()]);
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.resolve("all of them"),
    }));
    const junk = await readNfdOwnership();
    ok("junk from the chain reads as owning none", junk.why === "none-owned", junk.why);
  }

  /* ================= A SET THAT WAS NEVER LAUNCHED ================= */
  {
    serveCollections([dbRow({ chainId: null })]);
    setPlatform(door({
      addresses: [{ address: "DTest", isMain: true }],
      ownedNfds: () => Promise.resolve({ nfds: [chainRow({ tier: 20 })] }),
    }));
    const s = await readNfdOwnership();
    ok("a set with no on-chain id matches nothing", s.why === "none-owned", s.why);
    ok("but is still listed as a set that counts", s.collections.length === 1);
  }

  /* ================= EVERY SILENCE HAS WORDS ================= */
  {
    const whys = ["loading", "no-wallet", "not-wired", "no-chain", "none-owned", "no-collections"] as const;
    ok("every reason there is nothing to show has something to say",
       whys.every((w) => nfdWhyText(w, 1).length > 20), whys.map((w) => nfdWhyText(w, 1).length).join(","));
    ok("and owning something says nothing at all", nfdWhyText("owned", 1) === "");
    ok("one set is not called 1 sets", !nfdWhyText("none-owned", 1).includes("1 sets"),
       nfdWhyText("none-owned", 1));
    ok("and three sets are counted", nfdWhyText("none-owned", 3).includes("3 sets"));
  }

  console.log(out.join("\n"));
  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void run();
