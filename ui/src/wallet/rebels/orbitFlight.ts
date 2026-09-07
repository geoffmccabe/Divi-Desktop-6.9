// Flying, docking at towers, and the guns.
//
// The ship is a free body: a position anywhere, a heading that points wherever
// the player points it, and an up vector of its own. Pitch turns the nose and
// the up together about the wing line; yaw turns the nose about the ship's own
// up. So a loop works, the stars are reachable, and the ground can be flown
// into.
//
// It was not always like this, and the difference is worth recording because
// the old model looked reasonable and was quietly wrong. It flew a plane over a
// globe: position was a point on a sphere plus an altitude between 0.8 and 30,
// heading was forced tangent to the surface every frame, and up and down were
// not a direction at all but a throttle on that altitude number. It could not
// tumble, which was the point. What it also could not do was climb past thirty
// units, dive into the planet, or loop, and Geoff ran into all three within a
// minute of flying it: an invisible ceiling, an invisible floor, and no way to
// point the nose at the sky.
//
// Roll is deliberately not a control. With only pitch and yaw the ship cannot
// end up mysteriously banked, and a loop returns it the right way up by itself,
// which keeps the free model from becoming the disorienting one.

import * as THREE from "three";
import { R, MIN_ALT, MAX_ALT, cruiseScale } from "./orbitWorld";

export const CRUISE = 16;      /* globe units per second, about 1024 km/s of Earth */
export const BOOST = 38;
export const YAW_RATE = 1.5;   /* radians per second at full stick */
/** Roll, in radians a second. Quicker than yaw: rolling is how you point a
 *  turn, so it has to happen faster than the turn it is setting up. */
export const ROLL_RATE = 2.4;
/** Sideways, in units a second at full deflection. A fraction of cruise: strafe
 *  is for lining up a shot, not for travelling. */
export const STRAFE_SPEED = 9;
/* Turn radius is speed divided by yaw rate, and it is the number that decides
   whether a tower can be docked with at all. At cruise the ship turns in about
   11 units, wider than the dock zone, so a player who overshoots can circle a
   tower forever and never touch it. Braking to 4.5 units a second brings the
   turn radius down to about 3, which fits inside the zone. That is why the
   brake is not a luxury control. */
/** How fast the nose comes up, in radians per second at full stick. A shade
 *  quicker than the yaw, so a loop is a deliberate move rather than a chore:
 *  at this rate a full loop takes about three and a half seconds. */
export const PITCH_RATE = 1.8;
/* Docking, fourth attempt, and the model was wrong rather than the numbers.
   The target was the POINT at the top of the mast. A tower is a spire three or
   six units tall standing on a planet, and a player aiming at the tower they
   can see flies at the WHOLE THING, so passing its middle missed the only spot
   that counted. What is measured now is the distance to the tower's AXIS, the
   line from its foot to its tip, so any part of it is the target.

   The window around that line is generous on purpose, and the hard brake stops
   the ship the moment it catches, so arriving fast is not a reason to be
   refused either. */
export const DOCK_RANGE = 34;

/* Why 34 and not 12.
   Twelve was right for the old model, where the ship followed the curve of the
   globe at a constant altitude: fly at your tower and you arrived at tower
   height, so a twelve-unit window round a six-unit mast was a fair target.

   A free-flying ship does not follow the planet. It goes straight, so it climbs
   away from the surface all by itself — thirty seconds of level flight from a
   launch pad leaves it hundreds of units up — and by the time it comes back
   over its own tower it is far above the mast and sails through the old window
   without touching it. Geoff: "running into my own tower didn't seem to work.
   I didn't stop and I didn't recharge."

   Thirty-four is a generous target on purpose. It is only ever YOUR tower, it
   never hurts you, and the whole instruction was that flying into it should
   just work. */
/** A full resupply: about two passes of the station sample. */
export const DOCK_SECONDS = 4;
/* What the brake slows you to. Nearly a hover, on purpose: at this speed the
   turn radius is about one unit, so the ship can be parked against a tower
   rather than flown in circles around it. Braking to a quarter of cruise was
   not enough and docking stayed fiddly. */
export const PARK = 2.2;
/** How far the throttle goes below zero. A slow reverse, enough to back away
 *  from a tower rather than fly a circuit to line up again. */
export const REVERSE = -0.35;
/** The player's shield.
 *
 *  Twenty times a fighter's. Four of them firing at perfect accuracy land about
 *  two hits a second between them, averaging fifty-five damage: at a hundred
 *  points the player died in under a second, which is where this started. A
 *  thousand bought about twenty seconds, and Geoff asked for double again once
 *  the ship also had a planet to fly into. */
