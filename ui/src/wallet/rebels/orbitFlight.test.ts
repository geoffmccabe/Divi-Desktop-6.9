// Flight model checks, run headless with no renderer and no DOM.
//
// The rendering can be judged by looking at it. The simulation cannot: "the
// ship moved" and "the ship moved in the right direction and stayed on its
// sphere" look identical in a screenshot, and a chase camera hides a nose that
// is slowly burying itself in the planet. So the maths is tested on its own.
//
// Run: sh scripts/run-orbit-tests.sh

import * as THREE from "three";
import { R, MIN_ALT, MAX_ALT } from "./orbitWorld";
import {
  createFlight, stepFlight, distanceToTower, CRUISE, MAX_AMMO, MAX_SHIELD,
  CRASH_DAMAGE, MAX_GUARDS,
  DOCK_SECONDS, type Stick,
} from "./orbitFlight";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const stick = (o: Partial<Stick> = {}): Stick =>
  ({ x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, guard: false, mini: false, ...o });

const DT = 1 / 60;
function run(f: ReturnType<typeof createFlight>, frames: number, s: Stick, tips: THREE.Vector3[] = [], home = -1) {
  let hits = 0, docks = 0, shots = 0;
  for (let i = 0; i < frames; i++) {
    const r = stepFlight(f, DT, s, tips, home);
    if (r.hit) hits++;
    if (r.docked) docks++;
    if (r.fired) shots++;
  }
  return { hits, docks, shots };
}

/* A launch pad well away from anything, so nothing else interferes. */
const pad = new THREE.Vector3(0, 0, R + 4.2);

// 1. Straight and level actually goes somewhere.
{
  const f = createFlight(pad);
  const start = f.pos.clone();
  run(f, 120, stick());
  const moved = start.distanceTo(f.pos);
  /* Two seconds at cruise is about 32 units of arc; a straight-line chord is a
     little less. Anything near zero means the ship is parked. */
  ok("flies forward at cruise", moved > 25 && moved < 34, `moved ${moved.toFixed(1)} units in 2s`);
}

// 2. It stays on its sphere. This is the one that silently rots.
{
  const f = createFlight(pad);
  run(f, 600, stick({ x: 0.6, y: 0.2 }));
  const radius = f.pos.length();
  ok("stays on the sphere", Math.abs(radius - (R + f.alt)) < 1e-3,
     `radius ${radius.toFixed(3)} vs expected ${(R + f.alt).toFixed(3)}`);
  const up = f.pos.clone().normalize();
  ok("heading stays tangent", Math.abs(f.fwd.dot(up)) < 1e-6, `dot ${f.fwd.dot(up).toExponential(1)}`);
  ok("heading stays unit length", Math.abs(f.fwd.length() - 1) < 1e-6);
}

// 3. Steering turns, and turning the other way turns the other way.
{
  const left = createFlight(pad);
  const right = createFlight(pad);
  const before = left.fwd.clone();
  run(left, 60, stick({ x: -1 }));
  run(right, 60, stick({ x: 1 }));
  const cross = new THREE.Vector3().crossVectors(before, left.fwd).dot(pad.clone().normalize());
  const crossR = new THREE.Vector3().crossVectors(before, right.fwd).dot(pad.clone().normalize());
  ok("stick left and stick right turn opposite ways", Math.sign(cross) === -Math.sign(crossR) && cross !== 0,
     `left ${cross.toFixed(3)} right ${crossR.toFixed(3)}`);
  ok("a full second of stick is a real turn", before.angleTo(left.fwd) > 0.8,
     `${before.angleTo(left.fwd).toFixed(2)} rad`);
}

// 4. Altitude is clamped at both ends.
{
  const f = createFlight(pad);
  run(f, 600, stick({ y: 1 }));
  ok("cannot climb out of the world", f.alt <= MAX_ALT + 1e-9, `alt ${f.alt.toFixed(2)}`);
  const g = createFlight(pad);
  run(g, 600, stick({ y: -1 }));
  ok("cannot fly under the surface", g.alt >= MIN_ALT - 1e-9, `alt ${g.alt.toFixed(2)}`);
  ok("flying into the planet costs shields, not the game", g.shields > 0 && g.shields < MAX_SHIELD,
     `shields ${g.shields}`);
  /* Grace has to stop one dive draining the whole shield at sixty frames a
     second: the ground is touched on every one of them. */
  ok("one dive costs one hit, not sixty", g.shields === MAX_SHIELD - CRASH_DAMAGE,
     `shields ${g.shields}`);
}

