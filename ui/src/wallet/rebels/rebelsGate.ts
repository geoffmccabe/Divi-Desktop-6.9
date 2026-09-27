// The Threshold Gate: the ring you fly through to reach Spikeworld.
//
// Geoff: "It's already there... it's ring-shaped and you just need to move it
// where I told you and create a space inside... make it glow and pulse so
// people know it's active. People can fly through it to get to the spikeworld."
//
// THE RING IS THE PACK'S, NOT OURS
// --------------------------------
// space_SM_Veh_WarpGate_Outer_01 and _Inner_01, which have been hanging in the
// sky since the sky was built (see spaceEnvironment.ts, where it was furniture
// eight Earth diameters out and labelled "destination unset"). It now has a
// destination and it has moved to low orbit over the Pacific. Nothing here
// draws a ring: this file moves the pack's one, fills its opening, and decides
// when a ship has gone through it.
//
// MEASURING THE DOORWAY RATHER THAN GUESSING IT
// ---------------------------------------------
// Two things about that model would have been wrong if they had been assumed.
//
// First, the opening is not the model. The outer ring's radius is 57% of its
// own width and the hole through it is 25%, so a trigger sized from the
// bounding box would have caught ships that were nowhere near the doorway.
//
// Second, and worse: the model is NOT centred on its own axis. Its bounding box
// centre sits about 8% of its width off the line through the hole, and unitCopy
// centres models by their bounding box. So the visible doorway ended up six
// units away from where the object claimed to be. Anything placed at the
// object's position - the membrane, the trigger - would have been visibly
// beside the hole rather than in it.
//
// So both are measured from the geometry when the model lands, and the model is
// then shifted so that THE CENTRE OF THE OPENING IS THE ORIGIN of the group.
// Everything downstream can then be naive, and if the art is ever replaced the
// measurements simply come out different.

import * as THREE from "three";
import { llToVec, SHRINK } from "./orbitWorld";
import { loadModel, unitCopy } from "./spaceAssets";

/** The two halves of the ring, as the pack names them. */
export const GATE_OUTER = "space_SM_Veh_WarpGate_Outer_01";
export const GATE_INNER = "space_SM_Veh_WarpGate_Inner_01";

/** Where the Pacific's middle is: on the equator, out between Hawaii and the
 *  Marquesas. It is the emptiest face of the globe, which is the point - a gate
 *  over land would sit in the middle of somebody's towers. */
export const PACIFIC_LAT = 0;
export const PACIFIC_LON = -160;

/**
 * How wide the whole ring is, in globe units, and how high it hangs.
 *
 * Both follow from the measurements above rather than from taste. The ring's
 * outer radius is 0.57 of its width, so at 70 across it reaches 40 units from
 * its centre: hung 60 up on a planet of radius 100, its lowest point clears the
 * surface by twenty. Any lower and the gate would be buried in the sea it is
 * meant to hang over. The doorway through it is then about eighteen units
 * across, which is a comfortable barn door for a ship two units long.
 *
 * Both then take SHRINK, because Geoff asked for the gate to come down with
 * everything else: "including the portals, which should shrink along with the
 * players." Width and height together, so the ring keeps the same proportions
 * and the same clearance over the sea, and the doorway stays the same size
 * relative to the ship flying through it.
 */
export const GATE_WIDTH = 70 * SHRINK;
export const GATE_ALTITUDE = 60 * SHRINK;

/** Fraction of the model's width that the clear opening's radius takes up, and
 *  the outer ring's. Measured from the mesh; see APERTURE below, which replaces
 *  these with the real thing once the model has landed. These are what the
 *  trigger uses in the meantime, and what the tests can reason about. */
export const APERTURE_SHARE = 0.254;
export const RIM_SHARE = 0.57;

/** How far a ship has to get from the doorway before it will take it again. */
export const GATE_CLEAR_MULT = 3;

export interface Gate {
  group: THREE.Group;
  /** The doorway's radius in world units, once it is known. */
  aperture(): number;
  /** Turn the inner ring and breathe the membrane. */
  step(dt: number, eye: THREE.Vector3): void;
  /**
   * True on the frame the ship goes through, and not again until it has left
   * and come back. The arming is inside rather than in the caller because there
   * are two gates and one rule.
   */
  entered(shipPos: THREE.Vector3): boolean;
  /** How far the ship is from the doorway, for the HUD's prompt. */
  distance(shipPos: THREE.Vector3): number;
  dispose(): void;
}