export const MAX_SHIELD = 2000;
/** What flying into the planet or clipping a tower costs. A quarter of a full
 *  shield: enough to matter, not enough to end a run on one clumsy moment. */
export const CRASH_DAMAGE = 250;
export const MAX_AMMO = 60;
import { MINI_AMMO, MINI_INTERVAL } from "./rebelsCombat";

export const MAX_TORPEDOES = 4;
/* ---- the guard ----
   A short, hard shield on the right button. Ten of them, half a second each,
   and only your own tower puts them back, so it is a thing you spend rather
   than a thing you hold. */
/** How far back the camera may be pulled, in ship lengths. Nought is the
 *  cockpit; past about six the ship is a speck and the game stops being about
 *  flying it. */
export const MAX_VIEW = 6;
export const MAX_GUARDS = 10;
export const GUARD_SECONDS = 0.5;
/** How much of an incoming hit it soaks. */
export const GUARD_ABSORB = 0.8;

/* ---- repairs, the slow kind ----
   Minecraft's rule, which is the one Geoff asked for: nothing happens while
   you are being shot at, and once you are left alone the hull comes back on
   its own. The delay is what makes it a reward for breaking off rather than a
   reason to ignore damage, and the rate is deliberately slow enough that going
   home to your tower is still much the better answer: full from nothing takes
   the best part of a minute and a half, where the tower does it in four
   seconds. */
export const REPAIR_DELAY = 6;
/** Fraction of a full hull returned per second, once the delay has passed. */
export const REPAIR_RATE = 0.012;

/** Hull lost per second while dragging along the ground at cruise, scaled by
 *  how fast. At full boost that is fatal in about seven seconds. */
export const SCRAPE_RATE = 120;

export interface Flight {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  /** The ship's OWN up, not the planet's.
   *
   *  This is what makes free flight work. Pitch turns it along with the nose,
   *  yaw turns the nose about it, and a loop simply carries both round. The
   *  model used to derive up from the position every frame, which is another
   *  way of saying the ship was always level whether the player liked it or
   *  not. */
  up: THREE.Vector3;
  /** Height above the surface. DERIVED from the position now, and reported for
   *  the gauge rather than steered. */
  alt: number;
  /**
   * Where the throttle is set, from -0.35 to 1. It STAYS where it is put.
   *
   * A persistent lever rather than hold-to-thrust, which is a deliberate
   * departure from what I first proposed. Hold-to-thrust is what the arcade
   * end of the genre does, but the majority — Elite, Star Citizen, Squadrons,
   * Freelancer, X-Wing — use a lever, it is what makes a dedicated full-stop
   * key mean anything, and it leaves the game playing exactly as it did for
   * anyone who never touches W or S, since it starts at full.
   */
  throttle: number;
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
  secondaryWasDown: boolean;
  /** Seconds of invulnerability after a hit, so one scrape is not five. */
  grace: number;
  /** Seconds since anything last hurt this ship. Drives the slow repair. */
  sinceHit: number;
  /** Sitting on the surface. One impact is charged per touchdown, so sliding
   *  along the ground is free and arriving is not. */
  grounded: boolean;
  /**
   * How far the camera sits behind the ship. Zero is the cockpit.
   *
   * Held here rather than in the renderer because it changes what the guns do:
   * from the cockpit they fire from the edges of the frame, and in third person
   * they fire from the nose of a hull the player can see. A camera setting that
   * silently changes where your shots come from belongs with the flight model.
   */
  view: number;
  /** What you arrived with, so the gauges can be seen filling rather than
   *  snapping to full the instant the bar completes. */
  dockFrom: { shields: number; ammo: number; boost: number } | null;
  /** Seconds left sitting at the pad after a finished resupply. */
  dockHold: number;
  /** True while the ship must get clear of its own tower before it may dock
   *  again. See the note where it is cleared. */
  mustLeave: boolean;
}

