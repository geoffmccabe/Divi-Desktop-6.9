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
/* Docking, fourth attempt, and the model was wrong rather than the numbers.
   The target was the POINT at the top of the mast. A tower is a spire three or
   six units tall standing on a planet, and a player aiming at the tower they
   can see flies at the WHOLE THING, so passing its middle missed the only spot
   that counted. What is measured now is the distance to the tower's AXIS, the
   line from its foot to its tip, so any part of it is the target.

   The window around that line is generous on purpose, and the hard brake stops
   the ship the moment it catches, so arriving fast is not a reason to be
   refused either. */
export const DOCK_RANGE = 12;
/** A full resupply: about two passes of the station sample. */
export const DOCK_SECONDS = 4;
/* What the brake slows you to. Nearly a hover, on purpose: at this speed the
   turn radius is about one unit, so the ship can be parked against a tower
   rather than flown in circles around it. Braking to a quarter of cruise was
   not enough and docking stayed fiddly. */
export const PARK = 2.2;
/** The player's shield.
 *
 *  Ten times a fighter's, and it needs to be. Four of them firing at perfect
 *  accuracy land about two hits a second between them, averaging fifty-five
 *  damage: at a hundred points the player was dead in under a second, which is
 *  exactly what was happening. */
export const MAX_SHIELD = 1000;
/** What flying into the planet or clipping a tower costs. A quarter of a full
 *  shield: enough to matter, not enough to end a run on one clumsy moment. */
export const CRASH_DAMAGE = 250;
export const MAX_AMMO = 60;
import { MINI_AMMO, MINI_INTERVAL } from "./rebelsCombat";

export const MAX_TORPEDOES = 2;
/* ---- the guard ----
   A short, hard shield on the right button. Ten of them, half a second each,
   and only your own tower puts them back, so it is a thing you spend rather
   than a thing you hold. */
export const MAX_GUARDS = 10;
export const GUARD_SECONDS = 0.5;
/** How much of an incoming hit it soaks. */
export const GUARD_ABSORB = 0.8;

export interface Flight {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  alt: number;
  speed: number;
  bank: number;
  boost: number;      /* 0..1 of the boost cells */
  shields: number;
  ammo: number;
  torpedoes: number;
  /** Guards left, and seconds the current one has to run. */
  guards: number;
  guardFor: number;
  guardWasDown: boolean;
  dock: number;       /* 0..1 progress into a docking */
  dockedAt: number;   /* index of the tower being docked with, or -1 */
  cooldown: number;
  /** Trigger state last frame, so a hold is not read as many presses. */
  heavyWasDown: boolean;
  /** Seconds of invulnerability after a hit, so one scrape is not five. */
  grace: number;
  /** What you arrived with, so the gauges can be seen filling rather than
   *  snapping to full the instant the bar completes. */
  dockFrom: { shields: number; ammo: number; boost: number } | null;
  /** Seconds left sitting at the pad after a finished resupply. */
  dockHold: number;
  /** Seconds before a tower will take you again, so leaving actually leaves. */
  redock: number;
}

export interface Stick {
  x: number;          /* -1 left to +1 right */
  y: number;          /* -1 dive to +1 climb */
  boosting: boolean;
  braking: boolean;
  firing: boolean;
  /** Control held: the trigger launches or sets off a torpedo instead of
   *  firing the guns. */
  heavy: boolean;
  /** Right button: raise the guard. */
  guard: boolean;
  /** E held: the trigger fires the mini gun instead of the main guns. */
  mini: boolean;
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
    torpedoes: MAX_TORPEDOES,
    guards: MAX_GUARDS,
    guardFor: 0,
    guardWasDown: false,
    dock: 0,
    dockedAt: -1,
    cooldown: 0,
    heavyWasDown: false,
    grace: 0,
    dockFrom: null,
    dockHold: 0,
    /* You launch from your own tower, which means you launch INSIDE its docking
       range. Without this the ship docks again on its first frame and the hard
       brake pins it there: launching would stop you leaving. */
    redock: 3,
  };
}

/**
 * How far a point is from a tower, treating the tower as the mast it is rather
 * than as the dot on top of it.
 *
 * Towers stand radially, so the foot is the tip's direction times the planet
 * radius and the whole tower is the segment between them. Both ends are derived
 * from the tip alone, which is all the map hands over.
 */
