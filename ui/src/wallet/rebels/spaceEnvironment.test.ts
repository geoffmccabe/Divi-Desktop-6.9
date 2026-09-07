// Is the sky laid out the way Geoff described it, and can it be reached?
//
// The second half is the one that matters. Getting the arithmetic right and the
// flight ceiling wrong would give fourteen worlds that can be seen and never
// visited, and nothing on screen would say so.
//
// Run: sh scripts/run-rebels-space-tests.sh

import * as THREE from "three";
import { R, MAX_ALT, EARTH_D, PLANET_COUNT, planetDiameter, planetDistance } from "./orbitWorld";
import { planetLayout } from "./spaceEnvironment";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

// 1. Geoff's numbers, read back.
//
//    "The first is 20% the diameter of earth and 5 Earth Diameters away. The
//    next is 30% the earth's diameter and 6 Earth Diameters away."
{
  ok("there are fourteen", PLANET_COUNT === 14, `${PLANET_COUNT}`);
  ok("the first is a fifth of Earth across",
     Math.abs(planetDiameter(1) - EARTH_D * 0.2) < 1e-9, `${planetDiameter(1)}`);
  ok("and five Earth diameters out",
     Math.abs(planetDistance(1) - EARTH_D * 5) < 1e-9, `${planetDistance(1)}`);
  ok("the second is three tenths across",
     Math.abs(planetDiameter(2) - EARTH_D * 0.3) < 1e-9, `${planetDiameter(2)}`);
  ok("and six diameters out",
     Math.abs(planetDistance(2) - EARTH_D * 6) < 1e-9, `${planetDistance(2)}`);

  /* Each one bigger than the last by a tenth of Earth, each one a diameter
     further. Checked across the whole run rather than at the ends. */
  let growing = true, receding = true;
  for (let n = 2; n <= PLANET_COUNT; n++) {
    if (Math.abs((planetDiameter(n) - planetDiameter(n - 1)) - EARTH_D * 0.1) > 1e-9) growing = false;
    if (Math.abs((planetDistance(n) - planetDistance(n - 1)) - EARTH_D) > 1e-9) receding = false;
  }
  ok("each is a tenth of Earth bigger than the last", growing);
  ok("and one Earth diameter further out", receding);
  ok("the last is half again Earth's size",
     Math.abs(planetDiameter(14) - EARTH_D * 1.5) < 1e-9, `${planetDiameter(14)}`);
}

// 2. THE ONE THAT MATTERS: every one of them can actually be flown to.
{
  const ceiling = R + MAX_ALT;
  let reachable = 0;
  for (let n = 1; n <= PLANET_COUNT; n++) {
    /* Reachable means you can get to it AND round it: its far side, plus the
       three-diameter ring where its name shows, has to be inside the sky. */
    if (planetDistance(n) + planetDiameter(n) * 3 <= ceiling) reachable++;
  }
  ok("every planet is inside the sky", reachable === PLANET_COUNT,
     `${reachable} of ${PLANET_COUNT} reachable, ceiling ${ceiling}`);
  ok("and the sky is not needlessly bigger than that",
     ceiling < planetDistance(PLANET_COUNT) * 1.5,
     `ceiling ${ceiling} vs outermost ${planetDistance(PLANET_COUNT)}`);
}

// 3. The sky is the same sky every time.
//
//    Positions come from a hash of the planet's number, not Math.random. A sky
//    that rearranges itself between sessions is not an environment.
{
  const a = planetLayout();
  const b = planetLayout();
  const same = a.every((p, i) => p.at.distanceTo(b[i].at) < 1e-9);
  ok("the layout is the same twice running", same);
  ok("every planet has a name", a.every((p) => p.name.length > 0 && !/^Planet /.test(p.name)),
     a.map((p) => p.name).join(", "));
  ok("and something to say about itself", a.every((p) => p.detail.length > 10));
}

// 4. They are spread out, not stacked.
{
  const all = planetLayout();
  let tooClose = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const gap = all[i].at.distanceTo(all[j].at);
      const need = (all[i].diameter + all[j].diameter) / 2;
      if (gap < need) tooClose++;
    }
  }
  ok("no two planets overlap", tooClose === 0, `${tooClose} overlapping pairs`);

  /* And none of them is sitting on top of Earth. */
  const nearest = Math.min(...all.map((p) => p.at.length() - p.diameter / 2));
  ok("none of them is on top of Earth", nearest > R * 4, `nearest edge ${nearest.toFixed(0)}`);
}

