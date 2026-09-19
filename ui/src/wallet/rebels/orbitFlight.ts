// Flying over a sphere, docking at towers, and the guns.
//
// The model is a plane over a globe rather than a free 6-degree spacecraft.
// Position is a point on a sphere plus an altitude, and heading is a unit
// vector tangent to the surface. Steering yaws that heading about local up and
// climbs or dives the altitude. Two reasons: it cannot tumble, which is what
// makes a free-flight camera nauseating, and "up" always means away from the
// planet, so you never lose which way the world is.

import * as THREE from "three";
import { R, MIN_ALT, MAX_ALT } from "./orbitWorld";

export const CRUISE = 16;      /* globe units per second, about 1024 km/s of Earth */
export const BOOST = 38;
export const YAW_RATE = 1.5;   /* radians per second at full stick */
/* Turn radius is speed divided by yaw rate, and it is the number that decides
   whether a tower can be docked with at all. At cruise the ship turns in about
   11 units, wider than the dock zone, so a player who overshoots can circle a
   tower forever and never touch it. Braking to 4.5 units a second brings the
   turn radius down to about 3, which fits inside the zone. That is why the
   brake is not a luxury control. */
export const CLIMB_RATE = 11;
export const DOCK_RANGE = 6.5;
export const DOCK_SPEED = 9;
export const DOCK_SECONDS = 2.2;
/* What the brake slows you to. Nearly a hover, on purpose: at this speed the
   turn radius is about one unit, so the ship can be parked against a tower
   rather than flown in circles around it. Braking to a quarter of cruise was
   not enough and docking stayed fiddly. */
export const PARK = 2.2;
export const MAX_SHIELD = 6;
export const MAX_AMMO = 60;
export const BOLT_SPEED = 90;

export interface Bolt {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  life: number;
}

export interface Flight {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  alt: number;
  speed: number;
  bank: number;
  boost: number;      /* 0..1 of the boost cells */
  shields: number;
  ammo: number;
  dock: number;       /* 0..1 progress into a docking */
  dockedAt: number;   /* index of the tower being docked with, or -1 */
  cooldown: number;
  bolts: Bolt[];
  /** Seconds of invulnerability after a hit, so one scrape is not five. */
  grace: number;
}

export interface Stick {
  x: number;          /* -1 left to +1 right */
  y: number;          /* -1 dive to +1 climb */
  boosting: boolean;
  braking: boolean;
  firing: boolean;
}

/** Start on the pad above a tower, pointing north. */
export function createFlight(at: THREE.Vector3): Flight {
  const up = at.clone().normalize();
  /* Any tangent will do for an initial heading. North is the one that reads as
     deliberate rather than arbitrary. */
  const north = new THREE.Vector3(0, 1, 0);
  const fwd = north.clone().addScaledVector(up, -north.dot(up));
  if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
  fwd.normalize();
  const alt = 8;
  return {
    pos: up.clone().multiplyScalar(R + alt),
    fwd,
    alt,
    speed: CRUISE,
    bank: 0,
    boost: 1,
    shields: MAX_SHIELD,
    ammo: MAX_AMMO,
    dock: 0,
    dockedAt: -1,
    cooldown: 0,
    bolts: [],
    grace: 0,
  };
}

const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

export interface StepResult {
  /** True on the frame a hit landed, so the caller can shake and make noise. */
  hit: boolean;
  /** True on the frame docking completed. */
  docked: boolean;
}