export interface Stick {
  x: number;          /* -1 left to +1 right, from the keyboard only */
  y: number;          /* -1 dive to +1 climb, from the keyboard only */
  /**
   * How far the MOUSE moved this frame, in radians of turn.
   *
   * Already an angle, not a rate, which is the whole point: the ship turns by
   * exactly what the mouse did and stops the instant the mouse does. It is
   * therefore NOT multiplied by dt — the movement already happened over that
   * frame — and the caller zeroes it once it has been used.
   *
   * The old model held a crosshair off centre and read its offset as a turn
   * RATE, which is the scheme every game that uses it ships a "recentre mouse"
   * key for. That key is the tell: a stick that can be left deflected with no
   * way to feel it is a stick that turns your ship while you are not touching
   * it. It is what Geoff hit three separate times.
   */
  lookX: number;
  lookY: number;
  /**
   * The visible reticle, when the pointer is NOT locked, as a rate from -1 to 1.
   *
   * Two ways to fly with a mouse, because the game has to work in both cases.
   * With the pointer locked the mouse is a direct turn and `look` carries it.
   * Without the lock the pointer is a real cursor that can leave the window
   * entirely, and a relative scheme simply stops receiving movement — which is
   * exactly what Geoff hit: "the mouse just goes quickly outside of the window
   * and then it doesn't turn."
   *
   * So when there is no lock the cursor becomes a visible reticle and the ship
   * turns toward it, which is how Freelancer flew and needs no lock at all. It
   * is a separate channel from the keyboard so the two sum rather than
   * overwrite each other.
   */
  aimX: number;
  aimY: number;
  /** -1 left to +1 right. Q and E. */
  roll: number;
  /** -1 left to +1 right. A and D. Sideways, without turning. */
  strafe: number;
  /** W and S, as -1, 0 or +1. Moves the throttle rather than setting a speed. */
  throttle: number;
  /** X. Everything to a stop. */
  fullStop: boolean;
  boosting: boolean;
  firing: boolean;
  /** The secondary trigger: the right button. Launches or sets off whatever is
   *  in the secondary slot. */
  secondary: boolean;
  /** F: raise the guard. */
  guard: boolean;
  /** True when the selected primary is the mini gun, which runs on while held
   *  where the main guns are one shot a press. */
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
    /* Level, pointing away from the planet, which is what launching from a pad
       means. Everything after this is the player's doing. */
    up: up.clone().addScaledVector(fwd, -up.dot(fwd)).normalize(),
    alt,
    throttle: 1,
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
    secondaryWasDown: false,
    grace: 0,
    sinceHit: REPAIR_DELAY,
    grounded: false,
    view: 0,
    dockFrom: null,
    dockHold: 0,
    /* You launch from your own tower, which means you launch INSIDE its docking
       range. Without this the ship docks again on its first frame and the hard
       brake pins it there: launching would stop you leaving. */
    mustLeave: true,
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
const _right = new THREE.Vector3();
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
  dockBlock: "" | "no node located" | "fly clear first" | "out of range";
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

  /* The slow repair. Counted here and applied here, so every way of taking a
     hit — a bullet, a tower, the ground — postpones it just by setting
     sinceHit to zero, and no caller has to remember to. */
  f.sinceHit += dt;
  if (f.sinceHit > REPAIR_DELAY && f.shields > 0 && f.shields < MAX_SHIELD) {
    f.shields = Math.min(MAX_SHIELD, f.shields + MAX_SHIELD * REPAIR_RATE * dt);
  }

  /* ---- how near is the nearest tower ----
     Answered first, because being near one changes what speed the ship wants
     to fly at. */
  let near = -1;
  let nearDist = Infinity;
  for (let i = 0; i < towerTips.length; i++) {
    const d = distanceToTower(f.pos, towerTips[i]);
    if (d < nearDist) { nearDist = d; near = i; }
  }

  /* ---- the throttle ----
     A lever, set with W and S, that stays where it is put. Down through zero
     into a slow reverse, which is what lets a pilot back off a tower rather
     than having to fly a circuit to come at it again. X puts it to zero. */
  if (stick.throttle !== 0) {
    f.throttle = Math.max(REVERSE, Math.min(1, f.throttle + stick.throttle * dt * 0.9));
  }
  if (stick.fullStop) f.throttle = 0;

  const wantBoost = stick.boosting && f.boost > 0;
  if (wantBoost) f.boost = Math.max(0, f.boost - dt / 6);
  const openSpace = cruiseScale(f.alt);
  /* Boost ignores the lever: it is a button that means "everything you have",
     and having to remember to push the throttle up first would make it feel
     broken exactly when it is wanted. */
  let target = wantBoost ? BOOST * openSpace : CRUISE * openSpace * f.throttle;
  /* Docked means STOPPED. Not slowed: stopped. Being handed fuel while drifting
     past is not docking, and it was what happened before. */
  if (f.dock > 0) target = 0;

