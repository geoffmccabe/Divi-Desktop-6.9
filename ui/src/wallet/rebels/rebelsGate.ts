// The Threshold Gate: the way to Spikeworld and the way back.
//
// Geoff: "move the portal to teleport to it closer to the orbit so it's
// basically exactly above the center of the pacific ocean on earth. Players can
// then more easily fly over to it and go through it to appear in the
// spikeworld."
//
// WHY IT IS A BALL OF RINGS AND NOT A HOOP
// ----------------------------------------
// The obvious portal is a hoop you fly through, and a hoop has a FRONT. Ships
// here cruise tangentially around the globe, so a hoop lying flat above the
// Pacific is a hoop almost everybody arrives at edge-on: a line, not a door.
// Turning it to face the traffic only moves the problem, because the traffic
// comes from every direction at once.
//
// So the gate has no front. Three rings on three axes, turning at different
// speeds around a core, and the trigger is a SPHERE: reach it from anywhere and
// you are through it. That is also the honest reading of what was asked for,
// which is a thing players can fly over to and go through, not a thing they
// have to line up with.
//
// It is drawn unlit, like everything else in this game, so adding it to the
// scene cannot touch any other material's shader (a lesson that cost a
// 791-millisecond frame once: see voxelPlanet.ts).

import * as THREE from "three";
import { llToVec } from "./orbitWorld";

/** Where the Pacific's middle is: on the equator, out between Hawaii and the
 *  Marquesas. It is the emptiest face of the globe, which is the point — a gate
 *  over land would sit in the middle of somebody's towers. */
export const PACIFIC_LAT = 0;
export const PACIFIC_LON = -160;

/** How high above the surface, in globe units. One unit is about 64 km, so this
 *  is low orbit: high enough to be clear of every tower, close enough that
 *  Geoff's "fly over to it" is a short trip rather than an expedition. */
export const GATE_ALTITUDE = 30;

/** How close counts as through it. Generous on purpose: this is a door, and a
 *  door you can miss at three hundred units a second is a wall. */
export const GATE_REACH = 14;

/** And how far you have to get away before it will take you again. Without it,
 *  coming back from Spikeworld lands you inside the gate you just came out of
 *  and it sends you straight back, forever. */
export const GATE_CLEAR = GATE_REACH * 2.2;

/** Where the gate hangs in Earth orbit. */
export function gatePosition(radius: number): THREE.Vector3 {
  return llToVec(PACIFIC_LAT, PACIFIC_LON, radius + GATE_ALTITUDE);
}

export interface Gate {
  group: THREE.Group;
  /** Turn the rings. */
  step(dt: number, eye: THREE.Vector3): void;
  /** True on the frame the ship goes through, and not again until it has left
   *  and come back. The arming is inside rather than in the caller because
   *  there are two gates and one rule. */
  entered(shipPos: THREE.Vector3): boolean;
  /** How far the ship is from it, for the HUD's prompt. */
  distance(shipPos: THREE.Vector3): number;
  dispose(): void;
}

/**
 * One gate, at a place, in a colour.
 *
 * Earth's is the heart's orange, because that is what is on the other side of
 * it; Spikeworld's is the blue of Earth's own sky, for the same reason. A
 * player at either one can see where it goes before going through it.
 */
export function makeGate(at: THREE.Vector3, colour: number): Gate {
  const group = new THREE.Group();
  group.position.copy(at);

  /* ---- the core ----
     A small bright ball, the thing you actually aim at. Drawn back-to-front so
     it reads as a glow with depth rather than as a billiard ball. */
  const coreGeo = new THREE.SphereGeometry(GATE_REACH * 0.34, 20, 14);
  const coreMat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.55,
    side: THREE.BackSide, depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  /* ---- three rings, three axes ----
     One geometry between them: a ring is a ring, and three copies of the same
     two hundred triangles is two hundred triangles. */
  const ringGeo = new THREE.TorusGeometry(GATE_REACH * 0.82, GATE_REACH * 0.045, 8, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.85, depthWrite: false,
  });
  const rings: THREE.Mesh[] = [];
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    /* Each one standing in a different plane, so from any angle at least one
       of them is a circle rather than a line. */
    ring.rotation.set(i === 0 ? 0 : Math.PI / 2, i === 1 ? Math.PI / 2 : 0, i * 0.7);
    rings.push(ring);
    group.add(ring);
  }

  /* ---- the halo ----
     A flat disc that always faces the camera, so the gate is findable from the
     far side of the planet as a spark of light rather than as nothing. */
  const haloGeo = new THREE.CircleGeometry(GATE_REACH * 1.25, 24);
  const haloMat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.12,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  group.add(halo);

  let t = 0;
  /** Armed means "will take the next ship that reaches it". A gate starts
   *  disarmed if the ship is already standing in it, which is exactly the case
   *  on arrival. */
  let armed = true;
  const spins = [0.5, -0.34, 0.22];

  return {
    group,
    step(dt, eye) {
      t += dt;
      for (let i = 0; i < rings.length; i++) {
        rings[i].rotateOnAxis(axes[i], spins[i] * dt);
      }
      /* A slow breath, so it is alive at a distance without being a strobe. */
      const pulse = 0.78 + 0.22 * Math.sin(t * 1.6);
      ringMat.opacity = 0.85 * pulse;
      coreMat.opacity = 0.42 + 0.22 * pulse;
      halo.lookAt(eye);
    },
    entered(shipPos) {
      const d = shipPos.distanceTo(group.position);
      if (!armed) {
        if (d > GATE_CLEAR) armed = true;
        return false;
      }
      if (d > GATE_REACH) return false;
      armed = false;
      return true;
    },
    distance: (shipPos) => shipPos.distanceTo(group.position),
    dispose() {
      coreGeo.dispose(); coreMat.dispose();
      ringGeo.dispose(); ringMat.dispose();
      haloGeo.dispose(); haloMat.dispose();
      group.removeFromParent();
    },
  };
}
