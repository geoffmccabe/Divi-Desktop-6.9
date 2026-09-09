// The armoury: what a gun costs, what has to be owned first, and what a beam
// actually hits.
//
// Run: sh scripts/run-rebels-weapons-tests.sh

export {};

import * as THREE from "three";
import { R } from "./orbitWorld";
import {
  WEAPONS, weaponByKey, weaponInSlot, tierOf, priceInDivi,
  USD_PER_POINT, BEAM_SECONDS, STARTING_WEAPONS,
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
      ok(`slot ${i + 1} is tier ${i + 1}`, tierOf(WEAPONS[i]) === i + 1, `${tierOf(WEAPONS[i])}`);
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

    /* ---- OWNERSHIP FOLLOWS THE HULL ----
       Nothing lets a player own two ships yet, but the plan is that they will
       and that a ship can be sold with its guns on it. */
    const other = "space_SM_Ship_Stealth_02";
    ok("another hull does not inherit the first one's guns",
       !A.hasWeapon(other, "mini"), A.owned(other).join(","));
    ok("but it does have its own pulse laser", A.hasWeapon(other, "pulse"));
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

  console.log(out.join("\n"));
  console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