  /* Braking to a halt is quick and docking brakes hardest, because the resupply
     itself only lasts a second or two: at the ordinary rate the ship was still
     moving for most of it. Getting under way again is deliberately slower,
     which is what makes arriving somewhere feel like arriving. */
  const ease = f.dock > 0 ? 16 : target < f.speed ? 5 : 2;
  f.speed += (target - f.speed) * Math.min(1, dt * ease);
  /* Snapped to a dead stop only when it is genuinely nearly stopped. The test
     that clamped anything under 0.05 also clamped every NEGATIVE speed, so
     reverse eased toward its target and was zeroed on the way — the throttle
     went below zero and the ship sat still. */
  if (Math.abs(f.speed) < 0.05) f.speed = 0;

  /* ---- steering ----
     THE NOSE POINTS WHERE THE PLAYER POINTS IT. Nothing flattens it, nothing
     limits it, and there is no altitude to run out of.

     What this replaced, and why it had to go: the old model treated up and down
     as a THROTTLE ON ALTITUDE rather than as a direction. Pulling back did not
     raise the nose, it asked for a bigger number between 0.8 and 30, and every
     frame ended by snapping the ship back onto a sphere of that radius and
     flattening the heading against the surface. Three consequences, and Geoff
     hit all three: an invisible ceiling at thirty units, an invisible floor
     just above the ground, and no way to loop, because the nose was forcibly
     returned to the horizontal every sixtieth of a second.

     So the ship now carries its own up vector as well as its heading, pitch
     turns both of them about the wing line, and yaw turns the heading about the
     ship's own up rather than the planet's. Yaw about the SHIP's up is what
     makes a turn mean the same thing upside down and halfway through a loop as
     it does flying level. Roll is not a control, which is deliberate: with only
     pitch and yaw the ship cannot end up mysteriously banked, and a full loop
     brings it back the right way up on its own. */
  _right.crossVectors(f.fwd, f.up);
  if (_right.lengthSq() < 1e-9) _right.set(1, 0, 0);
  _right.normalize();

  /* Pitch: the keys are a rate over time, the mouse is an angle that already
     happened. Adding them means a player can use either or both without one
     overriding the other, which is what the old "keys win while held" rule did
     and why reaching for an arrow key used to kill the mouse. */
  const pitch = (stick.y + stick.aimY) * PITCH_RATE * dt - stick.lookY;
  if (pitch !== 0) {
    _q.setFromAxisAngle(_right, pitch);
    f.fwd.applyQuaternion(_q);
    f.up.applyQuaternion(_q);
  }
  const yaw = -(stick.x + stick.aimX) * YAW_RATE * dt - stick.lookX;
  if (yaw !== 0) {
    _q.setFromAxisAngle(f.up, yaw);
    f.fwd.applyQuaternion(_q);
  }
  /* Roll turns the ship's UP about its nose and leaves the nose alone, which is
     exactly what makes it roll rather than turn. */
  if (stick.roll !== 0) {
    _q.setFromAxisAngle(f.fwd, -stick.roll * ROLL_RATE * dt);
    f.up.applyQuaternion(_q);
  }
  /* Kept honest against drift: a few thousand quaternions later the pair would
     otherwise stop being perpendicular and the ship would slowly shear. */
  f.fwd.normalize();
  f.up.addScaledVector(f.fwd, -f.up.dot(f.fwd));
  if (f.up.lengthSq() < 1e-9) f.up.copy(f.pos).normalize();
  f.up.normalize();

  /* The bank is cosmetic and lags the stick, which is what stops a hard turn
     looking like the model snapping to a new angle. */
  f.bank += (-stick.x * 0.7 - f.bank) * Math.min(1, dt * 4);

  /* ---- travel ----
     In a straight line along the nose, and that is all. The ship is a free
     body in space now, so altitude is something that HAPPENS rather than
     something that is set. */
  f.pos.addScaledVector(f.fwd, f.speed * dt);
  /* Sideways, without turning: the wing line, at a fraction of cruise. Scaled
     with open space like everything else, or strafing would be uselessly slow
     out among the planets. */
  if (stick.strafe !== 0) {
    _right.crossVectors(f.fwd, f.up).normalize();
    f.pos.addScaledVector(_right, stick.strafe * STRAFE_SPEED * cruiseScale(f.alt) * dt);
  }
  f.alt = f.pos.length() - R;

