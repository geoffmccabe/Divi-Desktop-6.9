// The cockpit shield: is it the AnamayOS mandala, and does it behave?
//
// Run: sh scripts/run-rebels-mandala-tests.sh
//
// Geoff: "I want the shield to duplicate this but make the mandalas spin 3x
// faster and make the lines much lighter and 50% transparent." Three claims,
// all measurable, plus the one that matters most and is easiest to get wrong:
// that this really is a COPY of the website's mandala and not something that
// merely looks like one. So the website's own file is read off the disk and
// its rings are compared with ours, ring for ring.

import * as THREE from "three";
import { existsSync, readFileSync } from "node:fs";
import {
  makeMandalaShield, mandalaRings, petalPoints,
  SITE_ANGULAR_VELOCITY, SPIN_MULTIPLIER, MANDALA_OPACITY, MANDALA_DISTANCE, OUTER_RADIUS,
} from "./rebelsMandala";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ---- it is a copy of the website's mandala ----
   The screensaver lists its rings as calls; so does ours. Pull the numbers out
   of both and compare the multisets, so a ring dropped or a radius mistyped is
   caught rather than admired. */
{
  const site = "/Users/geoffreymccabe/AnamayOS/src/components/shared/mandala-screensaver.tsx";
  const mine = readFileSync(`${process.cwd()}/src/wallet/rebels/rebelsMandala.ts`, "utf8");
  /**
   * Every number in every CALL of the named kinds, one line per call, sorted.
   *
   * Declarations are thrown away first, or a function's own default arguments
   * would read as a ring; so are quoted strings, because our rings are named
   * and some of those names end in a digit.
   */
  const callsOf = (src: string, names: string[]) => {
    /* LINE BY LINE, and never across lines. Stripping quoted strings from the
       whole file at once pairs the first quote of a header comment with the
       next one anywhere below it and eats everything between, which quietly
       emptied this comparison the moment a comment gained a quotation mark. */
    const lines = src.split("\n")
      .filter((l) => !/function\s|=>\s*\{/.test(l))
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.replace(/"[^"\n]*"/g, "").replace(/'[^'\n]*'/g, ""));
    const found: string[] = [];
    for (const name of names) {
      const re = new RegExp(`\\b${name}\\(([^)]*)\\)`, "g");
      for (const line of lines) {
        for (const m of line.matchAll(re)) {
          const nums = [...m[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
          if (nums.length) found.push(nums.join(","));
        }
      }
    }
    return found.sort();
  };
  if (!existsSync(site)) {
    ok("the website's mandala is on the disk to compare against", false,
       `not found at ${site}: this test cannot prove the copy is faithful`);
  } else {
    const siteSrc = readFileSync(site, "utf8");
    /* The petal rings. The site writes tearRing(steps, dist, a, b, m, av, init)
       and we write petalRing("name", steps, dist, a, b, m, av, init): the same
       numbers in the same order, so the lists compare directly once the site's
       `-0.5 * BASE_ANGULAR_VELOCITY` and our `-0.5 * B` both read as -0.5. */
    const sitePetals = callsOf(siteSrc.replace(/BASE_ANGULAR_VELOCITY/g, "1"), ["tearRing"]);
    const myPetals = callsOf(mine.replace(/\bB\b/g, "1"), ["petalRing"]);
    ok("every petal ring is the website's petal ring",
       sitePetals.length > 0 && sitePetals.join(" | ") === myPetals.join(" | "),
       `site ${sitePetals.length}: ${sitePetals.join(" | ")}\n     mine ${myPetals.length}: ${myPetals.join(" | ")}`);

    const siteSpokes = callsOf(siteSrc.replace(/BASE_ANGULAR_VELOCITY/g, "1"), ["lineRing"]);
    const mySpokes = callsOf(mine.replace(/\bB\b/g, "1"), ["lineRing"]);
    ok("every spoke ring is the website's spoke ring",
       siteSpokes.length > 0 && siteSpokes.join(" | ") === mySpokes.join(" | "),
       `site ${siteSpokes.join(" | ")}\n     mine ${mySpokes.join(" | ")}`);

    const siteCircleRings = callsOf(siteSrc, ["circleRing"]);
    const myCircleRings = callsOf(mine, ["circleRing"]);
    ok("every ring of little circles is the website's",
       siteCircleRings.length > 0 && siteCircleRings.join(" | ") === myCircleRings.join(" | "),
       `site ${siteCircleRings.join(" | ")}\n     mine ${myCircleRings.join(" | ")}`);

    /* And the plain circles: the site's c(r) and cA(r) against our
       addCircle(r) and addCircle(r, true). */
    const siteCircles = callsOf(siteSrc, ["c", "cA"]).filter((x) => !x.includes(","));
    const myCircles = callsOf(mine, ["addCircle"]).map((x) => x.split(",")[0]).sort();
    ok("and every plain circle, at the same radius",
       siteCircles.length > 0 && siteCircles.join(",") === myCircles.join(","),
       `site ${siteCircles.join(",")}\n     mine ${myCircles.join(",")}`);
  }
}

/* ---- the petal curve is the site's curve ---- */
{
  const a = 100, b = 150, m = 1.5;
  const pts = petalPoints(a, b, m);
  let worst = 0;
  for (let i = 0; i < pts.length / 2; i++) {
    const rad = (i / (pts.length / 2 - 1)) * Math.PI * 2;
    const x = a * Math.cos(rad);
    const y = b * Math.sin(rad) * Math.pow(Math.sin(rad / 2), m);
    worst = Math.max(worst, Math.abs(pts[i * 2] - x), Math.abs(pts[i * 2 + 1] - y));
  }
  ok("a petal is x = a·cos(θ), y = b·sin(θ)·sin(θ/2)^m", worst < 1e-9, `worst ${worst}`);
  ok("and it is closed, so no petal has a gap in it",
     near(pts[0], pts[pts.length - 2], 1e-9) && near(pts[1], pts[pts.length - 1], 1e-9));
  ok("no point of it is a NaN", pts.every((n) => Number.isFinite(n)));
}

/* ---- three times the speed, and nothing else changed ---- */
{
  ok("the multiplier is three, as asked", SPIN_MULTIPLIER === 3);
  ok("and the website's own rate is kept beside it, unchanged",
     SITE_ANGULAR_VELOCITY === 15, `${SITE_ANGULAR_VELOCITY}`);
  const rings = mandalaRings();
  const spinning = rings.filter((r) => r.siteAv !== 0);
  ok("the rings that turn on the site still turn here", spinning.length >= 9, `${spinning.length}`);
  ok("every rate is the site's rate, untouched in the table",
     spinning.every((r) => [15, -15, 7.5, -7.5].some((v) => near(r.siteAv, v))),
     spinning.map((r) => `${r.name}=${r.siteAv}`).join(" "));
  ok("counter-turning rings still counter-turn",
     spinning.some((r) => r.siteAv > 0) && spinning.some((r) => r.siteAv < 0));
  /* Still rings are merged, but per BAND: the sphere skin turns the website's
     three groups at three different rates, so which group a ring belongs to
     has to survive the merge. */
  ok("the still rings are gathered into a handful of draws, not thirty",
     rings.filter((r) => r.siteAv === 0).length <= 6,
     `${rings.filter((r) => r.siteAv === 0).length} still draws`);
  ok("and there is a ring for every moving part, not a mesh per petal",
     rings.length <= 20, `${rings.length} draws`);
  ok("every ring knows which of the three groups it came from",
     rings.every((r) => r.band === "outer" || r.band === "middle" || r.band === "inner"));
  ok("and all three groups are represented",
     new Set(rings.map((r) => r.band)).size === 3,
     [...new Set(rings.map((r) => r.band))].join(","));
}

/* ---- half transparent, pale, and drawn over the fight ---- */
{
  const shield = makeMandalaShield();
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 5000);
  cam.position.set(10, 20, 30);
  cam.updateMatrixWorld();

  ok("it is hidden until the shield is up", !shield.group.visible);
  shield.step(0, 0, cam);
  ok("and stays hidden at no strength", !shield.group.visible);

  shield.step(1, 1, cam);
  ok("the shield being up shows it", shield.group.visible);

  const mats: THREE.LineBasicMaterial[] = [];
  shield.group.traverse((o) => {
    const l = o as THREE.LineSegments;
    if (l.isLineSegments) mats.push(l.material as THREE.LineBasicMaterial);
  });
  ok("every line is at the opacity asked for, a quarter",
     mats.length > 0 && mats.every((m) => near(m.opacity, 0.25)),
     `${MANDALA_OPACITY} wanted, saw ${[...new Set(mats.map((m) => m.opacity))].join(",")}`);
  /* Judged in sRGB, which is what the colours were written in: three converts
     to its own linear working space on the way in, and a pale colour read back
     linear looks much darker than it is. */
  const srgb = (m: THREE.LineBasicMaterial) => {
    const hex = m.color.getHexString();
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  ok("the lines are PALE, not the website's terracotta",
     mats.every((m) => {
       /* Every channel bright, and none of them far from the others: that is
          what "much lighter" means in numbers. */
       const c = srgb(m);
       return Math.min(...c) > 0.7 && Math.max(...c) - Math.min(...c) < 0.3;
     }),
     mats.map((m) => `#${m.color.getHexString()}`).join(" "));
  ok("they only ever ADD light, so the fight cannot be darkened by them",
     mats.every((m) => m.blending === THREE.AdditiveBlending && !m.depthWrite && !m.depthTest));
  ok("it is drawn after the world", [...new Set(
       (() => { const o: number[] = []; shield.group.traverse((x) => { if ((x as THREE.LineSegments).isLineSegments) o.push(x.renderOrder); }); return o; })(),
     )].every((n) => n > 0));

  /* Fading with the charge, rather than snapping on. */
  shield.step(1, 0.5, cam);
  ok("it fades in with the charge", mats.every((m) => near(m.opacity, 0.125)),
     `${[...new Set(mats.map((m) => m.opacity))].join(",")}`);

  /* ---- three times the speed, measured on the object ---- */
  shield.step(1, 1, cam);
  const spun: number[] = [];
  shield.group.traverse((o) => {
    if ((o as THREE.LineSegments).isLineSegments && o.rotation.z !== 0) spun.push(o.rotation.z);
  });
  const deg = spun.map((r) => Math.round((r * 180) / Math.PI));
  ok("after one second the fast rings have turned 45 degrees, not 15",
     deg.includes(45) || deg.includes(-45), deg.join(","));
  ok("and the half-speed rings have turned 22.5",
     deg.includes(23) || deg.includes(-23) || deg.includes(22) || deg.includes(-22), deg.join(","));

  /* ---- it is hung on the eye, and fills the frame ---- */
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const want = cam.position.clone().addScaledVector(fwd, MANDALA_DISTANCE);
  ok("it hangs in front of the eye", shield.group.position.distanceTo(want) < 1e-6,
     `${shield.group.position.toArray().map((n) => n.toFixed(2)).join(",")}`);
  ok("square to the eye", shield.group.quaternion.angleTo(cam.quaternion) < 1e-6);

  /* Geoff's standing rule about using the full width: a mandala sized to the
     HEIGHT would leave the sides of a wide window bare. Its outer ring has to
     reach the corners, at any shape of window. */
  for (const aspect of [16 / 9, 4 / 3, 21 / 9, 0.6]) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    shield.step(1, 1, cam);
    const halfH = Math.tan(((cam.fov * Math.PI) / 180) / 2) * MANDALA_DISTANCE;
    const corner = Math.hypot(halfH, halfH * aspect);
    ok(`at ${aspect.toFixed(2)} the outer ring reaches the corner of the frame`,
       near(shield.group.scale.x * OUTER_RADIUS, corner, 1e-6),
       `${(shield.group.scale.x * OUTER_RADIUS).toFixed(4)} vs ${corner.toFixed(4)}`);
  }

  ok("the rear-gun window can cull it, so it is not smeared across that too",
     (() => {
       let all = true;
       shield.group.traverse((o) => {
         const l = o as THREE.LineSegments;
         if (l.isLineSegments && (l.frustumCulled === false || !l.geometry.boundingSphere)) all = false;
       });
       return all;
     })());

  shield.dispose();
}

/* ---- and the cockpit uses it in the cockpit only ---- */
{
  const src = readFileSync(`${process.cwd()}/src/wallet/rebels/rebelsController.ts`, "utf8");
  ok("the cockpit builds one and lets it go again",
     /mandala = makeMandalaShield\(\)/.test(src) && /mandala\?\.dispose\(\)/.test(src));
  ok("the mandala gets the strength INSIDE and the wire sphere gets it outside",
     /const inside = flight\.view <= 0\.01/.test(src)
     && /guardShell\.step\([\s\S]{0,60}?inside \? 0 : guardStrength\)/.test(src)
     && /inside \? guardStrength : 0/.test(src),
     "from outside it must still look like it did");
  ok("both are driven by the same charge, so they fade alike",
     /const guardStrength = Math\.min\(1, flight\.guardFor \/ \(GUARD_SECONDS \* 0\.6\)\)/.test(src));
  ok("its shaders are warmed with everything else",
     /show\(mandala\?\.group\)/.test(src));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
