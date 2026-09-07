// Making the hull look like it is flying rather than being carried.
//
// In third person the camera is welded to the ship's own frame, so the hull
// cannot move in the frame at all, whatever the player does with the stick. It
// sits dead centre and dead straight through a full-rate roll. Geoff: "the ship
// needs to be slightly reactive to directions... if I'm rolling or tilting, the
// ship should move a little bit, even 5% in the direction, not just sitting
// there looking stupidly fixed."
//
// ONE IDEA, NOT THREE
// -------------------
// The hull is drawn where it WILL BE a fifth of a second from now.
//
// The obvious alternative is to work out a bank angle from the yaw rate, a
// pitch offset from the pitch rate and a roll offset from the roll rate, and
// that is three separate chances to get a sign backwards on a feature whose
// entire job is to look right. Carrying on whatever rotation the ship just
// performed needs no signs at all and covers roll, pitch, yaw and any
// combination of them with the same four lines.
//
// This is a DRAWING. The collider and the guns keep the true orientation: a
// round that came out of a leaned nose would go somewhere the player was not
// pointing.

import * as THREE from "three";

/** How far ahead the hull is drawn, in seconds. */
export const LEAN_AHEAD = 0.2;
/** The most it may ever lean, in radians. Seventeen degrees: a hull that
 *  visibly banks without looking like it has come loose. */
export const LEAN_MAX = 0.3;
/** How quickly it settles, per second. */
export const LEAN_SETTLE = 9;
/** How far it slides across the frame at full lean, in ship lengths. */
export const LEAN_SLIDE = 0.22;

/** Everything the lean remembers between frames. */
export interface Lean {
  /** Where the hull was pointing last frame. */
  from: THREE.Quaternion;
  /** The rotation it is currently leaning by. */
  now: THREE.Quaternion;
  /** Scratch, so a flight loop allocates nothing. */
  spin: THREE.Quaternion;
  want: THREE.Quaternion;
  axis: THREE.Vector3;
  started: boolean;
}

export function createLean(): Lean {
  return {
    from: new THREE.Quaternion(),
    now: new THREE.Quaternion(),
    spin: new THREE.Quaternion(),
    want: new THREE.Quaternion(),
    axis: new THREE.Vector3(),
    started: false,
  };
}

/**
 * Work out this frame's lean and return it.
 *
 * The returned quaternion is a rotation in the SHIP'S OWN frame, to be applied
 * after its true orientation. It is owned by the Lean and is overwritten on the
 * next call, so copy it if it needs to outlive the frame.
 */
export function stepLean(lean: Lean, quat: THREE.Quaternion, dt: number): THREE.Quaternion {
  /* The first frame has nothing to compare against, and treating an identity
     as "last frame" would read the ship's whole orientation as one frame's
     worth of turn and slam it to the cap. */
  if (!lean.started) {
    lean.started = true;
    lean.from.copy(quat);
    lean.now.identity();
    return lean.now;
  }

  /* Into its own quaternion. invert() and multiply() both work in place, so
     reading this out of `from` and then overwriting `from` on the next line
     would leave "the rotation this frame" aliased to the ship's current
     orientation, and the lean would be the ship's attitude rather than its
     change of attitude. That bug was written and caught here once already. */
  const spin = lean.spin.copy(lean.from).invert().multiply(quat);
  lean.from.copy(quat);

  /* Axis and angle of that rotation. sin(half) falling to nothing means there
     was no rotation to speak of, and normalising by it would be a divide by
     zero rather than a small number. */
  const sinHalf = Math.sqrt(Math.max(0, 1 - spin.w * spin.w));
  if (sinHalf > 1e-5) {
    /* acos of |w| rather than of w, with the axis flipped to match, so a
       rotation that comes back with a negative scalar part is read as a small
       turn one way rather than as nearly a full turn the other. */
    const flip = spin.w < 0 ? -1 : 1;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(spin.w))) * flip;
    lean.axis.set(spin.x, spin.y, spin.z).multiplyScalar(flip / sinHalf);
    const ahead = angle * (LEAN_AHEAD / Math.max(dt, 1e-4));
    lean.want.setFromAxisAngle(lean.axis, Math.max(-LEAN_MAX, Math.min(LEAN_MAX, ahead)));
  } else {
    lean.want.identity();
  }

  /* Eased, so the hull settles back rather than snapping straight the instant
     the stick is centred. */
  lean.now.slerp(lean.want, Math.min(1, dt * LEAN_SETTLE));
  return lean.now;
}