  /* ---- the ground ----
     Flying into the planet is allowed, and it hurts. It has to be allowed:
     being invisibly refused was half of what was wrong. What must not happen is
     tunnelling through, so the ship is set down on the surface and the nose is
     levelled off, which reads as ploughing in and skidding rather than as
     hitting a wall. */
  if (f.alt < MIN_ALT) {
    _up.copy(f.pos).normalize();
    /* ONE impact per touchdown, and its size is the speed and the angle.
       Straight down under boost is fatal on its own; a graze at cruise costs
       little. That is what "smash into the earth" should mean.

       The nose is deliberately NOT levelled. The first version did level it,
       and it made flying near the ground unbearable: the ship dived, was
       snapped upright, the player's still-lowered crosshair dived it again, and
       the whole thing turned into a shudder. Geoff: "it jerks the view up and
       down, like it's trying to pull me down." Holding a nose-down attitude on
       the ground now simply slides along it, because clamping the height is a
       small correction while rewriting the heading is a large one. */
    if (!f.grounded) {
      const into = Math.max(0, -f.fwd.dot(_up));       /* 1 is straight down */
      /* Absolute, so backing into something at speed hurts as much as flying
         into it. */
      const hard = (Math.abs(f.speed) / CRUISE) * into * 2;
      if (hard > 0.05 && f.grace <= 0) {
        f.shields -= CRASH_DAMAGE * hard;
        f.grace = 1.2;
        f.sinceHit = 0;
        out.hit = true;
      }
      f.grounded = true;
    }
    f.alt = MIN_ALT;
    f.pos.copy(_up).multiplyScalar(R + MIN_ALT);

    /* ---- and STAYING there costs something ----
       One impact per touchdown is right for arriving, and wrong for what comes
       after: a ship could plough along the surface at full boost indefinitely,
       taking nothing, while the slow repair healed the one hit it took going
       in. Flying into a planet was survivable as long as you kept doing it,
       which is not what "smash into the earth" should mean.

       So dragging the hull along the ground costs while it is fast. Scaled by
       speed, so a gentle landing is free and a boosted scrape is fatal in a few
       seconds, and it holds the repair off for as long as it lasts. */
    if (Math.abs(f.speed) > CRUISE * 0.4) {
      f.shields -= SCRAPE_RATE * (Math.abs(f.speed) / CRUISE) * dt;
      f.sinceHit = 0;
    }
  } else {
    f.grounded = false;
  }

  /* ---- the edge of the sky ----
     There IS still a ceiling, at eight planet radii rather than thirty units,
     and it is there so a player who points at the stars and holds boost does
     not end up a thousand seconds from anything with nothing to shoot. At that
     distance the planet is a marble; it is space by any reasonable reading. */
  if (f.alt > MAX_ALT) {
    f.alt = MAX_ALT;
    f.pos.normalize().multiplyScalar(R + MAX_ALT);
  }

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
    f.sinceHit = 0;
    out.hit = true;
    /* Shoved away rather than stopped dead, so a clip is a scare not a wall. */
    f.pos.addScaledVector(f.pos.clone().sub(towerTips[near]).normalize(), 2);
  }

  /* ONLY your own tower, and at ANY speed. Fly into it and it catches you.
     There is no slowing down to be done and no way to arrive too fast: the
     brake below stops the ship once it has caught. */
  out.nearTower = homeDist;

  /* LEAVING, not waiting.
     A finished resupply used to start a four second timer, which was fine when
     the docking window was twelve units across. At thirty-four a pilot who
     stays near their own tower is inside it more or less permanently, so the
     timer just meant being caught again every few seconds: dock, fill, sit,
     release, drift, dock. The rule that actually expresses "you have left" is
     that you have got clear of the tower, so that is the rule. It also covers
     launching, which happens from inside the window by definition. */
  if (f.mustLeave && homeDist > DOCK_RANGE * 1.4) f.mustLeave = false;

  const canDock = atHome && !f.mustLeave;
  if (!canDock) {
    out.dockBlock = homeIndex < 0 ? "no node located"
      : !atHome ? "out of range"
      : f.mustLeave ? "fly clear first"
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
        f.mustLeave = true;
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

  /* ---- the two triggers ----
     Left is the primary, right is the secondary. That pairing is the most
     universal convention in the genre — Star Citizen, Everspace, Squadrons,
     FreeSpace 2 and Star Conflict all have it — and it replaces a modifier key
     nobody else uses: torpedoes were on control-click, which is not a thing any
     space game does.

     ONE PULL, ONE SHOT on the main guns. They used to run at nine shots a
     second for as long as the button was down, which came out as a drone rather
     than gunfire. The mini gun is the exception and runs on while held. */
  f.cooldown -= dt;
  const pressed = stick.firing && !f.heavyWasDown;
  if (stick.mini) {
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

  /* The secondary trigger, edge-triggered: one press is one launch, or one
     detonation of what is already out there. Holding it does nothing, which is
     what stops a held button emptying the rack. */
  if (stick.secondary && !f.secondaryWasDown) out.heavyPress = true;
  f.secondaryWasDown = stick.secondary;

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