const _foot = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _rel = new THREE.Vector3();
export function distanceToTower(p: THREE.Vector3, tip: THREE.Vector3): number {
  _foot.copy(tip).normalize().multiplyScalar(R);
  _axis.copy(tip).sub(_foot);
  const len2 = _axis.lengthSq();
  if (len2 < 1e-9) return p.distanceTo(tip);
  _rel.copy(p).sub(_foot);
  const t = Math.max(0, Math.min(1, _rel.dot(_axis) / len2));
  return _rel.sub(_axis.multiplyScalar(t)).length();
}

const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

export interface StepResult {
  /** True on the frame a hit landed, so the caller can shake and make noise. */
  hit: boolean;
  /** True on the frame docking completed. */
  docked: boolean;
  /** True on the frame the guns went off. What comes out of them is the combat
   *  module's business; this only decides when. */
  fired: boolean;
  /** True on the frame the trigger was pulled with control held. Launching or
   *  detonating is the caller's decision, since only it knows whether one is
   *  already in the air. */
  heavyPress: boolean;
  /** True on the frame the mini gun went off. */
  miniFired: boolean;
  /** Distance to the nearest tower, and why docking is or is not happening.
   *  On screen, because "it does not work" needs to become something a player
   *  can read back. */
  nearTower: number;
  dockBlock: "" | "no node located" | "cooling down" | "out of range";
}