// 5. Boost is faster and runs out.
{
  const f = createFlight(pad);
  run(f, 60, stick({ boosting: true }));
  ok("boost accelerates", f.speed > CRUISE * 1.5, `speed ${f.speed.toFixed(1)}`);
  run(f, 60 * 8, stick({ boosting: true }));
  ok("boost runs dry", f.boost === 0, `boost ${f.boost.toFixed(2)}`);
  run(f, 120, stick({ boosting: true }));
  ok("dry boost falls back to cruise, never to a stop", Math.abs(f.speed - CRUISE) < 0.5,
     `speed ${f.speed.toFixed(1)}`);
}

// 6. Guns fire, cost ammo, and stop when empty. What comes OUT of them is the
//    combat module's business and is tested there.
{
  /** One pull of the trigger: press, hold a moment, release. */
  const pull = (f: ReturnType<typeof createFlight>) => {
    let shots = 0;
    for (let i = 0; i < 12; i++) if (stepFlight(f, DT, stick({ firing: true }), [], -1).fired) shots++;
    for (let i = 0; i < 8; i++) stepFlight(f, DT, stick(), [], -1);
    return shots;
  };
  const f = createFlight(pad);
  ok("one pull is one shot", pull(f) === 1, "and not a burst");
  ok("firing costs one round", f.ammo === MAX_AMMO - 1, `ammo ${f.ammo}`);

  /* Holding the trigger down must NOT keep firing: at nine a second the laser
     sample overlapped itself into a drone. */
  const held = run(f, 60 * 3, stick({ firing: true }));
  ok("holding the trigger does not empty the magazine", held.shots <= 1,
     `${held.shots} shots in three seconds of holding`);

  for (let i = 0; i < MAX_AMMO + 5; i++) pull(f);
  ok("ammo runs out and stays out", f.ammo === 0);
  ok("an empty gun does not fire", pull(f) === 0);
}

// 7. Docking at a tower repairs and rearms, but only when slow enough.
{
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  f.shields = 2; f.ammo = 5; f.boost = 0.1;
  let docked = 0;
  for (let i = 0; i < Math.ceil(DOCK_SECONDS * 60) + 90; i++) {
    f.pos.copy(tip).addScaledVector(tip.clone().normalize(), 3);
    const r = stepFlight(f, DT, stick(), [tip], 0);
    if (r.docked) docked++;
  }
  ok("docking repairs and rearms", f.shields === MAX_SHIELD && f.ammo === MAX_AMMO && f.boost === 1,
     `shields ${f.shields} ammo ${f.ammo} boost ${f.boost}`);
  ok("docking reports completing once", docked === 1, `${docked} times`);
}
{
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  f.shields = 2;
  for (let i = 0; i < 240; i++) {
    f.pos.copy(tip).addScaledVector(tip.clone().normalize(), 3);
    f.speed = 30;   /* screaming past, far too fast to dock */
    stepFlight(f, DT, stick(), [tip], 0);
  }
  ok("cannot dock at speed", f.shields === 2, `shields ${f.shields}`);
}