export function stepFlight(
  f: Flight,
  dt: number,
  stick: Stick,
  towerTips: THREE.Vector3[],
  homeIndex: number,
): StepResult {
  const out: StepResult = { hit: false, docked: false };
  f.grace = Math.max(0, f.grace - dt);

  /* ---- how near is the nearest tower ----
     Answered first, because being near one changes what speed the ship wants
     to fly at. */
  let near = -1;
  let nearDist = Infinity;
  for (let i = 0; i < towerTips.length; i++) {
    const d = f.pos.distanceTo(towerTips[i]);
    if (d < nearDist) { nearDist = d; near = i; }
  }

  /* ---- speed ----
     There is no throttle lever, and the first version had no way to slow down
     at all, which quietly made docking impossible: cruise is 16 and docking
     needs under 9. Two answers, both of which have to be there. A brake, for
     when the player wants one. And an automatic ease-off inside a tower's
     approach, so flying home and stopping is simply what happens, which is what
     "return to your node to rearm" should feel like. */
  const wantBoost = stick.boosting && f.boost > 0;
  if (wantBoost) f.boost = Math.max(0, f.boost - dt / 6);
  let target = CRUISE;
  if (wantBoost) target = BOOST;
  else if (stick.braking) target = PARK;
  else if (nearDist < DOCK_RANGE * 1.8) target = DOCK_SPEED * 0.55;
  f.speed += (target - f.speed) * Math.min(1, dt * 3);

  /* ---- steering ---- */
  _up.copy(f.pos).normalize();
  if (stick.x !== 0) {
    _q.setFromAxisAngle(_up, -stick.x * YAW_RATE * dt);
    f.fwd.applyQuaternion(_q);
  }
  /* The bank is cosmetic and lags the stick, which is what stops a hard turn
     looking like the model snapping to a new angle. */
  f.bank += (-stick.x * 0.7 - f.bank) * Math.min(1, dt * 4);

  /* ---- climb and dive ----
     Damage lands on the frame the ship first reaches the floor, not once it is
     already sitting on it. The first version asked for the altitude to be 0.4
     units BELOW the floor, which at sixty frames a second it never is, since
     one frame of descent is 0.18: flying into the planet was completely
     harmless and the test is what found it. */
  const wantAlt = f.alt + stick.y * CLIMB_RATE * dt;
  if (wantAlt < MIN_ALT) {
    const wasFlying = f.alt > MIN_ALT + 1e-6;
    if (wasFlying && stick.y < -0.15 && f.speed > CRUISE * 0.6 && f.grace <= 0) {
      f.shields -= 1;
      f.grace = 1.2;
      out.hit = true;
    }
    f.alt = MIN_ALT;
  } else {
    f.alt = Math.min(MAX_ALT, wantAlt);
  }

  /* ---- travel, then put the ship back on its sphere ----
     Moving along a straight tangent leaves the sphere, so altitude is restored
     afterwards and the heading is re-flattened against the NEW local up. Skip
     that second step and the nose slowly buries itself in the planet. */
  f.pos.addScaledVector(f.fwd, f.speed * dt);
  _up.copy(f.pos).normalize();
  f.pos.copy(_up).multiplyScalar(R + f.alt);
  f.fwd.addScaledVector(_up, -f.fwd.dot(_up));
  if (f.fwd.lengthSq() < 1e-8) f.fwd.set(_up.z, _up.x, _up.y);
  f.fwd.normalize();

  /* ---- towers: dock with one, or bounce off it ----
     Measured again after the move, so a clip is judged on where the ship
     ended up rather than where it set off from. */
  nearDist = Infinity;
  for (let i = 0; i < towerTips.length; i++) {
    const d = f.pos.distanceTo(towerTips[i]);
    if (d < nearDist) { nearDist = d; near = i; }
  }
  if (near >= 0 && nearDist < 1.6 && f.grace <= 0) {
    f.shields -= 1;
    f.grace = 1.2;
    out.hit = true;
    /* Shoved away rather than stopped dead, so a clip is a scare not a wall. */
    f.pos.addScaledVector(f.pos.clone().sub(towerTips[near]).normalize(), 2);
  }

  const canDock = near >= 0 && nearDist < DOCK_RANGE && f.speed < DOCK_SPEED;
  if (canDock) {
    /* Your own tower serves you twice as fast. Any tower will do, which is what
       keeps a fight far from home survivable. */
    const rate = near === homeIndex ? 2 : 1;
    f.dock = Math.min(1, f.dock + (dt / DOCK_SECONDS) * rate);
    f.dockedAt = near;
    if (f.dock >= 1) {
      const wasFull = f.shields >= MAX_SHIELD && f.ammo >= MAX_AMMO && f.boost >= 1;
      f.shields = MAX_SHIELD;
      f.ammo = MAX_AMMO;
      f.boost = 1;
      if (!wasFull) out.docked = true;
    }
  } else {
    /* Wobbling in and out of the zone must not undo the approach. A ship that
       is still slow and still nearby is obviously trying to dock, so progress
       HOLDS; it only drains once you have properly left or sped away. Without
       this the ship settles into a circuit that is inside the zone about half
       the time and the bar sits near three quarters for ever, which is exactly
       what the approach test found. */
    const stillTrying = nearDist < DOCK_RANGE * 1.9 && f.speed < DOCK_SPEED * 1.5;
    if (!stillTrying) {
      f.dock = Math.max(0, f.dock - dt * 0.6);
      if (f.dock === 0) f.dockedAt = -1;
    }
  }

  /* ---- guns ---- */
  f.cooldown -= dt;
  if (stick.firing && f.cooldown <= 0 && f.ammo > 0) {
    f.cooldown = 0.12;
    f.ammo -= 1;
    const side = new THREE.Vector3().crossVectors(f.fwd, _up).normalize();
    for (const s of [-1, 1]) {
      f.bolts.push({
        pos: f.pos.clone().addScaledVector(side, s * 1.0),
        dir: f.fwd.clone(),
        life: 1.4,
      });
    }
  }
  for (let i = f.bolts.length - 1; i >= 0; i--) {
    const b = f.bolts[i];
    b.pos.addScaledVector(b.dir, BOLT_SPEED * dt);
    b.life -= dt;
    if (b.life <= 0) f.bolts.splice(i, 1);
  }

  return out;
}

/** Where the chase camera wants to be, and what it wants to look at. */
export function chaseCamera(f: Flight, camPos: THREE.Vector3, lookAt: THREE.Vector3): void {
  const up = f.pos.clone().normalize();
  /* Pulling back with speed is the cheapest sensation of going fast there is. */
  const back = 7 + (f.speed / BOOST) * 5;
  camPos.copy(f.pos).addScaledVector(f.fwd, -back).addScaledVector(up, 2.6);
  lookAt.copy(f.pos).addScaledVector(f.fwd, 14);
}
