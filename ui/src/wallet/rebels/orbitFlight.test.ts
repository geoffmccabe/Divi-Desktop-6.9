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
  createFlight, stepFlight, CRUISE, MAX_AMMO, MAX_SHIELD,
  DOCK_SECONDS, type Stick,
} from "./orbitFlight";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const stick = (o: Partial<Stick> = {}): Stick =>
  ({ x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, ...o });

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
  /* Grace has to stop one dive costing every shield at sixty frames a second. */
  ok("one dive costs one shield, not six", g.shields === MAX_SHIELD - 1, `shields ${g.shields}`);
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
  const f = createFlight(pad);
  const a = run(f, 30, stick({ firing: true }));
  ok("firing costs ammo", f.ammo < MAX_AMMO, `ammo ${f.ammo}`);
  ok("firing reports shots", a.shots > 0, `${a.shots} shots in half a second`);
  ok("ammo spent matches shots fired", MAX_AMMO - f.ammo === a.shots,
     `${MAX_AMMO - f.ammo} spent vs ${a.shots} fired`);
  run(f, 60 * 20, stick({ firing: true }));
  ok("ammo runs out and stays out", f.ammo === 0);
  const b = run(f, 60, stick({ firing: true }));
  ok("an empty gun does not fire", b.shots === 0, `${b.shots} shots`);
}

// 7. Docking at a tower repairs and rearms, but only when slow enough.
{
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
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