/** Where the gate hangs in Earth orbit, given the planet's radius. */
export function gatePosition(radius: number): THREE.Vector3 {
  return llToVec(PACIFIC_LAT, PACIFIC_LON, radius + GATE_ALTITUDE);
}

/**
 * Which way the ring faces.
 *
 * Along the local EAST, so the doorway lines up with the way ships actually
 * move: they cruise around the globe, not up off it. A ring facing straight up
 * would be a ring almost everybody meets edge-on, which is a line rather than a
 * door. East at a point on the globe is the way round the spin axis, which is
 * up crossed with north - and on the equator that is simply up crossed with the
 * pole.
 */
export function gateAxis(at: THREE.Vector3): THREE.Vector3 {
  const up = at.clone().normalize();
  const pole = new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(pole, up);
  /* Directly over a pole there is no east. Nothing is placed there, but a
     fallback costs one line and a NaN orientation costs an afternoon. */
  if (east.lengthSq() < 1e-6) return new THREE.Vector3(0, 0, 1);
  return east.normalize();
}

/* ================= THE MEMBRANE =================
   The "space inside": what makes it read as OPEN rather than as a sculpture. */

/** The film across the opening, drawn as a picture rather than a shader.
 *
 *  A canvas texture rather than a custom material on purpose: this hangs in the
 *  Node Map's own scene, and every distinct material there is another shader
 *  program for the card to compile. A radial gradient with a few spokes in it,
 *  turned slowly and faded in and out, gives the swirl for the cost of one
 *  ordinary unlit disc. */
function membraneTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;   /* headless tests */
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const mid = size / 2;

  /* Bright at the middle, gone at the rim, so the disc has no visible edge and
     reads as depth rather than as a plate. */
  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  glow.addColorStop(0, "rgba(255,240,215,0.95)");
  glow.addColorStop(0.35, "rgba(255,150,70,0.55)");
  glow.addColorStop(0.72, "rgba(200,70,30,0.22)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  /* A few brighter spokes, so that turning it is visible. Without them a
     radial gradient rotating is a radial gradient standing still. */
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 3) * 0.11;
    const spoke = ctx.createLinearGradient(mid, mid, mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    spoke.addColorStop(0, "rgba(255,225,190,0.0)");
    spoke.addColorStop(0.45, "rgba(255,190,120,0.30)");
    spoke.addColorStop(1, "rgba(255,150,70,0.0)");
    ctx.strokeStyle = spoke;
    ctx.lineWidth = 5 + (i % 4) * 4;
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================= MEASURING THE DOORWAY ================= */

interface Aperture {
  /** Radius of the clear opening, in the model's own units. */
  hole: number;
  /** Where the axis through that opening is, in the model's own units. */
  axis: THREE.Vector3;
  /** The longest side of the bounding box, which is what unitCopy divides by. */
  longest: number;
}

/**
 * Find the hole through a ring, from the mesh.
 *
 * The ring's axis is the model's own Z through its own origin - that is how the
 * pack authored it, and it is checked rather than trusted: if the vertices do
 * not form a ring around that line the smallest radius comes back as nearly
 * zero and the caller falls back to the measured share above.
 */
export function measureAperture(root: THREE.Object3D): Aperture | null {
  let hole = Infinity;
  let any = false;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute("position");
    if (!pos) return;
    any = true;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      box.expandByPoint(v);
      const r = Math.hypot(v.x, v.y);
      if (r < hole) hole = r;
    }
  });
  if (!any || !Number.isFinite(hole)) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  /* A hole that is not a hole: the vertices reach the axis, so this is a disc
     or a lump and not a ring. Say so rather than returning a nonsense radius. */
  if (hole < longest * 0.05) return null;
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  return { hole, longest, axis: new THREE.Vector3(centre.x, centre.y, 0) };
}

/* ================= THE GATE ================= */

/**
 * One gate, at a place, facing a way.
 *
 * Returns straight away with the trigger already working off the measured
 * share, and swaps in the real numbers when the model lands - so a gate is
 * never a hole in the world that does nothing while a download finishes.
 */