// 7b. There has to be a way to get slow enough to dock. Cruise is 16 and
//     docking needs under 9, and with no throttle lever the first version made
//     docking literally unreachable.
{
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  run(f, 120, stick());
  ok("the brake actually slows the ship", (run(f, 90, stick({ braking: true })), f.speed < 9),
     `speed ${f.speed.toFixed(1)}`);
}
{
  /* Loitering by a tower should ease the ship off on its own, so "fly home and
     rearm" needs no key at all. The ship is held in the approach each frame,
     because letting it fly on is a test of how long the zone is, not of
     whether the ease-off works. */
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  for (let i = 0; i < 90; i++) {
    f.pos.copy(tip).addScaledVector(tip.clone().normalize(), 3);
    stepFlight(f, DT, stick(), [tip], 0);
  }
  ok("a tower approach eases the ship off by itself", f.speed < 9, `speed ${f.speed.toFixed(1)}`);
  ok("and that is enough to actually dock", f.dock > 0, `dock ${f.dock.toFixed(2)}`);
}
{
  /* And flying straight at one, which is what a player actually does, has to
     bleed off enough speed during the pass to dock rather than sailing through.
     The ship starts a little way out and aims at the tower. */
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  /* Aim for a hold point beside the tower rather than the tower itself. Flying
     at the mast is how you clip it: the crash radius sits inside the dock zone,
     which is deliberate, so parking next to it is the actual manoeuvre. */
  const upAt = tip.clone().normalize();
  const beside = new THREE.Vector3(0, 1, 0).cross(upAt).normalize().multiplyScalar(3.6).add(tip);
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  let best = 0;
  for (let i = 0; i < 60 * 14; i++) {
    /* Steer toward the tower each frame: a crude autopilot standing in for a
       player who is aiming at the thing they want to dock with. */
    const toTower = beside.clone().sub(f.pos);
    const range = toTower.length();
    const up = f.pos.clone().normalize();
    toTower.addScaledVector(up, -toTower.dot(up));
    /* Braking on the run in, which is what the launch card tells the player to
       do and what makes the turn tight enough to come back round. */
    const braking = range < 30;
    /* Descending onto the tower, which is the other half of what a player
       does and what the first version of this autopilot left out: circling
       overhead at cruise altitude never gets close enough. */
    const wantAlt = 4.6;
    const climb = Math.max(-1, Math.min(1, (wantAlt - f.alt) * 0.6));
    if (toTower.lengthSq() > 1e-6) {
      toTower.normalize();
      const turn = Math.sign(new THREE.Vector3().crossVectors(f.fwd, toTower).dot(up));
      const off = f.fwd.angleTo(toTower);
      stepFlight(f, DT, stick({ x: off > 0.02 ? -turn * Math.min(1, off * 3) : 0, y: climb, braking }), [tip], 0);
    } else {
      stepFlight(f, DT, stick({ y: climb, braking }), [tip], 0);
    }
    best = Math.max(best, f.dock);
    if (best >= 1) break;
  }
  ok("flying to a tower and parking gets you docked", best >= 1,
     `best dock progress ${best.toFixed(2)}, shields ${f.shields}`);
}

// 8b1. The tower is a mast, not a dot on top of one.
//
//      Geoff, four times: "Running into my tower still doesn't happen."
//      The target used to be the point at the tip, so a player flying at the
//      tower they can SEE passed the only spot that counted.
{
  const tipDir = pad.clone().normalize();
  const tip = tipDir.clone().multiplyScalar(R + 6);
  /* Level with the middle of the mast, an arm's length to the side: that is
     flying into the tower by any reasonable reading. */
  const side = new THREE.Vector3(1, 0, 0).cross(tipDir).normalize();
  const beside = tipDir.clone().multiplyScalar(R + 3).addScaledVector(side, 2);
  ok("beside the middle of a tower counts as being at it",
     distanceToTower(beside, tip) < 3, `${distanceToTower(beside, tip).toFixed(1)} away`);
  ok("and the old measure to the tip alone did not",
     beside.distanceTo(tip) > 3, `tip was ${beside.distanceTo(tip).toFixed(1)} away`);
  ok("at the foot counts too",
     distanceToTower(tipDir.clone().multiplyScalar(R).addScaledVector(side, 1), tip) < 2);
  ok("and something genuinely far away still does not",
     distanceToTower(tipDir.clone().multiplyScalar(R + 3).addScaledVector(side, 40), tip) > 30);
}

// 8b2. Docking has to STOP the ship.
//
//      Geoff: "when he recharges he should stop flying during that time, and
//      it's not doing that now... it just keeps flying."
{
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
  /* These test DOCKING, not launching, so the grace that stops a ship
     re-docking the instant it leaves its own pad is cleared. */
  f.redock = 0;
  /* Flown in and held by the tower, which is what an arriving player does. */
  let docked = false;
  let movingWhileDocked = 0;
  let framesDocked = 0;
  for (let i = 0; i < 60 * 8; i++) {
    f.pos.copy(tip).addScaledVector(tip.clone().normalize(), 3);
    stepFlight(f, DT, stick(), [tip], 0);
    if (f.dock > 0) {
      docked = true;
      framesDocked++;
      /* Ignore the first few frames: coming to a stop is allowed to take a
         moment, it is being stopped for most of it that matters. */
      if (framesDocked > 12 && f.speed > 0.5) movingWhileDocked++;
    }
  }
  ok("docking happens at all", docked && f.guards === MAX_GUARDS);
  ok("and the ship is stopped for the whole resupply", movingWhileDocked === 0,
     `still moving on ${movingWhileDocked} of ${framesDocked} docked frames`);
}

