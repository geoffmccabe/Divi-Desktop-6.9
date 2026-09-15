// Ships' own things, guests' limits, and where progress is kept.
//
// Run: sh scripts/run-rebels-fleet-tests.sh
//
// Geoff, 2026-Sep-13: progress kept for returning guests in IndexedDB; guests
// fly only the first ship and cannot change it; right-click an item, "Apply to
// Ship? (y/n)", and that ship keeps it for good; ships have names; YOU HAVE DIED.

export {};

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
(globalThis as Record<string, unknown>).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as Record<string, unknown>).Event = class { type: string; constructor(t: string) { this.type = t; } };

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

async function main() {
  const { setPlatform, HEADLESS } = await import("./platform/current");
  const F = await import("./shipFleet");
  const INV = await import("./rebelsInventory");
  const ARM = await import("./rebelsArmoury");
  const { loadShip, saveShip, DEFAULT_SHIP } = await import("./shipChoice");
  const { loadPaint, savePaint, FACTORY } = await import("./shipColours");
  const { createWebStorage, hydrateWebStorage } = await import("../../web-rebels/webStore");
  const { readFileSync } = await import("node:fs");

  const CRUISER = "space_SM_Ship_Cruiser_02";

  /* ---- fitting an upgrade to a ship ---- */
  setPlatform({ ...HEADLESS });
  store.clear();
  INV.addHeld("strafe2", 2);
  INV.addHeld("drone1", 1);
  ok("a strafe that is only HELD does nothing to the ship", !ARM.gearKeys(CRUISER).includes("strafe2"), ARM.gearKeys(CRUISER).join(","));
  ok("but a wingman works from the inventory, as before", ARM.gearKeys(CRUISER).includes("drone1"));
  ok("a strafe is a ship upgrade; a wingman is not", F.isShipUpgrade("strafe2") && F.isShipUpgrade("hull3") && F.isShipUpgrade("reargun") && !F.isShipUpgrade("drone1") && !F.isShipUpgrade("recharge"));

  const fit = F.applyToShip(CRUISER, "strafe2");
  ok("Apply to Ship: yes fits it", fit.ok, JSON.stringify(fit));
  ok("the item is used up, one of two", INV.heldCount("strafe2") === 1, `${INV.heldCount("strafe2")}`);
  ok("that ship now has it", ARM.gearKeys(CRUISER).includes("strafe2") && ARM.flightExtras(CRUISER).strafeMult === 2);
  ok("another ship does not", !ARM.gearKeys(DEFAULT_SHIP).includes("strafe2") && ARM.flightExtras(DEFAULT_SHIP).strafeMult === 1);
  const again = F.applyToShip(CRUISER, "strafe2");
  ok("the same upgrade twice on one ship is refused, and nothing is used", !again.ok && INV.heldCount("strafe2") === 1);
  ok("something not held cannot be fitted", !F.applyToShip(CRUISER, "hull5").ok);
  ok("something that is not an upgrade cannot be fitted", !F.applyToShip(CRUISER, "drone1").ok && INV.heldCount("drone1") === 1);
  ok("a used-up item cannot come back from an older account copy",
     !INV.mergeHeld({ strafe2: 2 }) && INV.heldCount("strafe2") === 1);

  /* ---- names ---- */
  ok("a ship can be named", F.setShipName(CRUISER, "  Night   Jar!  ").ok && F.shipName(CRUISER) === "Night Jar!", F.shipName(CRUISER));
  ok("a name is kept short and plain", F.setShipName(CRUISER, "<b>a very very very long ship name indeed</b>").ok && F.shipName(CRUISER).length <= F.SHIP_NAME_MAX && !F.shipName(CRUISER).includes("<"), F.shipName(CRUISER));
  ok("an empty name clears it", F.setShipName(CRUISER, "").ok && F.shipName(CRUISER) === "");
  ok("the player's name and the ship's are separate things", F.shipName(DEFAULT_SHIP) === "");

  /* ---- the account copy ---- */
  const moved = F.mergeFleet([{ model: CRUISER, name: "Nightjar", upgrades: ["hull2", "strafe2", "DROP TABLE"] }]);
  ok("the account's name fills in where this device has none", moved && F.shipName(CRUISER) === "Nightjar");
  ok("upgrades merge as a union, junk left out", F.shipUpgrades(CRUISER).sort().join(",") === "hull2,strafe2", F.shipUpgrades(CRUISER).join(","));
  F.setShipName(CRUISER, "Mine");
  F.mergeFleet([{ model: CRUISER, name: "Stale", upgrades: [] }]);
  ok("a stale copy neither renames the ship nor takes an upgrade away", F.shipName(CRUISER) === "Mine" && F.shipUpgrades(CRUISER).length === 2);

  /* ---- a guest ---- */
  saveShip(CRUISER);
  savePaint({ ...FACTORY, hull1: { hue: 10, sat: 1, bright: 1, overlay: "none" } });
  setPlatform({ ...HEADLESS, id: "test-guest", limits: { customiseShips: false, why: "Sign up to change your ship." } });
  ok("a guest flies the first ship whatever was saved", loadShip() === DEFAULT_SHIP);
  ok("in the factory paint", JSON.stringify(loadPaint()) === JSON.stringify(FACTORY));
  saveShip(CRUISER);
  ok("and cannot choose another", loadShip() === DEFAULT_SHIP);
  INV.addHeld("hull1", 1);
  const guestFit = F.applyToShip(DEFAULT_SHIP, "hull1");
  ok("cannot fit an upgrade, and is told why", !guestFit.ok && /sign up/i.test(guestFit.ok ? "" : guestFit.why));
  ok("and keeps the item for when they sign up", INV.heldCount("hull1") === 1);
  ok("cannot name the ship", !F.setShipName(DEFAULT_SHIP, "Mine").ok);
  setPlatform({ ...HEADLESS });
  ok("with the limit lifted, the saved ship and paint are all still there", loadShip() === CRUISER && loadPaint().hull1.hue === 10);

  /* ---- progress kept through the door, in IndexedDB on the web ---- */
  const written: Array<[string, string | null]> = [];
  const quick = new Map<string, string>();
  const quickStore = {
    getItem: (k: string) => quick.get(k) ?? null, setItem: (k: string, v: string) => { quick.set(k, v); },
    removeItem: (k: string) => { quick.delete(k); }, key: (i: number) => [...quick.keys()][i] ?? null,
    get length() { return quick.size; },
  };
  const web = createWebStorage(new Map([["dd69.rebels.points", JSON.stringify({ earned: 500, spent: 0 })]]), quickStore, (k, v) => { written.push([k, v]); });
  setPlatform({ ...HEADLESS, id: "test-web", storage: web });
  ok("a returning guest's points come from IndexedDB", ARM.spendable() === 500, `${ARM.spendable()}`);
  INV.addHeld("vstrafe1", 1);
  ok("a new item is written to IndexedDB", written.some(([k, v]) => k === "dd69.rebels.items" && !!v && v.includes("vstrafe1")));
  ok("and to the second copy", (quick.get("dd69.rebels.items") ?? "").includes("vstrafe1"));
  ok("nothing of it went to the app's localStorage", !(store.get("dd69.rebels.items") ?? "").includes("vstrafe1"));

  quick.clear(); written.length = 0;
  quick.set("dd69.rebels.divi", "12.5000");
  quick.set("dd69.music", "cache");
  const hydrated = await hydrateWebStorage(quickStore, async () => new Map([["dd69.rebels.points", JSON.stringify({ earned: 900, spent: 100 })]]), (k, v) => { written.push([k, v]); });
  ok("hydrating reads IndexedDB", hydrated.getItem("dd69.rebels.points")?.includes("900") === true);
  ok("and saves into IndexedDB progress only the second copy still had", hydrated.getItem("dd69.rebels.divi") === "12.5000" && written.some(([k]) => k === "dd69.rebels.divi"));
  ok("but not a cache that is not progress", !written.some(([k]) => k === "dd69.music"));

  /* ---- one store for "something changed" (rebelsSignals.ts) ---- */
  const SIG = await import("./rebelsSignals");
  setPlatform({ ...HEADLESS });
  let armoury = 0, ship = 0, after = 0;
  const offA = SIG.listen("armoury", () => { armoury++; });
  const offS = SIG.listen("ship", () => { ship++; });
  const offBad = SIG.listen("armoury", () => { throw new Error("a broken listener"); });
  const offAfter = SIG.listen("armoury", () => { after++; });
  INV.addHeld("hull4", 1);
  ok("finding an item is heard on the armoury signal", armoury === 1);
  ok("a listener that throws does not silence the ones after it", after === 1);
  F.applyToShip(CRUISER, "hull4");
  ok("fitting an upgrade is heard too", armoury >= 2);
  saveShip(DEFAULT_SHIP);
  ok("choosing a hull is heard on the ship signal, not the armoury's", ship === 1);
  offA(); offS(); offBad(); offAfter();
  ok("and stopping listening stops it", SIG.listenerCount("armoury") === 0 && SIG.listenerCount("ship") === 0);
  const heard = armoury;
  INV.addHeld("hull4", 1);
  ok("nothing is heard once nobody listens", armoury === heard, `${heard} -> ${armoury}`);

  /* ---- YOU HAVE DIED ---- */
  const hud = readFileSync(`${process.cwd()}/src/wallet/rebels/cockpit/overlays.tsx`, "utf8");
  ok("dying says YOU HAVE DIED, in the banner shown while dead", /hud\.dead (?:&&|\?) \(\s*<div className="orbit-died"[^>]*>YOU HAVE DIED<\/div>/.test(hud));

  console.log(out.join("\n"));
  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}
void main();
