// The Rear Gun's arithmetic: the window, the crosshair in it, the camera
// behind, the aim through it, the tail.
//
// Run: sh scripts/run-rebels-reargun-tests.sh

import * as THREE from "three";
import { REAR_WINDOW, inRearWindow, rearNdc, placeRearCamera, rearAim, tailOf, rearViewport, REAR_CAMERA_BACK } from "./rearGun";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

{
  ok("top right, 35% by 35%", REAR_WINDOW.x === 0.65 && REAR_WINDOW.y === 0 && REAR_WINDOW.w === 0.35 && REAR_WINDOW.h === 0.35);
  ok("the centre of the screen is not in it", !inRearWindow({ x: 0.5, y: 0.5 }));
  ok("the top right corner is", inRearWindow({ x: 0.99, y: 0.01 }) && inRearWindow({ x: 0.65, y: 0.35 }));
  ok("just left of it is not", !inRearWindow({ x: 0.64, y: 0.1 }) && !inRearWindow({ x: 0.8, y: 0.36 }));
  const c = rearNdc({ x: 0.65 + 0.175, y: 0.175 });
  ok("the window's middle is the rear camera's centre", Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9, `${c.x} ${c.y}`);
  const tl = rearNdc({ x: 0.65, y: 0 });
  ok("its top left is -1, +1", tl.x === -1 && tl.y === 1);
  const vp = rearViewport(1000, 600);
  ok("the scissor is the top-right strip, measured from the bottom", vp.x === 650 && vp.w === 350 && vp.h === 210 && vp.y === 600 - 210, JSON.stringify(vp));
}

{
  const pos = new THREE.Vector3(0, 0, 100), fwd = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, 0, 1);
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1000);
  placeRearCamera(cam, { pos, fwd, up });
  ok("the camera sits behind the ship", cam.position.x < pos.x && Math.abs(cam.position.x - (pos.x - REAR_CAMERA_BACK)) < 1e-9, `${cam.position.x}`);
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  ok("and looks backwards", look.dot(fwd) < -0.99, `${look.dot(fwd).toFixed(3)}`);
  const centre = rearAim(cam, { x: 0.65 + 0.175, y: 0.175 });
  ok("a shot through the window's centre goes straight back", centre.dot(fwd) < -0.99, `${centre.dot(fwd).toFixed(3)}`);
  const rightOf = rearAim(cam, { x: 0.99, y: 0.175 });
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  ok("a shot through its right edge goes back and to the camera's right", rightOf.dot(fwd) < -0.5 && rightOf.dot(camRight) > 0.3, `${rightOf.dot(camRight).toFixed(2)}`);
  const upOf = rearAim(cam, { x: 0.65 + 0.175, y: 0.01 });
  ok("through its top, back and up", upOf.dot(up) > 0.3);
  const tail = tailOf(pos, fwd, 2.6);
  ok("the tail is half a length behind the centre", Math.abs(tail.x - (pos.x - 1.3)) < 1e-9);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
