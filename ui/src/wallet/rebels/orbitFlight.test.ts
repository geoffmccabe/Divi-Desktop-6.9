// Flight model checks, run headless with no renderer and no DOM.
//
// The rendering can be judged by looking at it. The simulation cannot: "the
// ship moved" and "the ship moved in the right direction and stayed on its
// sphere" look identical in a screenshot, and a chase camera hides a nose that
// is slowly burying itself in the planet. So the maths is tested on its own.
//
// Run: sh scripts/run-orbit-tests.sh

import * as THREE from "three";
import { R, MIN_ALT, MAX_ALT, planetDistance } from "./orbitWorld";
import {
  createFlight, stepFlight, distanceToTower, cruiseScale, CRUISE, MAX_AMMO, MAX_SHIELD,
  CRASH_DAMAGE, MAX_GUARDS, MAX_TORPEDOES,
  DOCK_SECONDS, type Stick,
} from "./orbitFlight";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const stick = (o: Partial<Stick> = {}): Stick => ({
  x: 0, y: 0, lookX: 0, lookY: 0, roll: 0, strafe: 0, throttle: 0,
  fullStop: false, boosting: false, firing: false, secondary: false,
  guard: false, mini: false, ...o,
});

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

// 2. The frame stays a frame. This is the one that silently rots.
//
//    The ship carries a heading and an up of its own now, and they are turned
//    by quaternions thousands of times a run. Left unchecked they drift out of
//    perpendicular and stop being unit length, and the ship slowly shears
//    instead of flying.
{
  const f = createFlight(pad);
  run(f, 600, stick({ x: 0.6, y: 0.2 }));
  ok("heading stays unit length", Math.abs(f.fwd.length() - 1) < 1e-6, `${f.fwd.length()}`);
  ok("up stays unit length", Math.abs(f.up.length() - 1) < 1e-6, `${f.up.length()}`);
  ok("and the two stay perpendicular", Math.abs(f.fwd.dot(f.up)) < 1e-6,
     `dot ${f.fwd.dot(f.up).toExponential(1)}`);
  ok("the altitude gauge matches where the ship actually is",
     Math.abs(f.alt - (f.pos.length() - R)) < 1e-6, `${f.alt} vs ${f.pos.length() - R}`);
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

// 4. UP AND DOWN ARE A DIRECTION, not a slider.
//
//    Geoff: "something is blocking the upward and downward movement... it seems
//    to have an invisible ceiling and floor... I can't point the ship away from
//    the earth and fly into space. So I can't do a loop. Or I can't dive down
//    and smash into the earth either."
//
//    All three came from the same thing: pitch used to set an altitude between
//    0.8 and 30 units and the heading was flattened onto the surface every
//    frame. These are the three he could not do.
{
  /* Pointing at the stars, and going there.
     Pull back for most of a second, which at the pitch rate is about eighty
     degrees, and then simply fly. Holding the stick any longer would carry the
     nose over the top into a loop, which is the NEXT test and would leave this
     one pointing somewhere arbitrary. */
  const f = createFlight(pad);
  run(f, 50, stick({ y: 1 }));
  ok("the nose can be pointed away from the planet",
     f.fwd.dot(f.pos.clone().normalize()) > 0.9,
     `dot ${f.fwd.dot(f.pos.clone().normalize()).toFixed(2)}`);
  run(f, 60 * 5, stick({ boosting: true }));
  ok("and the old thirty-unit ceiling is gone", f.alt > 100, `alt ${f.alt.toFixed(0)}`);

  /* A LOOP. Held stick, high enough to have room, and the nose must pass
     through pointing straight up AND straight down. */
  const l = createFlight(pad);
  l.pos.normalize().multiplyScalar(R + 300);
  l.alt = 300;
  let sawSky = false, sawGround = false;
  for (let i = 0; i < 60 * 6; i++) {
    stepFlight(l, DT, stick({ y: 1 }), [], -1);
    const radial = l.pos.clone().normalize();
    if (l.fwd.dot(radial) > 0.9) sawSky = true;
    if (l.fwd.dot(radial) < -0.9) sawGround = true;
  }
  ok("a loop goes over the top", sawSky);
  ok("and comes back down the other side", sawGround);
  ok("and the ship is intact at the end of it", Number.isFinite(l.pos.length()));

  /* Diving into the ground. It is allowed, it hurts, and holding it there
     kills you, which is the point of being allowed to do it. */
  const g = createFlight(pad);
  run(g, 60, stick({ y: -1 }));
  ok("the ground can be flown into", g.shields < MAX_SHIELD, `shields ${g.shields}`);
  ok("and it does not tunnel through", g.pos.length() >= R + MIN_ALT - 1e-6,
     `radius ${g.pos.length().toFixed(2)}`);
  /* THE SIZE OF THE IMPACT IS THE SPEED AND THE ANGLE, and one is charged per
     touchdown rather than one per frame. So flying straight down at full boost
     is fatal on its own, and sliding along the ground afterwards is free —
     which is what stops flying low turning into a shudder of repeated hits. */
  const h = createFlight(pad);
  h.pos.normalize().multiplyScalar(R + 120);
  run(h, 55, stick({ y: -1 }));                  /* nose at the planet */
  run(h, 60 * 12, stick({ boosting: true }));    /* and straight in */
  /* Most of the hull in one go. It used to be outright fatal, and stopped
     being so when Geoff doubled the hull to two thousand; taking sixty percent
     of it for flying into a planet is the same lesson at the new scale. */
  ok("going straight in at full boost costs most of the hull",
     h.shields < MAX_SHIELD * 0.5, `${h.shields.toFixed(0)} of ${MAX_SHIELD} left`);

  const graze = createFlight(pad);
  graze.pos.normalize().multiplyScalar(R + MIN_ALT + 0.2);
  const beforeGraze = graze.shields;
  run(graze, 60 * 8, stick({ fullStop: true }));  /* trundling along the surface */
  ok("but sliding along it is not", graze.shields > beforeGraze - CRASH_DAMAGE,
     `${beforeGraze} -> ${graze.shields.toFixed(0)}`);

  /* OPEN SPACE IS FAST, and the towers are not.
     The planets are 1,000 to 3,600 units out and cruise is 16 a second, so
     without this they were a minute to four minutes of holding a stick at a dot
     that barely grew. The multiplier is exactly 1 near the ground, so nothing
     about a dogfight changes. */
  const low = createFlight(pad);
  run(low, 60 * 3, stick({}));
  ok("speed near the towers is untouched", Math.abs(low.speed - CRUISE) < 0.5,
     `${low.speed.toFixed(1)} vs cruise ${CRUISE}`);
  ok("and the scale really is one down there", cruiseScale(8) === 1 && cruiseScale(60) === 1);

  const far = createFlight(pad);
  far.pos.normalize().multiplyScalar(R + 800);
  run(far, 60 * 6, stick({}));
  ok("but out among the planets it is not", far.speed > CRUISE * 4,
     `${far.speed.toFixed(0)} vs cruise ${CRUISE}`);

  /* The whole point of it: the nearest planet is a reachable flight. */
  const trip = createFlight(pad);
  run(trip, 50, stick({ y: 1 }));
  let seconds = 0;
  while (trip.pos.length() < planetDistance(1) && seconds < 200) {
    stepFlight(trip, DT, stick({ boosting: true }), [], -1);
    seconds += DT;
  }
  ok("the nearest planet is under a minute away", seconds < 60, `${seconds.toFixed(0)}s`);

  /* ---- the slow repair ----
     Geoff: "add a Repair factor that's timed like Minecraft in that it's slowly
     healing again." Nothing while you are being shot at, then it comes back on
     its own. It has to stay much slower than going home, or the tower stops
     being worth flying to. */
  const hurt = createFlight(pad);
  hurt.pos.normalize().multiplyScalar(R + 400);   /* clear of the ground */
  hurt.shields = 500;
  hurt.sinceHit = 0;                              /* just been shot */
  run(hurt, 60 * 3, stick({}));
  ok("nothing repairs in the first few seconds", hurt.shields === 500,
     `${hurt.shields.toFixed(0)}`);
  run(hurt, 60 * 20, stick({}));
  ok("then it comes back on its own", hurt.shields > 800, `${hurt.shields.toFixed(0)}`);
  ok("but slowly enough that the tower is still worth flying to",
     hurt.shields < MAX_SHIELD, `${hurt.shields.toFixed(0)} of ${MAX_SHIELD} after 23s`);

  /* And being hit stops it dead. */
  const shot = createFlight(pad);
  shot.pos.normalize().multiplyScalar(R + 400);
  shot.shields = 500;
  shot.sinceHit = 0;
  for (let i = 0; i < 60 * 20; i++) {
    stepFlight(shot, DT, stick({}), [], -1);
    if (i % 120 === 0) shot.sinceHit = 0;          /* shot at every two seconds */
  }
  ok("being shot at holds the repair off", shot.shields < 700, `${shot.shields.toFixed(0)}`);

  /* There is still an edge to the sky, so a player who points up and walks
     away is not lost for ever. */
  /* Space is genuinely a place you fly to: nose up, boost, and keep going. */
  const s2 = createFlight(pad);
  run(s2, 50, stick({ y: 1 }));                 /* nose up */
  run(s2, 60 * 60, stick({ boosting: true }));  /* and straight out */
  ok("space is reached", s2.alt > R * 8, `alt ${s2.alt.toFixed(0)}`);

  /* And it still has an edge. Tested by putting the ship at the edge and
     flying at it, rather than by flying there: the boost cells last six
     seconds and cruise is 16 a second, so reaching 4,550 units under its own
     steam takes nearly five minutes of simulated time. That would be a test of
     the throttle, and what is being tested is the clamp. */
  const s3 = createFlight(pad);
  s3.pos.normalize().multiplyScalar(R + MAX_ALT - 20);
  run(s3, 50, stick({ y: 1 }));                 /* nose at the stars */
  run(s3, 60 * 20, stick({ boosting: true }));
  ok("but it still has an edge", Math.abs(s3.alt - MAX_ALT) < 1e-6,
     `alt ${s3.alt.toFixed(0)} vs ceiling ${MAX_ALT}`);
}

// 5. Boost is faster and runs out.
{
  const f = createFlight(pad);
  run(f, 60, stick({ boosting: true }));
  ok("boost accelerates", f.speed > CRUISE * 1.5, `speed ${f.speed.toFixed(1)}`);
  run(f, 60 * 8, stick({ boosting: true }));
  ok("boost runs dry", f.boost === 0, `boost ${f.boost.toFixed(2)}`);
  run(f, 120, stick({ boosting: true }));
  /* Against cruise AT THIS ALTITUDE: nine seconds of boost carries the ship a
     few hundred units up, where open space is already a little faster. */
  ok("dry boost falls back to cruise, never to a stop",
     Math.abs(f.speed - CRUISE * cruiseScale(f.alt)) < 0.5,
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
  f.mustLeave = false;
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
  /* Geoff: "you can run into it at any speed and then it will stop and do the
     recharge... You don't need to slow down and you don't take damage from
     hitting your own tower." Both halves of that are checked here. */
  const tip = pad.clone().normalize().multiplyScalar(R + 6);
  const f = createFlight(pad);
  f.mustLeave = false;
  f.shields = 200;
  f.ammo = 3;
  let slowest = Infinity;
  for (let i = 0; i < 60 * 6; i++) {
    /* Flat out, straight into it, for the first second only: after that the
       tower has it and forcing the speed again would just be the test fighting
       its own result. */
    f.pos.copy(tip).addScaledVector(tip.clone().normalize(), 2);
    if (i < 60) f.speed = 38;
    stepFlight(f, DT, stick(), [tip], 0);
    if (f.dock > 0.3) slowest = Math.min(slowest, f.speed);
  }
  ok("your own tower catches you at any speed", f.dock > 0 || f.ammo === MAX_AMMO,
     `dock ${f.dock.toFixed(2)}, ammo ${f.ammo}`);
  ok("and it never damages you", f.shields >= 200, `shields ${f.shields.toFixed(0)}`);
  /* Measured DURING the resupply. Afterwards it lets go and gets under way
     again, so the speed at the end says nothing. */
  ok("it stops the ship while it works", slowest < 1, `slowest ${slowest.toFixed(2)}`);
  ok("and restores everything, torpedoes and shields included",
     f.ammo === MAX_AMMO && f.torpedoes === MAX_TORPEDOES && f.guards === MAX_GUARDS,
     `ammo ${f.ammo}, torps ${f.torpedoes}, guards ${f.guards}`);
}
{
  /* Somebody else's tower is not a pad. It does nothing, and running into it
     is exactly as unpleasant as running into anything else. */
  const tip = pad.clone().normalize().multiplyScalar(R + 3);
  const f = createFlight(pad);
  f.mustLeave = false;
  f.shields = 900;
  f.ammo = 3;
  /* Level with the mast. The step re-projects the ship to its own altitude
     every frame, so putting it beside the tower without matching the height
     leaves it floating above and touching nothing. */
  f.alt = 3;
  for (let i = 0; i < 60 * 6; i++) {
    const dir = tip.clone().normalize();
    f.pos.copy(dir).multiplyScalar(R + f.alt);
    /* homeIndex -1: none of these towers are yours. */
    stepFlight(f, DT, stick(), [tip], -1);
  }
  ok("a stranger's tower does not resupply you", f.ammo === 3, `ammo ${f.ammo}`);
  ok("and flying into it hurts", f.shields < 900, `shields ${f.shields.toFixed(0)}`);
}

// 7b. There has to be a way to get slow enough to dock. Cruise is 16 and
//     docking needs under 9, and with no throttle lever the first version made
//     docking literally unreachable.
{
  const f = createFlight(pad);
  f.mustLeave = false;
  run(f, 120, stick());
  ok("the brake actually slows the ship", (run(f, 90, stick({ fullStop: true })), f.speed < 9),
     `speed ${f.speed.toFixed(1)}`);
}
{
  /* Loitering by a tower should ease the ship off on its own, so "fly home and
     rearm" needs no key at all. The ship is held in the approach each frame,
     because letting it fly on is a test of how long the zone is, not of
     whether the ease-off works. */
  const tip = pad.clone().normalize().multiplyScalar(R + 4.2);
  const f = createFlight(pad);
  f.mustLeave = false;
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
  f.mustLeave = false;
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
    /* Throttle back on the run in, the way a pilot does. The brake used to be
       a held key; it is a lever now, so this eases it down rather than pressing
       something. */
    const throttle = range < 30 ? -1 : 0;
    /* Descending onto the tower, which is the other half of what a player
       does and what the first version of this autopilot left out: circling
       overhead at cruise altitude never gets close enough. */
    const wantAlt = 4.6;
    const climb = Math.max(-1, Math.min(1, (wantAlt - f.alt) * 0.6));
    if (toTower.lengthSq() > 1e-6) {
      toTower.normalize();
      const turn = Math.sign(new THREE.Vector3().crossVectors(f.fwd, toTower).dot(up));
      const off = f.fwd.angleTo(toTower);
      stepFlight(f, DT, stick({ x: off > 0.02 ? -turn * Math.min(1, off * 3) : 0, y: climb, throttle }), [tip], 0);
    } else {
      stepFlight(f, DT, stick({ y: climb, throttle }), [tip], 0);
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
  f.mustLeave = false;
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
  /* Twenty a second. Half a second gets ten or eleven depending on where the
     frames fall; five would mean it was running at ten. */
  ok("the mini gun keeps firing while E and the trigger are held, twenty a second",
     a.mini >= 9 && a.mini <= 12, `${a.mini} rounds in 0.55s`);
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

// 8d. The guard: HELD, ten charges, half a second each.
//
//     Geoff: "holding the shield button doesn't keep the shields on. It should
//     stay on, using one charge every half-second it's held on." It used to be
//     edge-triggered, which gave one half-second per click no matter how long
//     the button was down. In a fight that meant the shield was down for almost
//     every round that arrived, which is why it read as doing nothing at all
//     and why the bounce sample was never heard.
{
  const f = createFlight(pad);
  const hold = (seconds: number) => run(f, Math.round(seconds * 60), stick({ guard: true }));

  run(f, 1, stick({ guard: true }));
  ok("the right button raises a guard", f.guardFor > 0, `${f.guardFor.toFixed(2)}s left`);
  ok("and it costs one", f.guards === MAX_GUARDS - 1, `${f.guards} left`);

  /* THE FIX: hold for just under two seconds from a standing start. That is
     four half-second charges — at 0, 0.5, 1.0 and 1.5 — and the shield is up
     for every single frame in between. */
  const g = createFlight(pad);
  let downFrames = 0;
  for (let i = 0; i < 119; i++) {
    stepFlight(g, DT, stick({ guard: true }), [], -1);
    if (g.guardFor <= 0) downFrames++;
  }
  ok("holding keeps the shield up the whole time", downFrames === 0,
     `${downFrames} frames with no shield`);
  ok("and holding spends one charge every half second", MAX_GUARDS - g.guards === 4,
     `spent ${MAX_GUARDS - g.guards} in two seconds`);

  /* Letting go drops it at once, so an early release banks the rest. */
  run(f, 2, stick());
  ok("letting go drops the shield", f.guardFor === 0);

  hold(60);
  ok("ten charges is five seconds of cover, then nothing", f.guards === 0, `${f.guards} left`);
  ok("and an empty rack raises nothing", f.guardFor === 0);
}

// 8d2. COMING HOME FROM ABOVE.
//
//      Geoff, again: "running into my own tower didn't seem to work. I didn't
//      stop and I didn't recharge, repair, and refuel."
//
//      A free-flying ship does not follow the curve of the planet. It goes
//      straight, so level flight climbs away from the surface on its own and a
//      pilot coming back to their tower arrives well ABOVE the mast rather than
//      alongside it. The old twelve-unit window was sized for a ship that flew
//      at a constant altitude and was simply not there any more.
{
  const tip = pad.clone().normalize().multiplyScalar(R + 6);
  const f = createFlight(pad);
  f.mustLeave = false;
  /* Twenty-five units up, nose down at the tower: exactly what returning from
     a fight looks like now. */
  f.pos.copy(pad).normalize().multiplyScalar(R + 31);
  f.fwd.copy(f.pos).normalize().negate();
  f.up.set(1, 0, 0).addScaledVector(f.fwd, -f.fwd.x).normalize();
  f.ammo = 3;
  f.shields = 200;

  ok("the ship really is above the mast",
     distanceToTower(f.pos, tip) > 12,
     `${distanceToTower(f.pos, tip).toFixed(0)} from the tower`);

  /* Measured AT the moment it completes. Left running afterwards the ship
     undocks still pointing at the planet and flies into it, which is correct
     behaviour and would make this a test of what happens next. */
  let docks = 0, shieldsOnDock = 0, ammoOnDock = 0;
  for (let i = 0; i < 60 * 8 && docks === 0; i++) {
    if (stepFlight(f, DT, stick({}), [tip], 0).docked) {
      docks++;
      shieldsOnDock = f.shields;
      ammoOnDock = f.ammo;
    }
  }
  ok("coming home from above still docks", docks === 1, `${docks} docks`);
  ok("and it repairs and rearms", shieldsOnDock === MAX_SHIELD && ammoOnDock === MAX_AMMO,
     `${shieldsOnDock} shields, ${ammoOnDock} rounds`);
}

// 8e. Docking must not be stolen by the neighbours.
//
//     Geoff, a fifth time: "I still am unable to dock with my tower, I just fly
//     right through it every time." Nodes cluster, and the map packs a city\'s
//     towers a couple of units apart. Docking used to test "is the NEAREST
//     tower mine", so a neighbour standing beside your own pad answered no:
//     the dock was refused and you were charged crash damage at your own front
//     door. Home is now measured on its own.
{
  const dir = pad.clone().normalize();
  const side = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
  /* Mine, and a neighbour a metre and a half to the side of it: exactly the
     packing the map uses for co-located nodes. */
  const home = dir.clone().multiplyScalar(R + 4.2);
  const neighbourDir = dir.clone().addScaledVector(side, 0.02).normalize();
  const neighbour = neighbourDir.clone().multiplyScalar(R + 4.2);
  const tips = [neighbour, home];
  const HOME = 1;

  /* Coming in over the cluster: well inside my own dock zone, but at this
     instant the neighbour's mast is the nearer of the two. */
  const f = createFlight(pad);
  f.mustLeave = false;
  f.pos.copy(home).addScaledVector(side, 1.6);
  ok("the neighbour really is the nearer one",
     distanceToTower(f.pos, neighbour) < distanceToTower(f.pos, home),
     `neighbour ${distanceToTower(f.pos, neighbour).toFixed(2)}, home ${distanceToTower(f.pos, home).toFixed(2)}`);

  const before = f.shields;
  const r = run(f, 60 * 5, stick(), tips, HOME);
  ok("and docking still happens", r.docks === 1, `${r.docks} docks`);
  ok("with no crash damage from the neighbour", f.shields >= before,
     `${before} -> ${f.shields}`);
}

// 8f. THE NEW CONTROLS: relative look, roll, strafe and a throttle lever.
//
//     Geoff asked for the scheme the genre has settled on, so these check the
//     four things that changed rather than the four that did not.
{
  /* ---- the mouse is an ANGLE, not a rate ----
     The old scheme held a crosshair off centre and read its offset as a turn
     rate, which is why a ship kept turning after the mouse stopped. A mouse
     delta is a turn that already happened, so it must be applied once and
     never again — and the caller clears it, which this test does not, so a
     second step with the same stick would turn twice if the model scaled it by
     time instead of taking it whole. */
  const f = createFlight(pad);
  const before = f.fwd.clone();
  stepFlight(f, DT, stick({ lookX: 0.4 }), [], -1);
  const turned = before.angleTo(f.fwd);
  ok("the mouse turns the ship by what it moved", Math.abs(turned - 0.4) < 0.01,
     `${turned.toFixed(3)} radians for a 0.4 push`);

  /* And a frame with nothing on the stick turns nothing, which is the whole
     point: stop the mouse, stop the ship. */
  const held = f.fwd.clone();
  for (let i = 0; i < 60; i++) stepFlight(f, DT, stick({}), [], -1);
  ok("and stops the instant the mouse does", held.angleTo(f.fwd) < 1e-6,
     `${held.angleTo(f.fwd).toExponential(1)} radians of drift in a second`);

  /* A longer frame must not turn further: the movement happened over the frame
     that reported it, whatever length that frame was. */
  const a = createFlight(pad), b = createFlight(pad);
  stepFlight(a, 1 / 240, stick({ lookY: 0.3 }), [], -1);
  stepFlight(b, 1 / 15, stick({ lookY: 0.3 }), [], -1);
  const fa = a.fwd.angleTo(new THREE.Vector3(0, 1, 0).cross(pad).normalize());
  void fa;
  ok("and the frame rate does not change how far it turns",
     Math.abs(a.fwd.angleTo(b.fwd)) < 1e-6, a.fwd.angleTo(b.fwd).toExponential(1));
}

// 8g. Roll turns the ship without turning where it is pointing.
{
  const f = createFlight(pad);
  const nose = f.fwd.clone();
  const up = f.up.clone();
  run(f, 30, stick({ roll: 1 }));
  ok("roll leaves the nose alone", nose.angleTo(f.fwd) < 1e-6,
     `${nose.angleTo(f.fwd).toExponential(1)} radians`);
  ok("and turns the ship's up", up.angleTo(f.up) > 0.5, `${up.angleTo(f.up).toFixed(2)} radians`);

  /* Q and E have to disagree, or one of them is wired wrong. */
  const l = createFlight(pad), r = createFlight(pad);
  run(l, 20, stick({ roll: -1 }));
  run(r, 20, stick({ roll: 1 }));
  const sign = (g: typeof l) => new THREE.Vector3().crossVectors(up, g.up).dot(g.fwd);
  ok("and rolling left is not rolling right", Math.sign(sign(l)) === -Math.sign(sign(r)),
     `${sign(l).toFixed(3)} vs ${sign(r).toFixed(3)}`);
}

// 8h. Strafe moves the ship sideways without turning it.
{
  const f = createFlight(pad);
  const nose = f.fwd.clone();
  const start = f.pos.clone();
  /* Throttle to nothing first, so what is measured is the strafe and not the
     ship flying forwards at the same time. */
  f.throttle = 0;
  run(f, 90, stick({ fullStop: true }));
  const still = f.pos.clone();
  run(f, 60, stick({ strafe: 1 }));
  ok("strafe moves the ship", still.distanceTo(f.pos) > 3,
     `${still.distanceTo(f.pos).toFixed(1)} units in a second`);
  ok("and leaves the nose where it was", nose.angleTo(f.fwd) < 1e-6);
  /* Sideways, not forwards. */
  const moved = f.pos.clone().sub(still).normalize();
  ok("and it really is sideways", Math.abs(moved.dot(f.fwd)) < 0.05,
     `${moved.dot(f.fwd).toFixed(3)} of it was forward`);
  void start;
}

// 8i. The throttle is a lever that stays where it is put.
{
  const f = createFlight(pad);
  ok("it starts at full, so the game flies as it did", f.throttle === 1);

  run(f, 60, stick({ throttle: -1 }));
  const eased = f.throttle;
  ok("S brings it down", eased < 0.4, eased.toFixed(2));
  run(f, 120, stick({}));
  ok("and it STAYS down with nothing held", Math.abs(f.throttle - eased) < 1e-9,
     `${f.throttle.toFixed(2)}`);
  ok("and the ship slowed to match", f.speed < CRUISE * 0.5, f.speed.toFixed(1));

  /* Down through zero into reverse, which is how you back off a tower. */
  run(f, 120, stick({ throttle: -1 }));
  ok("it goes into reverse", f.throttle < 0, f.throttle.toFixed(2));
  run(f, 180, stick({}));
  ok("and the ship actually backs up", f.speed < 0, f.speed.toFixed(1));

  /* X is a full stop. */
  run(f, 5, stick({ fullStop: true }));
  ok("X puts the throttle to nothing", f.throttle === 0);

  /* Boost ignores the lever entirely: it is a button that means everything you
     have, and having to push the throttle up first would feel broken. */
  const b = createFlight(pad);
  b.throttle = 0;
  run(b, 60, stick({ boosting: true }));
  ok("boost works from a closed throttle", b.speed > CRUISE, b.speed.toFixed(1));
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
