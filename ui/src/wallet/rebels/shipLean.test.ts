// Does the hull lean the way the ship is turning?
//
// Run: sh scripts/run-rebels-lean-tests.sh
//
// The lean is the sort of thing that looks broadly plausible whichever way
// round it is, which is exactly why it gets asserted rather than eyeballed. A
// hull that banks the WRONG way through a turn reads as slightly wrong and
// nobody can say why.

import * as THREE from "three";
import {
  createLean, stepLean, LEAN_MAX, LEAN_AHEAD, LEAN_SLIDE,
} from "./shipLean";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const DT = 1 / 60;
/** Turn a quaternion into an axis and an angle, the way a reader would. */
function axisAngle(q: THREE.Quaternion) {
  const sinHalf = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  const flip = q.w < 0 ? -1 : 1;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * flip;
  const axis = sinHalf > 1e-6
    ? new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(flip / sinHalf)
    : new THREE.Vector3(0, 0, 1);
  return { axis, angle };
}

/** Fly a steady rotation about `axis` at `rate` radians a second. */
function fly(axis: THREE.Vector3, rate: number, seconds: number) {
  const lean = createLean();
  const quat = new THREE.Quaternion();
  const step = new THREE.Quaternion().setFromAxisAngle(axis, rate * DT);
  let last = new THREE.Quaternion();
  for (let i = 0; i < seconds / DT; i++) {
    quat.multiply(step);
    last = stepLean(lean, quat, DT).clone();
  }
  return { lean, quat, out: last };
}

/* --------------------------------------------------------- straight and level */
{
  const lean = createLean();
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
  let last = new THREE.Quaternion();
  for (let i = 0; i < 240; i++) last = stepLean(lean, quat, DT).clone();
  const { angle } = axisAngle(last);
  ok("flying straight, the hull sits straight", Math.abs(angle) < 0.01,
     `${angle.toFixed(4)} rad`);

  /* And the FIRST frame is straight too. Treating an identity as "last frame"
     would read the ship's whole attitude as one frame's worth of turn and slam
     the lean to its cap the instant third person is switched on. */
  const fresh = createLean();
  const first = stepLean(fresh, quat, DT);
  ok("and it does not jump on the very first frame",
     Math.abs(axisAngle(first).angle) < 1e-6, `${axisAngle(first).angle.toFixed(4)}`);
}

/* ------------------------------------------------- it leans the RIGHT way */
{
  /* Roll, pitch and yaw, each way round. The lean must be a rotation about the
     same axis and in the same direction as the turn that caused it: that is
     what "leaning into it" means, and it is the assertion that catches a sign
     the wrong way round. */
  const cases: Array<[string, THREE.Vector3]> = [
    ["roll", new THREE.Vector3(0, 0, 1)],
    ["pitch", new THREE.Vector3(1, 0, 0)],
    ["yaw", new THREE.Vector3(0, 1, 0)],
  ];
  for (const [name, axis] of cases) {
    for (const rate of [1.8, -1.8]) {
      const { out: q } = fly(axis, rate, 1.2);
      const got = axisAngle(q);
      /* Same axis, and the same sign of turn about it. */
      const along = got.axis.dot(axis) * Math.sign(got.angle) * Math.sign(rate);
      ok(`${name} ${rate > 0 ? "one way" : "the other"} leans with the turn`,
         along > 0.9, `${along.toFixed(3)}`);
      ok(`${name} ${rate > 0 ? "one way" : "the other"} leans by a real amount`,
         Math.abs(got.angle) > 0.05, `${got.angle.toFixed(3)} rad`);
    }
  }
}

/* ------------------------------------------------------------ how much */
{
  /* A gentle turn leans a little, a hard one leans more, and nothing ever
     leans past the cap however hard the ship is thrown about. */
  const gentle = Math.abs(axisAngle(fly(new THREE.Vector3(0, 0, 1), 0.4, 1.2).out).angle);
  const hard = Math.abs(axisAngle(fly(new THREE.Vector3(0, 0, 1), 2.4, 1.2).out).angle);
  ok("a harder turn leans further", hard > gentle * 1.5,
     `${gentle.toFixed(3)} vs ${hard.toFixed(3)}`);

  /* The lead is a TIME, so at a given rate the lean should come out at about
     rate times that time, until the cap bites. */
  const want = 0.4 * LEAN_AHEAD;
  ok("and a gentle turn leans by about the rate times the lead",
     Math.abs(gentle - want) < 0.02, `${gentle.toFixed(3)} vs ${want.toFixed(3)}`);

  for (const rate of [3, 8, 40]) {
    const wild = Math.abs(axisAngle(fly(new THREE.Vector3(0, 1, 0), rate, 1).out).angle);
    ok(`spinning at ${rate} rad/s still only leans`, wild <= LEAN_MAX + 1e-6,
       `${wild.toFixed(3)} vs cap ${LEAN_MAX}`);
  }
}

/* --------------------------------------------------------- it settles back */
{
  const lean = createLean();
  const quat = new THREE.Quaternion();
  const step = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 2.4 * DT);
  for (let i = 0; i < 90; i++) { quat.multiply(step); stepLean(lean, quat, DT); }
  const banked = Math.abs(axisAngle(lean.now).angle);
  ok("it is banked at the end of a roll", banked > 0.1, `${banked.toFixed(3)}`);

  /* Stick centred. Held, not snapped. */
  let after1 = 0;
  for (let i = 0; i < 6; i++) after1 = Math.abs(axisAngle(stepLean(lean, quat, DT)).angle);
  ok("and it does not snap straight the instant the stick centres",
     after1 > banked * 0.25, `${after1.toFixed(3)} after 0.1s, was ${banked.toFixed(3)}`);

  let after2 = 0;
  for (let i = 0; i < 90; i++) after2 = Math.abs(axisAngle(stepLean(lean, quat, DT)).angle);
  ok("but it does come back level", after2 < 0.01, `${after2.toFixed(4)}`);
}

/* ------------------------------------------------ the same at any frame rate */
{
  /* The lead is a time, so thirty frames a second and a hundred and twenty must
     reach the same lean. A version that leaned by "one frame's rotation times a
     constant" would give four times as much at 120fps as at 30. */
  const at = (dt: number) => {
    const lean = createLean();
    const quat = new THREE.Quaternion();
    const step = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2 * dt);
    let last = new THREE.Quaternion();
    for (let i = 0; i < 2 / dt; i++) { quat.multiply(step); last = stepLean(lean, quat, dt).clone(); }
    return Math.abs(axisAngle(last).angle);
  };
  const slow = at(1 / 30), fast = at(1 / 120);
  ok("the lean does not depend on the frame rate", Math.abs(slow - fast) < 0.01,
     `30fps ${slow.toFixed(3)}, 120fps ${fast.toFixed(3)}`);
}

/* ------------------------------------------------------------- the slide */
{
  /* The hull slides across the frame as well as turning. Derived from where the
     leaned nose points against the real one, so it is in the same direction as
     the lean by construction and has no sign of its own to get wrong. */
  const { out: q, quat } = fly(new THREE.Vector3(0, 1, 0), 1.8, 1.2);
  const leaned = new THREE.Vector3(0, 0, 1).applyQuaternion(quat.clone().multiply(q));
  const real = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  const slide = leaned.sub(real).multiplyScalar(LEAN_SLIDE);
  ok("a yawing ship slides in the frame", slide.length() > 0.005,
     `${slide.length().toFixed(4)} ship lengths`);
  ok("and never by a silly amount", slide.length() < 0.15,
     `${slide.length().toFixed(4)}`);
}

console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
