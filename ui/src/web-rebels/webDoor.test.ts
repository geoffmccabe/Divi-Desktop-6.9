// The web door: what Divi Rebels is told at divi.love/rebels.
//
// Run: sh scripts/run-rebels-web-tests.sh

import { isDiviAddress } from "./diviAddress";
import { towersFrom, loadTowers, SCANNER } from "./webNodes";
import { fetchWebPrices, forgetWebPrice } from "./webPrice";
import { guestName, guestId, restoreGuest } from "./pilot";
import { createWebDoor } from "./webDoor";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- the address check ---- */
{
  /* Real addresses from this repo: the Rebels treasury and the Scanner node. */
  const TREASURY = "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt";
  const SCANNER_WALLET = "DPGxoAGLi6wciUcf2R2tDi1GqbNYMSRvoz";
  ok("the treasury's address is a DIVI address", await isDiviAddress(TREASURY));
  ok("so is the Scanner's", await isDiviAddress(SCANNER_WALLET));
  ok("surrounding spaces are forgiven", await isDiviAddress(`  ${TREASURY} `));
  const typo = TREASURY.slice(0, 10) + (TREASURY[10] === "a" ? "b" : "a") + TREASURY.slice(11);
  ok("one mistyped character fails the checksum", !(await isDiviAddress(typo)), typo);
  ok("a letter base58 never uses is refused", !(await isDiviAddress(TREASURY.replace("t", "0"))));
  ok("a Bitcoin address is not a DIVI address", !(await isDiviAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")));
  ok("nor is nothing", !(await isDiviAddress("")));
}

/* ---- the towers ---- */
{
  const rows = [
    { ip: "10.0.0.1", lat: 40.7, lon: -74, city: "New York", country: "United States", lastSeen: 3 },
    { ip: SCANNER.ip, lat: 51.5, lon: -0.1, city: "London", lastSeen: 9 },
    { ip: "10.0.0.2", lat: 999, lon: 0, lastSeen: 8 },
    { ip: "10.0.0.3", lat: 1.35, lon: 103.8, city: "Singapore", lastSeen: 5 },
    { ip: "10.0.0.3", lat: 1.35, lon: 103.8, city: "Singapore", lastSeen: 5 },
  ];
  const t = towersFrom(rows);
  ok("home is the Scanner, first", t[0].ip === SCANNER.ip && t[0].kind === "self");
  ok("the Scanner appears once, not twice", t.filter((p) => p.ip === SCANNER.ip).length === 1);
  ok("a node with an impossible position is left out", !t.some((p) => p.ip === "10.0.0.2"));
  ok("a node listed twice is drawn once", t.filter((p) => p.ip === "10.0.0.3").length === 1);
  ok("the newest seen come first", t[1].ip === "10.0.0.3" && t[2].ip === "10.0.0.1", t.map((p) => p.ip).join(","));
  ok("longitude becomes the globe's lng", t[2].lng === -74);

  const many = Array.from({ length: 60 }, (_, i) => ({ ip: `10.1.0.${i}`, lat: 10, lon: i, lastSeen: 100 - i }));
  const m = towersFrom(many);
  ok("the 24 newest are the Scanner's peers", m.filter((p) => p.kind === "peer").length === 24);
  ok("the rest are the wider network", m.filter((p) => p.kind === "net").length === 36);
  ok("rubbish in is the Scanner alone, not a crash", towersFrom({ nope: 1 }).length === 1);

  const down = await loadTowers("/rebels/", (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
  ok("with the node list unreachable the game still opens from London", down.length === 1 && down[0].ip === SCANNER.ip);
  let asked = "";
  const good = await loadTowers("/rebels/", (async (u: string) => {
    asked = u;
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as unknown as typeof fetch);
  ok("the list is asked of our own server, under /rebels/", asked === "/rebels/api/nodes", asked);
  ok("and drawn", good.length === 3);
}

/* ---- the price ---- */
{
  forgetWebPrice();
  let url = "";
  const p = await fetchWebPrices((async (u: string) => {
    url = u;
    return new Response(JSON.stringify([{ close: 0.00418 }]), { status: 200 });
  }) as unknown as typeof fetch, 1000);
  ok("the price is the newest good close from the shared CoinMarketCap table",
     p.prices.usd === 0.00418 && url.includes("/rest/v1/divi_price") && url.includes("close=gt.0") && url.includes("order=ts.desc"), url);
  forgetWebPrice();
  const none = await fetchWebPrices((async () => new Response("[]", { status: 200 })) as unknown as typeof fetch, 1000);
  ok("no row is no price, never a made-up one", none.prices.usd === undefined);
  forgetWebPrice();
  const broken = await fetchWebPrices((async () => { throw new Error("down"); }) as unknown as typeof fetch, 1000);
  ok("a failure is no price, not an error", broken.prices.usd === undefined);
}

/* ---- the guest ---- */
{
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const first = guestName(storage, () => 0.5);
  /* Six digits now. Geoff: "we need far more than that." Four was nine
     thousand names, which two players in any hundred already share. */
  ok("a guest is Pilot and six digits", /^Pilot \d{6}$/.test(first), first);
  ok("and keeps that name on the next visit", guestName(storage, () => 0.9) === first);
  ok("without storage it is still a name", /^Pilot \d{6}$/.test(guestName(null)));
  /* ---- AND AN OLD FOUR-DIGIT NAME IS STILL THEIRS ----
     Anybody already playing has one. Refusing it would hand them a new
     identity and a fresh start, which is the very thing being fixed. */
  const held = new Map<string, string>([["rebels.web.pilot", "Pilot 7595"]]);
  const oldStore = {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { held.set(k, v); },
  };
  ok("an old four-digit pilot keeps their name",
     guestName(oldStore) === "Pilot 7595", guestName(oldStore));

  const id = guestId(storage);
  ok("a guest has a private id, long and plain", /^[A-Za-z0-9-]{16,64}$/.test(id), id);
  ok("which is the same on the next visit", guestId(storage) === id);

  /* The quick copy cleared, IndexedDB still holding the guest: the guest comes
     back, not a stranger with an empty purse. */
  const wiped = new Map<string, string>();
  const wipedStorage = { getItem: (k: string) => wiped.get(k) ?? null, setItem: (k: string, v: string) => { wiped.set(k, v); } };
  const back = await restoreGuest(wipedStorage, async () => new Map([["rebels.web.guest", id], ["rebels.web.pilot", first]]));
  ok("with localStorage cleared, IndexedDB brings the same guest back", back.id === id && back.name === first, JSON.stringify(back));
  const empty = new Map<string, string>();
  const fresh = await restoreGuest({ getItem: (k: string) => empty.get(k) ?? null, setItem: (k: string, v: string) => { empty.set(k, v); } }, async () => new Map());
  ok("with nothing kept anywhere, a new guest is made", /^[A-Za-z0-9-]{16,64}$/.test(fresh.id));

  const door = createWebDoor({ name: () => "Pilot 1234", guest: () => id });
  const join = door.identity.joinFields("");
  ok("the web door tells the room it is the web", join.door === "web" && join.name === "Pilot 1234", JSON.stringify(join));
  ok("and hands it the guest's private id", join.guest === id);
  ok("no wallet here: no addresses offered", (await door.money.ownAddresses()).length === 0);
  ok("no DIVI can be sent from the page, so points are bought in the app", door.money.PayWithDivi === null);
  ok("no staking wallet, so no stake bonus", door.wonStakeRecently() === false);
  ok("the address box checks addresses for real", await door.money.validateAddress("D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt"));
}

/* ---- A GUEST'S OWN FIGURES COME FROM THEIR DEVICE ----
   Geoff: "A user should be able to come back repeatedly and keep playing and
   accumulate in the game... with a separate account than their divi-node based
   account."

   The leaderboard is filed under the player's NAME, and pilot numbers repeat -
   even at six digits, two players in any thousand share one. So asking the
   network for a guest's OWN lifetime row was asking a question it cannot
   answer correctly: back came a stranger's totals, or, when nobody had
   submitted under that number yet, zeroes over a perfectly good local tally. */
{
  const kept = new Map<string, string>();
  const store = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => { kept.set(k, v); },
    removeItem: (k: string) => { kept.delete(k); },
  };
  const door = createWebDoor({
    storage: store,
    name: () => "Pilot 123456",
    guest: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });
  ok("a web guest's account is their device", door.identity.onDevice?.() === true);

  const { setPlatform } = await import("../wallet/rebels/platform/current");
  const scores = await import("../wallet/rebels/rebelsScores");
  setPlatform(door);

  /* A run, filed the way the game files one. */
  scores.recordScore(500, [0, 3, 0, 0, 0, 0, 0]);
  /* And a name-twin's row, which is what the network would hand back: the same
     pilot number, somebody else's numbers. Put straight into the device's own
     table under a DIFFERENT name so it cannot be mistaken for ours. */
  scores.recordScore(99999, [9, 9, 9, 9, 9, 9, 9], "Somebody Else");

  /* The network is not asked at all, so a fetch here would be a bug. If one
     goes out it throws, and the totals come back wrong or not at all. */
  const realFetch = globalThis.fetch;
  let asked = 0;
  (globalThis as { fetch: unknown }).fetch = (...a: unknown[]) => {
    asked++;
    return (realFetch as (...x: unknown[]) => Promise<Response>)(...a);
  };
  const mine = await scores.myTotals();
  (globalThis as { fetch: unknown }).fetch = realFetch;

  ok("their lifetime row is the one on this device", mine.total === 500 && mine.games === 1,
     `total ${mine.total} over ${mine.games} games`);
  ok("with the kills they actually made", mine.tierKills[1] === 3,
     `tier two: ${mine.tierKills[1]}`);
  ok("and a name-twin's numbers are not theirs", mine.total !== 99999, `${mine.total}`);
  ok("and the network was never asked for them", asked === 0, `${asked} calls`);

  /* ---- AND IT ACCUMULATES, which is the whole point ---- */
  scores.recordScore(250, [0, 2, 0, 0, 0, 0, 0]);
  const again = await scores.myTotals();
  ok("coming back and playing again adds to it",
     again.total === 750 && again.games === 2 && again.tierKills[1] === 5,
     `total ${again.total} over ${again.games} games, tier two ${again.tierKills[1]}`);
  ok("and the best single run is the best of them", again.best === 500, `${again.best}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