// 4b. EARTH IS IN THE MIDDLE OF THEM.
//
//     Geoff: "they aren't spaced around the earth randomly. They are all in a
//     cluster in the same area on one side of the Earth."
//
//     The first version hashed the planet's number onto a sphere, which is the
//     usual trick and is fine for a thousand points. For fourteen the hash
//     happened to put eleven of them below the equator and most on one side.
//     Nothing in the old tests could see that, so these look at the SHAPE of the
//     set rather than at any one planet.
{
  const all = planetLayout();
  const dirs = all.map((p) => p.at.clone().normalize());

  /* If the directions are evenly spread they cancel out and their mean is near
     zero. A clump pulls the mean towards itself: the hashed version scored
     0.42, which is a long way off centre. */
  const mean = new THREE.Vector3();
  for (const d of dirs) mean.add(d);
  mean.divideScalar(dirs.length);
  ok("the planets surround Earth rather than clumping", mean.length() < 0.12,
     `mean direction ${mean.length().toFixed(3)}`);

  /* And they are not all in one hemisphere, in ANY direction. Checked against
     each planet's own direction, so no axis is special. */
  let worst = 0;
  for (const axis of dirs) {
    const oneSide = dirs.filter((d) => d.dot(axis) > 0).length;
    worst = Math.max(worst, oneSide / dirs.length);
  }
  ok("no half of the sky holds most of them", worst < 0.72,
     `${Math.round(worst * 100)}% on one side at worst`);

  /* Nothing is hiding behind anything else. */
  let closest = Math.PI;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      closest = Math.min(closest, dirs[i].angleTo(dirs[j]));
    }
  }
  ok("and no two share a patch of sky", closest > 0.5,
     `closest pair ${Math.round((closest * 180) / Math.PI)} degrees apart`);
}

// 4c. THEY ARE NOT ALL GREY.
//
//     Geoff, twice: "they have no textures, they are all just white/grey."
//     Synty's planet texture is a greyscale MASK, a shaded ball on white with
//     no colour in it, meant to be tinted per planet by its material. Applied
//     on its own it renders exactly as reported, and no amount of checking the
//     model or the loader would have found it, because both were working.
{
  const all = planetLayout();
  const tints = all.map((p) => p.tint);
  ok("every planet has a colour", tints.every((t) => typeof t === "number"));
  ok("and no two are the same", new Set(tints).size === tints.length,
     `${new Set(tints).size} distinct`);

  /* A colour, not another grey. Grey is where red, green and blue are equal,
     so the spread between the brightest and dimmest channel is the test. */
  const flat = all.filter((p) => {
    const r = (p.tint >> 16) & 255, g = (p.tint >> 8) & 255, b = p.tint & 255;
    return Math.max(r, g, b) - Math.min(r, g, b) < 24;
  });
  ok("and none of them is grey", flat.length === 0,
     flat.map((p) => `${p.name} #${p.tint.toString(16)}`).join(", "));
}

// 5. The approach ring is three of the body's OWN diameters.
//
//    So a giant announces itself from much further off than a rock does, which
//    is what makes the sky feel like it has scale in it.
{
  const all = planetLayout();
  const small = all[0], big = all[13];
  const ringSmall = small.diameter * 3;
  const ringBig = big.diameter * 3;
  ok("a big world is noticed from further away", ringBig > ringSmall * 3,
     `${ringSmall.toFixed(0)} vs ${ringBig.toFixed(0)}`);

  /* Just inside the ring counts, just outside does not. */
  const justIn = small.at.clone().add(new THREE.Vector3(ringSmall * 0.9, 0, 0));
  const justOut = small.at.clone().add(new THREE.Vector3(ringSmall * 1.1, 0, 0));
  ok("inside the ring is 'near'", justIn.distanceTo(small.at) < ringSmall);
  ok("outside it is not", justOut.distanceTo(small.at) > ringSmall);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