export function stepFlight(
  f: Flight,
  dt: number,
  stick: Stick,
  towerTips: THREE.Vector3[],
  homeIndex: number,
): StepResult {
  const out: StepResult = {
    hit: false, docked: false, fired: false, heavyPress: false, miniFired: false,
    nearTower: Infinity, dockBlock: "",
  };
  f.grace = Math.max(0, f.grace - dt);

  /* ---- how near is the nearest tower ----
     Answered first, because being near one changes what speed the ship wants
     to fly at. */
  let near = -1;
  let nearDist = Infinity;
  for (let i = 0; i < towerTips.length; i++) {
    const d = distanceToTower(f.pos, towerTips[i]);
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
  /* Docked means STOPPED. Not slowed: stopped. Being handed fuel while drifting
     past is not docking, and it was what happened before. */
  else if (f.dock > 0) target = 0;
  else if (stick.braking) target = PARK;

  /* Braking to a halt is quick and docking brakes hardest, because the resupply
     itself only lasts a second or two: at the ordinary rate the ship was still
     moving for most of it. Getting under way again is deliberately slower,
     which is what makes arriving somewhere feel like arriving. */
  const ease = f.dock > 0 ? 16 : target < f.speed ? 5 : 2;
  f.speed += (target - f.speed) * Math.min(1, dt * ease);
  if (f.speed < 0.05) f.speed = 0;

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
      f.shields -= CRASH_DAMAGE;
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
    const d = distanceToTower(f.pos, towerTips[i]);
    if (d < nearDist) { nearDist = d; near = i; }
  }

  /* HOME IS MEASURED ON ITS OWN, never as "whichever tower happens to be the
     nearest".
     That distinction is the whole bug behind flying straight through your own
     tower. Nodes cluster: a city block of them is drawn as a little packed
     group, tips a couple of units apart. Fly at your own and a NEIGHBOUR's axis
     is very often the closer one, so the nearest-tower test named someone
     else's tower, refused the dock, and charged you crash damage at your own
     front door. Asking "how far am I from MY tower" cannot be confused by a
     neighbour standing next to it. */
  const homeDist = homeIndex >= 0 && homeIndex < towerTips.length
    ? distanceToTower(f.pos, towerTips[homeIndex])
    : Infinity;
  const atHome = homeDist < DOCK_RANGE;

  /* Your own tower never hurts you: you are meant to fly straight into it. And
     nor does a neighbour of it while you are on your way in, or a packed city
     would be a minefield around your own pad. */
  if (near >= 0 && near !== homeIndex && nearDist < 1.6 && !atHome && f.grace <= 0) {
    f.shields -= CRASH_DAMAGE;
    f.grace = 1.2;
    out.hit = true;
    /* Shoved away rather than stopped dead, so a clip is a scare not a wall. */
    f.pos.addScaledVector(f.pos.clone().sub(towerTips[near]).normalize(), 2);
  }

  /* ONLY your own tower, and at ANY speed. Fly into it and it catches you.
     There is no slowing down to be done and no way to arrive too fast: the
     brake below stops the ship once it has caught. */
  out.nearTower = homeDist;
  const canDock = atHome && f.redock <= 0;
  if (!canDock) {
    out.dockBlock = homeIndex < 0 ? "no node located"
      : !atHome ? "out of range"
      : f.redock > 0 ? "cooling down"
      : "";
  }
  if (canDock) {
    /* Your own tower serves you twice as fast. Any tower will do, which is what
       keeps a fight far from home survivable. */
    /* Four seconds, which is about two passes of the station sample. */
    const rate = 1;
    if (f.dock === 0) {
      f.dockFrom = { shields: Math.max(0, f.shields), ammo: f.ammo, boost: f.boost };
    }
    const was = f.dock;
    f.dock = Math.min(1, f.dock + (dt / DOCK_SECONDS) * rate);
    f.dockedAt = homeIndex;
    /* Refilled gradually rather than all at once on completion, so the gauges
       can be watched climbing. That IS the docking graphic. */
    const from = f.dockFrom ?? { shields: f.shields, ammo: f.ammo, boost: f.boost };
    f.shields = Math.max(f.shields, from.shields + (MAX_SHIELD - from.shields) * f.dock);
    f.ammo = Math.max(f.ammo, Math.round(from.ammo + (MAX_AMMO - from.ammo) * f.dock));
    f.boost = Math.max(f.boost, from.boost + (1 - from.boost) * f.dock);
    if (f.dock >= 1) {
      if (was < 1) {
        f.shields = MAX_SHIELD;
        f.ammo = MAX_AMMO;
        f.boost = 1;
        f.torpedoes = MAX_TORPEDOES;
        f.guards = MAX_GUARDS;
        f.dockHold = 1.1;
        out.docked = true;
      }
      /* Sit on the pad a moment, then let go and fly on, rather than being
         stuck at the tower until the player works out how to leave. */
      f.dockHold -= dt;
      if (f.dockHold <= 0) {
        f.dock = 0;
        f.dockFrom = null;
        f.dockedAt = -1;
        f.redock = 4;
      }
    }
  } else {
    /* Wobbling in and out of the zone must not undo the approach. A ship that
       is still slow and still nearby is obviously trying to dock, so progress
       HOLDS; it only drains once you have properly left or sped away. Without
       this the ship settles into a circuit that is inside the zone about half
       the time and the bar sits near three quarters for ever, which is exactly
       what the approach test found. */
    const stillTrying = homeDist < DOCK_RANGE * 1.9;
    if (!stillTrying) {
      f.dock = Math.max(0, f.dock - dt * 0.6);
      if (f.dock === 0) f.dockedAt = -1;
    }
  }

  /* ---- guns, or the heavy trigger ----
     ONE PULL, ONE SHOT. The guns used to run at nine shots a second for as long
     as the button was down, which fired eighteen overlapping copies of the
     laser sample every second and came out as a drone rather than as gunfire.
     Both triggers are now edge-triggered: a click is a shot, and a shot is one
     double-barrelled bang.

     Control held swaps the trigger over entirely, so a torpedo run never sprays
     bullets at the same time. */
  f.cooldown -= dt;
  const pressed = stick.firing && !f.heavyWasDown;
  if (stick.heavy) {
    if (pressed) out.heavyPress = true;
  } else if (stick.mini) {
    /* The mini gun is the one gun that DOES run on while the trigger is held,
       ten a second. A quarter of a round each, so four of them cost one shot of
       the main guns, and a leftover fraction is still usable here. */
    if (stick.firing && f.cooldown <= 0 && f.ammo >= MINI_AMMO) {
      f.cooldown = MINI_INTERVAL;
      f.ammo -= MINI_AMMO;
      out.miniFired = true;
    }
  } else if (pressed && f.cooldown <= 0 && f.ammo >= 1) {
    /* A WHOLE round: the main guns cannot fire on the quarter the mini gun
       leaves behind. */
    f.cooldown = 0.08;
    f.ammo -= 1;
    out.fired = true;
  }
  f.heavyWasDown = stick.firing;

  /* ---- the guard ----
     HELD, not tapped. While the button is down the shield stays up, and it
     spends one charge for every half second it is up. Ten charges is therefore
     five seconds of cover, taken in one go or in ten separate flinches.

     It used to be edge-triggered, which meant holding the button gave a single
     half second and then nothing: the shield was down for almost every round
     that arrived, which is why it read as "the shield does nothing" and why the
     bounce sample was never heard. */
  f.guardFor = Math.max(0, f.guardFor - dt);
  if (stick.guard && f.guardFor <= 0 && f.guards > 0) {
    f.guards -= 1;
    f.guardFor = GUARD_SECONDS;
  }
  /* Let go and it drops at once, so releasing early saves the rest of a charge
     rather than burning it. */
  if (!stick.guard) f.guardFor = 0;
  f.guardWasDown = stick.guard;

  return out;
}
