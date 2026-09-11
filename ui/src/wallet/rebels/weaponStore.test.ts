// The armoury: what a gun costs, what has to be owned first, and what a beam
// actually hits.
//
// Run: sh scripts/run-rebels-weapons-tests.sh

export {};

import * as THREE from "three";
import { R } from "./orbitWorld";
import {
  WEAPONS, weaponByKey, weaponInSlot, upgradeLabel, priceInDivi,
  USD_PER_POINT, BEAM_SECONDS, STARTING_WEAPONS,
  BUY_TIERS, bonusFor, pointsForPurchase, TREASURY_ADDRESS,
} from "./weaponCatalog";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
process.on("uncaughtException", (e) => {
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

/* localStorage, which the armoury and the combat file both want. */
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};
(globalThis as Record<string, unknown>).window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
(globalThis as Record<string, unknown>).Event = class { constructor(public type: string) {} };

async function main() {
  const A = await import("./rebelsArmoury");
  const C = await import("./rebelsCombat");

  /* ------------------------------------------------ the catalogue itself */
  {
    ok("six slots", WEAPONS.length === 6, `${WEAPONS.length}`);
    ok("numbered one to six",
       WEAPONS.map((w) => w.slot).join(",") === "1,2,3,4,5,6",
       WEAPONS.map((w) => w.slot).join(","));

    /* Geoff's prices, exactly. */
    const want: Array<[number, number]> = [[1, 0], [2, 1000], [3, 4000], [4, 15000], [5, 50000], [6, 200000]];
    for (const [slot, points] of want) {
      const w = weaponInSlot(slot)!;
      ok(`slot ${slot} costs ${points} points`, w.points === points, `${w.points}`);
    }

    /* One line, each needing the last, which is what lets the store say
       "Tier N Upgrade" and mean it. */
    ok("only the first comes free", STARTING_WEAPONS.length === 1 && STARTING_WEAPONS[0] === "pulse",
       STARTING_WEAPONS.join(","));
    for (let i = 1; i < WEAPONS.length; i++) {
      ok(`slot ${i + 1} needs the one before it`, WEAPONS[i].needs === WEAPONS[i - 1].key,
         `${WEAPONS[i].needs}`);

    }
  }

  /* ------------------------------------------------------- the beam tiers */
  {
    const beams = WEAPONS.filter((w) => w.kind === "beam");
    ok("four beam tiers", beams.length === 4, `${beams.length}`);
    /* 130, 160, 190, 220 percent. */
    const dmg = beams.map((b) => Math.round(b.damage * 100));
    ok("damage is 130, 160, 190, 220", dmg.join(",") === "130,160,190,220", dmg.join(","));
    /* Two to five degrees, as asked, not two percent of a sphere. */
    const cones = beams.map((b) => b.cone);
    ok("cones are 2, 3, 4 and 5 degrees", cones.join(",") === "2,3,4,5", cones.join(","));
    /* Twenty percent further each tier above the first. */
    const reach = beams.map((b) => Math.round((b.reach! / beams[0].reach!) * 100));
    ok("each tier reaches 20% further", reach.join(",") === "100,120,140,160", reach.join(","));
    ok("yellow, green, blue, purple",
       beams.map((b) => b.colour!.toString(16)).join(",") === "ffd83a,5cf05c,54a8ff,b46bff",
       beams.map((b) => b.colour!.toString(16)).join(","));
    ok("and it stays on for half a second", BEAM_SECONDS === 0.5, `${BEAM_SECONDS}`);

    /* ---- TIERS COUNT WITHIN A KIND ----
       Geoff: "#3 is Tier 1. #4 is Tier 2 Upgrade etc." The store used to count
       steps along the whole line and called the first beam Tier 3, which read
       as though the pulse laser and the mini gun were lesser beams. */
    ok("the first beam is Tier 1, not Tier 3",
       upgradeLabel(beams[0]) === "Tier 1", upgradeLabel(beams[0]));
    ok("and the rest are upgrades of it",
       beams.slice(1).map((b) => upgradeLabel(b)).join(" / ")
       === "Tier 2 Upgrade / Tier 3 Upgrade / Tier 4 Upgrade",
       beams.slice(1).map((b) => upgradeLabel(b)).join(" / "));
  }

  /* ------------------------------------------------------ what it costs in DIVI */
  {
    /* Geoff: "1000 points for $1 if Divi price is $0.001". */
    ok("a thousand points is a dollar", USD_PER_POINT * 1000 === 1, `${USD_PER_POINT}`);
    ok("at a tenth of a cent, a point is a DIVI",
       Math.abs(priceInDivi(1000, 0.001)! - 1000) < 1e-9, `${priceInDivi(1000, 0.001)}`);
    /* "each point can be worth more if the value of Divi goes up" */
    ok("and ten times the price is a tenth of the DIVI",
       Math.abs(priceInDivi(1000, 0.01)! - 100) < 1e-9, `${priceInDivi(1000, 0.01)}`);

    /* NO PRICE MEANS NO NUMBER. The wallet's standing rule is that DIVI is
       priced from CoinMarketCap and from nothing else, and a store that
       invented a DIVI price would be asking somebody to spend real money
       against a figure this app made up. */
    for (const bad of [null, 0, -1, NaN, Infinity]) {
      ok(`no DIVI price from ${bad}`, priceInDivi(1000, bad as number) === null,
         String(priceInDivi(1000, bad as number)));
    }
  }

  /* --------------------------------------------------------- buying them */
  {
    A.resetArmouryForTests();
    const ship = "space_SM_Ship_Fighter_01";
    ok("a new ship carries only its pulse laser",
       A.owned(ship).join(",") === "pulse", A.owned(ship).join(","));
    ok("and nothing has been earned", A.spendable() === 0, `${A.spendable()}`);

    /* ---- ONE POINT PER DIVI ---- */
    A.earnPoints(600);
    ok("a DIVI brought home is a point", A.spendable() === 600, `${A.spendable()}`);
    /* Fractions survive: a coin is a fiftieth of a DIVI, and rounding each one
       to nothing would mean collecting two hundred of them earned nothing. */
    A.earnPoints(0.02);
    ok("and so is a fiftieth of one", Math.abs(A.spendable() - 600.02) < 1e-9, `${A.spendable()}`);

    /* Too poor. */
    let r = A.buyWithPoints(ship, "mini");
    ok("a gun you cannot afford is refused", !r.ok && r.why === "not enough points",
       JSON.stringify(r));

    A.earnPoints(500);
    r = A.buyWithPoints(ship, "mini");
    ok("and bought once you can", r.ok, JSON.stringify(r));
    ok("it is owned", A.hasWeapon(ship, "mini"));
    ok("and the points are gone", Math.abs(A.spendable() - 100.02) < 1e-9, `${A.spendable()}`);
    ok("but the earnings are not", Math.abs(A.purse().earned - 1100.02) < 1e-9,
       `${A.purse().earned}`);

    /* ---- THE LINE HAS TO BE WALKED ---- */
    A.earnPoints(1_000_000);
    r = A.buyWithPoints(ship, "beam2");
    ok("a tier cannot be skipped, however rich you are",
       !r.ok && (r.why ?? "").includes("Beam"), JSON.stringify(r));
    ok("and the store is told what is missing",
       (A.blockedBecause(ship, weaponByKey("beam2")!) ?? "").includes("needs"),
       String(A.blockedBecause(ship, weaponByKey("beam2")!)));

    ok("the one below it can be bought", A.buyWithPoints(ship, "beam1").ok);
    ok("and then the next one can", A.buyWithPoints(ship, "beam2").ok);

    /* ---- AND THE CHECKS ARE IN THE FUNCTION, NOT THE BUTTON ---- */
    const before = A.spendable();
    r = A.buyWithPoints(ship, "beam2");
    ok("buying the same gun twice is refused", !r.ok && r.why === "owned", JSON.stringify(r));
    ok("and costs nothing", A.spendable() === before, `${A.spendable()}`);
    ok("nor does a gun that does not exist", !A.buyWithPoints(ship, "deathray").ok);

    /* ---- OWNERSHIP IS THE PLAYER'S, ON EVERY HULL ----
       It followed the hull once. Geoff bought the minigun with Fighter 03 on
       the market screen, flew Fighter 05, and was told to go and buy it. */
    const other = "space_SM_Ship_Stealth_02";
    ok("another hull carries the same guns", A.hasWeapon(other, "mini"), A.owned(other).join(","));
    ok("and the pulse laser", A.hasWeapon(other, "pulse"));
    ok("asking with no hull at all is the same answer", A.hasWeapon("", "mini") && A.owned().includes("mini"));
  }

  /* ------------------------------------------------- what a beam actually hits */
  {
    const c = C.createCombat();
    const at = new THREE.Vector3(0, 0, R + 40);
    const fwd = new THREE.Vector3(1, 0, 0);
    const spec = weaponByKey("beam1")!;

    /* Straight ahead, well inside the reach. */
    const put = (x: number, off: number) => {
      const e = { ...blankEnemy(), pos: at.clone().addScaledVector(fwd, x).add(new THREE.Vector3(0, off, 0)) };
      c.enemies.push(e as never);
      return e;
    };
    put(30, 0);            /* dead ahead */
    put(60, 0);            /* further, still in reach */
    put(200, 0);           /* beyond the reach */
    put(30, 30);           /* well outside the cone */

    C.fireBeam(c, spec, at, fwd);
    const down = c.events.filter((e) => e.kind === "enemyHit").length;
    ok("a beam hits everything in the cone, not just the first",
       down === 2, `${down} hit of 4 placed`);
    ok("nothing beyond its reach", c.enemies.some((e) => e.pos.distanceTo(at) > 190));
    ok("and nothing outside the cone", c.enemies.some((e) => Math.abs(e.pos.y - at.y) > 20));

    ok("it is lit", c.beams.length === 1);
    ok("for half a second", Math.abs(c.beams[0].life - BEAM_SECONDS) < 1e-9, `${c.beams[0].life}`);
    ok("and in the tier's colour", c.beams[0].colour === spec.colour);
  }

  function blankEnemy() {
    return {
      pos: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0), roll: 0,
      cls: C.FIGHTER, shield: 100000, vel: new THREE.Vector3(), tumble: new THREE.Vector3(),
      spin: new THREE.Vector3(), flash: 0, ammo: 0, reload: 0, fireAt: 0,
      weave: 0, weaveDir: 1, mode: "in", breakAt: 0, rejoinAt: 0,
      escape: new THREE.Vector3(0, 0, 1), passFor: 0, wave: 0,
    };
  }


  /* ------------------------------------------------------------- the gear */
  {
    const I = await import("./itemCatalog");
    const F = await import("./orbitFlight");
    A.resetArmouryForTests();
    const ship = "space_SM_Ship_Fighter_01";

    ok("seven items: three torpedo, three magazine, the VIP pass", I.ITEMS.length === 7, `${I.ITEMS.length}`);
    ok("thirty seconds to respawn, ten with the pass", I.respawnSeconds([]) === 30 && I.respawnSeconds(["vip"]) === 10
       && I.RESPAWN_WAIT === 30 && I.RESPAWN_VIP === 10);
    ok("the pass is a plain purchase with nothing before it", I.ITEMS.find((x) => x.key === "vip")?.needs === null
       && I.ITEMS.find((x) => x.key === "vip")?.points === 5000);
    ok("three torpedo tiers and three magazines",
       I.ITEMS.filter((x) => x.kind === "torpedo").length === 3
       && I.ITEMS.filter((x) => x.kind === "mag").length === 3);
    /* Geoff's prices: a thousand, two, then four. */
    ok("priced 1000, 2000, 4000",
       I.ITEMS.filter((x) => x.kind === "torpedo").map((x) => x.points).join(",") === "1000,2000,4000"
       && I.ITEMS.filter((x) => x.kind === "mag").map((x) => x.points).join(",") === "1000,2000,4000");
    ok("magazines are +30, +60 and +90 percent",
       I.ITEMS.filter((x) => x.kind === "mag").map((x) => Math.round(x.amount * 100)).join(",") === "30,60,90");

    /* ---- TIERS REPLACE, THEY DO NOT STACK ----
       Someone who worked up from +1 to +3 has three extra tubes, not six.
       Reading the best owned rather than summing means an upgrade never has to
       remember to take the old one away. */
    ok("a fresh hull carries the standard load",
       I.torpedoBonus(A.owned(ship)) === 0 && I.magBonus(A.owned(ship)) === 0);

    A.earnPoints(100_000);
    ok("the first tier can be bought", A.buyWithPoints(ship, "torp1").ok);
    ok("and gives one more tube", I.torpedoBonus(A.owned(ship)) === 1);
    ok("the third cannot be skipped", !A.buyWithPoints(ship, "torp3").ok);
    ok("second bought", A.buyWithPoints(ship, "torp2").ok);
    ok("third bought", A.buyWithPoints(ship, "torp3").ok);
    ok("owning all three is three more, not six",
       I.torpedoBonus(A.owned(ship)) === 3, `${I.torpedoBonus(A.owned(ship))}`);

    A.buyWithPoints(ship, "mag1");
    A.buyWithPoints(ship, "mag2");
    ok("and two magazines is sixty percent, not ninety",
       Math.abs(I.magBonus(A.owned(ship)) - 0.6) < 1e-9, `${I.magBonus(A.owned(ship))}`);

    /* ---- AND THE SHIP ACTUALLY CARRIES IT ---- */
    const plain = F.createFlight(new THREE.Vector3(0, 0, R + 8));
    const kitted = F.createFlight(new THREE.Vector3(0, 0, R + 8), {
      torpedoes: I.torpedoBonus(A.owned(ship)), magazine: I.magBonus(A.owned(ship)),
          superMult: 2, strafeMult: 1,
    });
    ok("a kitted ship launches with more tubes",
       kitted.torpedoes === plain.torpedoes + 3, `${plain.torpedoes} -> ${kitted.torpedoes}`);
    ok("and a bigger magazine",
       kitted.ammo === Math.round(plain.ammo * 1.6), `${plain.ammo} -> ${kitted.ammo}`);

    /* Gear is the player's too. */
    ok("another hull has the same gear",
       I.torpedoBonus(A.owned("space_SM_Ship_Stealth_02")) === 3);
  }


  /* --------------------------------------------- turning DIVI into points */
  {
    const S = await import("./rebelsScores");
    A.resetArmouryForTests();
    /* Wipe the DIVI too, so this starts from nothing. */
    S.spendDivi(1e12);
    S.addDivi(500);
    ok("starts with five hundred DIVI and no points",
       S.totalDivi() === 500 && A.spendable() === 0);

    /* Geoff: "1000 points for $1 if Divi price is $0.001". */
    const r = A.convertDiviToPoints(200, 0.001);
    ok("at a tenth of a cent, a DIVI is a point", r.ok && Math.abs(r.points - 200) < 1e-9,
       JSON.stringify(r));
    ok("and the DIVI is gone", S.totalDivi() === 300, `${S.totalDivi()}`);
    ok("and the points are there", Math.abs(A.spendable() - 200) < 1e-9, `${A.spendable()}`);

    /* "each point can be worth more if the value of Divi goes up" */
    const r2 = A.convertDiviToPoints(100, 0.01);
    ok("at a cent, a DIVI is ten points", r2.ok && Math.abs(r2.points - 1000) < 1e-9,
       JSON.stringify(r2));

    /* ---- NEVER MORE THAN IS HELD ----
       Two hundred left. Asking for a thousand takes the two hundred and pays
       for exactly that, not for a thousand. */
    const r3 = A.convertDiviToPoints(1000, 0.001);
    ok("cannot convert more DIVI than is held",
       r3.ok && Math.abs(r3.divi - 200) < 1e-9 && Math.abs(r3.points - 200) < 1e-9,
       JSON.stringify(r3));
    ok("and the balance is now empty", S.totalDivi() === 0, `${S.totalDivi()}`);
    ok("so converting again does nothing",
       !A.convertDiviToPoints(10, 0.001).ok && A.spendable() === 200 + 1000 + 200);

    /* ---- NO PRICE, NO CONVERSION ----
       A rate this app made up would be someone's winnings valued at a number
       nobody agreed to. */
    S.addDivi(50);
    for (const bad of [null, 0, NaN, -1]) {
      const r4 = A.convertDiviToPoints(50, bad as number);
      ok(`no conversion at a price of ${bad}`, !r4.ok && S.totalDivi() === 50, JSON.stringify(r4));
    }
  }

  console.log(out.join("\n"));
  /* ------------------------------------------ buying points with real DIVI */
  {
    /* Geoff: "buttons for 1000, 2000, 5000, 10,000 DIVI ... a little discount
       of 2%, 5%, 10% if they spend more at once, they get extra points." */
    ok("four set amounts", BUY_TIERS.map((t) => t.divi).join(",") === "1000,2000,5000,10000",
       BUY_TIERS.map((t) => t.divi).join(","));
    ok("with bonuses of nothing, two, five and ten percent",
       BUY_TIERS.map((t) => t.bonus).join(",") === "0,0.02,0.05,0.1",
       BUY_TIERS.map((t) => t.bonus).join(","));
    ok("money goes to the treasury, a real DIVI address",
       /^D[1-9A-HJ-NP-Za-km-z]{33}$/.test(TREASURY_ADDRESS), TREASURY_ADDRESS);

    /* A typed amount earns whatever tier it clears. */
    ok("a custom 999 gets no bonus", bonusFor(999) === 0);
    ok("a custom 2000 gets two percent", bonusFor(2000) === 0.02);
    ok("a custom 4999 still gets two percent", bonusFor(4999) === 0.02);
    ok("a custom 7500 gets five percent", bonusFor(7500) === 0.05);
    ok("a custom million gets ten percent, no more", bonusFor(1_000_000) === 0.10);

    /* Bonus is EXTRA POINTS, not fewer DIVI. */
    ok("a thousand DIVI at a tenth of a cent is a thousand points",
       Math.abs(pointsForPurchase(1000, 0.001)! - 1000) < 1e-9, `${pointsForPurchase(1000, 0.001)}`);
    ok("ten thousand DIVI is eleven thousand points",
       Math.abs(pointsForPurchase(10000, 0.001)! - 11000) < 1e-9, `${pointsForPurchase(10000, 0.001)}`);
    ok("and the price moves the answer",
       Math.abs(pointsForPurchase(1000, 0.01)! - 10000) < 1e-9, `${pointsForPurchase(1000, 0.01)}`);
    for (const bad of [null, 0, -1, NaN, Infinity]) {
      ok(`no purchase quote without a DIVI price (${bad})`,
         pointsForPurchase(1000, bad as number) === null);
    }
    ok("no quote for nothing", pointsForPurchase(0, 0.001) === null);

    /* ---- credited ONCE per transaction ----
       The modal polls; every poll lands in creditPurchase. */
    A.resetArmouryForTests();
    ok("first report of a txid pays", A.creditPurchase("abc123", 1000, 1000) === true);
    ok("and the points are there", Math.abs(A.spendable() - 1000) < 1e-9, `${A.spendable()}`);
    ok("second report of the same txid pays nothing", A.creditPurchase("abc123", 1000, 1000) === false);
    ok("and the balance did not move", Math.abs(A.spendable() - 1000) < 1e-9, `${A.spendable()}`);
    ok("a different txid pays again", A.creditPurchase("def456", 2000, 2040) === true);
    ok("to three thousand and forty", Math.abs(A.spendable() - 3040) < 1e-9, `${A.spendable()}`);
    ok("the record keeps both", A.purchases().length === 2, `${A.purchases().length}`);
    ok("no txid, no points", A.creditPurchase("", 1000, 1000) === false);
    ok("no points, no record", A.creditPurchase("ghi789", 1000, 0) === false && A.purchases().length === 2);
    A.resetArmouryForTests();
    ok("reset wipes the record too", A.purchases().length === 0);
  }

  /* ------------------------------------ the old per-hull save, and the account */
  {
    /* Exactly what was on Geoff's machine: the minigun on Fighter 03, flying 05. */
    A.resetArmouryForTests();
    localStorage.setItem("dd69.rebels.owned", JSON.stringify({ space_SM_Ship_Fighter_03: ["mini"] }));
    ok("a gun bought on one hull is there on the one being flown",
       A.hasWeapon("space_SM_Ship_Fighter_05", "mini"), A.owned("space_SM_Ship_Fighter_05").join(","));
    ok("and the save is rewritten in the new shape",
       localStorage.getItem("dd69.rebels.owned") === JSON.stringify({ "*": ["mini"] }),
       localStorage.getItem("dd69.rebels.owned") ?? "");
    /* Two hulls with different gear: the player gets both. */
    localStorage.setItem("dd69.rebels.owned", JSON.stringify({ a: ["mini", "torp1"], b: ["beam1"] }));
    ok("several hulls fold into one set", A.owned().sort().join(",") === "beam1,mini,pulse,torp1", A.owned().sort().join(","));

    /* ---- merging the account's copy ----
       Counters only rise, sets only grow, so nothing stale can take anything. */
    A.resetArmouryForTests();
    A.earnPoints(500);
    A.buyWithPoints("x", "mini");          /* earned 500, spent 1000? no: mini costs 1000 */
    ok("(setup) not enough for the minigun yet", !A.hasWeapon("x", "mini"));
    const snap = A.loadoutSnapshot();
    ok("a snapshot carries the counters and the set", snap.earned === 500 && snap.spent === 0 && snap.owned.length === 0);

    ok("a richer remote copy raises the counters",
       A.mergeLoadout({ earned: 2000, spent: 1000, owned: ["mini"], purchases: [] })
       && A.purse().earned === 2000 && A.purse().spent === 1000, JSON.stringify(A.purse()));
    ok("and brings its guns", A.hasWeapon("x", "mini"));
    ok("a poorer remote copy changes nothing",
       !A.mergeLoadout({ earned: 100, spent: 50, owned: [], purchases: [] })
       && A.purse().earned === 2000 && A.purse().spent === 1000);
    ok("junk in the remote set is ignored", !A.mergeLoadout({ owned: ["deathray", 7 as never] }));
    ok("remote purchases arrive once", A.mergeLoadout({ purchases: [{ txid: "t1", divi: 1, points: 1, at: "" }] })
       && A.purchases().length === 1
       && !A.mergeLoadout({ purchases: [{ txid: "t1", divi: 1, points: 1, at: "" }] })
       && A.purchases().length === 1);
    ok("spendable is earned minus spent after a merge", A.spendable() === 1000, `${A.spendable()}`);
  }

  console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
