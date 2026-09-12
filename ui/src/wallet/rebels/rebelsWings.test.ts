// The wingmen's geometry and what a tier is worth.
//
// Run: sh scripts/run-rebels-wings-tests.sh

import * as THREE from "three";
import {
  WING_SLOTS, WING_MAX, WING_SPIN_SECONDS, WING_SCALE, wingRadius, wingSpin, wingPosition,
  wingShare, wingRounds, wingTiers, WING_RADIUS_MIN, WING_RADIUS_MAX,
} from "./rebelsWings";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- the eight places, in Geoff's order ---- */
{
  ok("eight slots", WING_MAX === 8 && WING_SLOTS.length === 8);
  ok("every slot is a direction", WING_SLOTS.every((v) => Math.abs(v.length() - 1) < 1e-9));
  const name = (v: THREE.Vector3) =>
    `${v.y > 0.3 ? "top" : v.y < -0.3 ? "bottom" : ""}${Math.abs(v.y) > 0.3 && Math.abs(v.x) > 0.3 ? " " : ""}${v.x > 0.3 ? "right" : v.x < -0.3 ? "left" : ""}`;
  ok("left, right, top, bottom, then the corners",
     WING_SLOTS.map(name).join(", ") === "left, right, top, bottom, top right, bottom left, top left, bottom right",
     WING_SLOTS.map(name).join(", "));
  ok("nothing sits on the nose or the tail", WING_SLOTS.every((v) => Math.abs(v.z) < 1e-9));
  /* Symmetrical: every slot has its opposite in the set. */
  ok("the pattern is symmetrical", WING_SLOTS.every((v) =>
    WING_SLOTS.some((o) => o.distanceTo(v.clone().negate()) < 1e-9)));
  ok("drawn at half size", WING_SCALE === 0.5);
}

/* ---- the ring ---- */
{
  ok("one and a half ship widths out", Math.abs(wingRadius(4) - 12) < 1e-9, `${wingRadius(4)}`);
  ok("kept sane for a tiny hull and a huge one",
     wingRadius(0.1) === WING_RADIUS_MIN && wingRadius(99) === WING_RADIUS_MAX);

  ok("one alone does not orbit", wingSpin(7, 1) === 0 && wingSpin(7, 0) === 0);
  ok("two or more do", wingSpin(0.001, 2) > 0);
  ok("a revolution every fifteen seconds",
     Math.abs(wingSpin(WING_SPIN_SECONDS / 2, 2) - Math.PI) < 1e-9
     && Math.abs(wingSpin(WING_SPIN_SECONDS / 4, 2) - Math.PI / 2) < 1e-9);
  ok("and it comes round again", Math.abs(wingSpin(WING_SPIN_SECONDS, 2)) < 1e-9
     && Math.abs(wingSpin(WING_SPIN_SECONDS * 3, 2)) < 1e-9);
}

/* ---- where they actually are ---- */
{
  /* A ship over the north pole, pointing along +x, rolled so its up is +z. */
  const owner = {
    pos: new THREE.Vector3(0, 300, 0),
    fwd: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  };
  const reach = 4;
  const r = wingRadius(reach);
  const left = wingPosition(owner, 0, 0, reach);
  const right = wingPosition(owner, 1, 0, reach);
  const top = wingPosition(owner, 2, 0, reach);
  ok("each one sits a ring's radius away", [left, right, top].every((p) => Math.abs(p.distanceTo(owner.pos) - r) < 1e-6),
     `${left.distanceTo(owner.pos).toFixed(2)} of ${r}`);
  ok("none of them is in front of or behind the ship",
     [left, right, top].every((p) => Math.abs(p.clone().sub(owner.pos).dot(owner.fwd)) < 1e-6));
  ok("left and right are opposite", left.clone().sub(owner.pos).dot(right.clone().sub(owner.pos)) < 0);
  ok("top is along the ship's own up", Math.abs(top.clone().sub(owner.pos).normalize().dot(owner.up) - 1) < 1e-6);
  /* Rolled a quarter turn, the ring carries top round to where a side was. */
  const quarter = wingPosition(owner, 2, Math.PI / 2, reach);
  ok("the ring rolls about the nose", Math.abs(quarter.clone().sub(owner.pos).dot(owner.fwd)) < 1e-6
     && quarter.distanceTo(top) > r, `${quarter.distanceTo(top).toFixed(2)}`);
  /* And the formation follows the ship's own frame, not the world's. */
  const rolled = { pos: owner.pos.clone(), fwd: owner.fwd.clone(), up: new THREE.Vector3(0, 1, 0) };
  const topRolled = wingPosition(rolled, 2, 0, reach);
  ok("the whole formation rolls with the ship", topRolled.distanceTo(top) > r * 0.5,
     `${topRolled.distanceTo(top).toFixed(2)}`);
  ok("a silly slot number still lands somewhere sensible",
     Math.abs(wingPosition(owner, 99, 0, reach).distanceTo(owner.pos) - r) < 1e-6);
}

/* ---- what a tier is worth ---- */
{
  ok("Geoff's shares, fifty to a hundred and seventy percent",
     [1, 2, 3, 4, 5].map((t) => Math.round(wingShare(t) * 100)).join(",") === "50,80,110,140,170");
  ok("and the rounds they carry",
     [1, 2, 3, 4, 5].map((t) => wingRounds(t)).join(",") === "1,1,1.25,1.5,1.75");
  ok("a forged tier past the top carries the top's power",
     wingShare(6) === wingShare(5) && wingShare(7) === wingShare(5) && wingRounds(7) === wingRounds(5));

  ok("nothing held, nothing flying", wingTiers({}).length === 0);
  ok("three of a tier is three wingmen", wingTiers({ drone2: 3 }).join(",") === "2,2,2");
  ok("the best come first", wingTiers({ drone1: 2, drone4: 1, drone2: 1 }).join(",") === "4,2,1,1");
  ok("eight at most", wingTiers({ drone1: 20 }).length === WING_MAX);
  ok("the best eight of a big collection",
     wingTiers({ drone5: 4, drone4: 4, drone1: 9 }).join(",") === "5,5,5,5,4,4,4,4");
  ok("junk and negatives are ignored", wingTiers({ drone1: -3, nonsense: 5 } as never).length === 0);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