export function makeGate(at: THREE.Vector3, facing: THREE.Vector3, colour = 0xff8a4a): Gate {
  const group = new THREE.Group();
  group.position.copy(at);
  /* The model's doorway looks down its own +Z, so pointing that at `facing`
     points the doorway along it. */
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing.clone().normalize());

  /** The opening's radius in world units. The measured share until the mesh
   *  says otherwise, which is close and is never zero. */
  let hole = GATE_WIDTH * APERTURE_SHARE;

  /* ---- the membrane ----
     Two discs, counter-turning and breathing out of phase, which is what makes
     a flat picture read as something moving under its own power. Built before
     the ring so it is there the moment the gate is. */
  const tex = membraneTexture();
  const discs: THREE.Mesh[] = [];
  const discMats: THREE.MeshBasicMaterial[] = [];
  const skin = new THREE.CircleGeometry(1, 48);
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colour,
      ...(tex ? { map: tex } : {}),
      transparent: true,
      opacity: i === 0 ? 0.85 : 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const disc = new THREE.Mesh(skin, mat);
    /* A hair apart, so the two never z-fight where they overlap. */
    disc.position.z = i === 0 ? 0 : 0.4;
    disc.scale.setScalar(hole);
    discs.push(disc); discMats.push(mat);
    group.add(disc);
  }

  /* ---- the ring itself ---- */
  let spinner: THREE.Object3D | null = null;
  let dead = false;
  const owned: THREE.Group[] = [];

  /** Put a loaded half of the ring in, with its doorway on the origin. */
  const fit = (proto: THREE.Group, width: number): THREE.Group => {
    const model = unitCopy(proto, { unlit: true });
    model.scale.setScalar(width);
    const found = measureAperture(proto);
    if (found) {
      /* unitCopy centred the model on its bounding box, which is NOT on its
         axis. Sliding it back by that offset puts the doorway on the origin,
         which is the whole trick: the membrane and the trigger can then both
         simply be at zero. */
      const k = width / found.longest;
      model.position.x += found.axis.x * k;
      model.position.y += found.axis.y * k;
    }
    owned.push(model);
    group.add(model);
    return model;
  };

  void loadModel(GATE_OUTER).then((proto) => {
    if (dead) return;
    fit(proto, GATE_WIDTH);
    const found = measureAperture(proto);
    if (!found) return;
    /* The real doorway, which the trigger and the membrane now both use. */
    hole = (found.hole / found.longest) * GATE_WIDTH;
    for (const d of discs) d.scale.setScalar(hole);
  }).catch(() => { /* a gate with no ring is still a gate you can fly through */ });

  void loadModel(GATE_INNER).then((proto) => {
    if (dead) return;
    /* The inner ring nests in the outer one. Its own width is 0.665 of the
       outer's in the pack's units, and it is drawn at that share so the two
       sit together exactly as they were modelled. */
    spinner = fit(proto, GATE_WIDTH * 0.665);
  }).catch(() => { /* the outer ring alone still reads as a gate */ });

  let t = 0;
  let armed = true;

  return {
    group,
    aperture: () => hole,
    step(dt, _eye) {
      t += dt;
      /* The inner ring turns; the outer housing does not, because a housing
         that spins reads as loose rather than as machinery. */
      if (spinner) spinner.rotation.z += dt * 0.35;
      /* ---- GLOW AND PULSE, so it reads as ACTIVE ----
         Two beats a little apart in speed, so they drift in and out of step
         and the surface never settles into an obvious loop. */
      discs[0].rotation.z -= dt * 0.22;
      discs[1].rotation.z += dt * 0.13;
      const a = 0.62 + 0.30 * Math.sin(t * 1.5);
      const b = 0.30 + 0.24 * Math.sin(t * 0.9 + 1.7);
      discMats[0].opacity = a;
      discMats[1].opacity = b;
      /* And it breathes, very slightly, which is what sells "open" over "lit". */
      const breath = 1 + 0.035 * Math.sin(t * 1.1);
      discs[0].scale.setScalar(hole * breath);
      discs[1].scale.setScalar(hole * (2 - breath) * 0.97);
    },
    entered(shipPos) {
      const d = shipPos.distanceTo(group.position);
      /* ---- ASKED THE SAFE WAY ROUND ----
         `d <= hole`, not `!(d > hole)`. Every comparison against NaN is false,
         so the negated form answers "yes, you are through the gate" for a ship
         whose position has gone bad, and the one thing a gate must never do is
         fire on a ship that is not there. */
      if (!armed) {
        if (d >= hole * GATE_CLEAR_MULT) armed = true;
        return false;
      }
      if (!(d <= hole)) return false;
      armed = false;
      return true;
    },
    distance: (shipPos) => shipPos.distanceTo(group.position),
    dispose() {
      dead = true;
      skin.dispose();
      for (const m of discMats) m.dispose();
      tex?.dispose();
      for (const m of owned) {
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry?.dispose();
        });
      }
      group.removeFromParent();
    },
  };
}