// 8c2. The mini gun.
{
  const f = createFlight(pad);
  /** Hold the trigger for a while, then let go. */
  const hold = (seconds: number, o: Partial<Stick> = {}) => {
    let main = 0, mini = 0;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const r = stepFlight(f, DT, stick({ firing: true, ...o }), [], -1);
      if (r.fired) main++;
      if (r.miniFired) mini++;
    }
    for (let i = 0; i < 6; i++) stepFlight(f, DT, stick(o), [], -1);
    return { main, mini };
  };

  /* Unlike the main guns, this one runs on while the trigger is down. Half a
     second at ten a second is five or six rounds depending on where the frames
     land. */
  const a = hold(0.55, { mini: true });
  /* Ten a second, as asked. Half a second gets five or six depending on where
     the frames fall; nine would mean it was running at twenty. */
  ok("the mini gun keeps firing while E and the trigger are held, ten a second",
     a.mini >= 5 && a.mini <= 7, `${a.mini} rounds in 0.55s`);
  ok("and the main guns stay silent", a.main === 0);
  ok("each round costs a quarter",
     Math.abs((MAX_AMMO - f.ammo) - a.mini * 0.25) < 1e-9,
     `spent ${(MAX_AMMO - f.ammo).toFixed(2)} on ${a.mini} rounds`);

  /* The main guns are still one per pull however long it is held. */
  const b = hold(0.55);
  ok("the main guns do not run on", b.main === 1 && b.mini === 0, `${b.main} shots`);

  /* And the main guns cannot fire on a leftover fraction, while the mini gun
     can, right down to a quarter. */
  f.ammo = 0.75;
  ok("the main guns will not fire on part of a round", hold(0.3).main === 0);
  f.ammo = 0.75;
  const c = hold(0.05, { mini: true });
  ok("but the mini gun will", c.mini === 1 && Math.abs(f.ammo - 0.5) < 1e-9, `ammo ${f.ammo}`);
  f.ammo = 0.1;
  ok("and not on less than a quarter", hold(0.3, { mini: true }).mini === 0, `ammo ${f.ammo}`);
}

// 8d. The guard: ten of them, half a second each, and only your own tower
//     gives them back.
{
  const f = createFlight(pad);
  const tap = () => {
    stepFlight(f, DT, stick({ guard: true }), [], -1);
    stepFlight(f, DT, stick(), [], -1);
  };
  tap();
  ok("the right button raises a guard", f.guardFor > 0, `${f.guardFor.toFixed(2)}s left`);
  ok("and it costs one", f.guards === MAX_GUARDS - 1, `${f.guards} left`);

  /* Holding it must not stack: it is a tap, not a hold. */
  const held = f.guards;
  run(f, 20, stick({ guard: true }));
  ok("holding the button does not spend more", f.guards === held, `${f.guards} left`);

  run(f, 60, stick());
  ok("it runs out after half a second", f.guardFor === 0);

  for (let i = 0; i < MAX_GUARDS + 5; i++) { tap(); run(f, 40, stick()); }
  ok("guards run out", f.guards === 0);
  tap();
  ok("and an empty rack raises nothing", f.guardFor === 0);
}

// 9. A long unattended flight does not drift, blow up or leak bolts.
{
  const f = createFlight(pad);
  run(f, 60 * 120, stick({ x: 0.35, y: 0.1, firing: true, boosting: true }));
  ok("two minutes of flight stays finite", Number.isFinite(f.pos.length()) && Number.isFinite(f.fwd.length()),
     `radius ${f.pos.length().toFixed(1)}`);
  ok("two minutes of flight stays on the sphere", Math.abs(f.pos.length() - (R + f.alt)) < 1e-3);
  ok("shields survive a long clean flight", f.shields > 0, `${f.shields} left`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
