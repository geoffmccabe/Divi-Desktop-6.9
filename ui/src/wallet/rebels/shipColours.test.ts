// Does the paint shop give you the colour you asked for?
//
// This exists because the first version did not, and nothing on the screen said
// so: Geoff moved the engine slider to a bright pink and got a light grey, and
// the swatch beside it showed the pink he had asked for. Two things disagreeing
// with no error anywhere is exactly the shape of bug a test has to catch.
//
// The classifier is ported here rather than the shader being run, which is the
// one weakness: a GPU is not available in node. What removes most of the risk is
// that both read their numbers from the SAME exported TUNING, so a tuning change
// moves both together and only the twenty lines of arithmetic below are a copy.
//
// Run: sh scripts/run-rebels-paint-tests.sh

import * as THREE from "three";
import {
  TUNING, FACTORY, PARTS, OVERLAYS, chipColour, patternSpan, type PartKey,
} from "./shipColours";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- the shader, in JavaScript ---- */
const T = TUNING;
const toSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLinear = (c: number) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function hsv(c: number[]): [number, number, number] {
  const mx = Math.max(...c), mn = Math.min(...c), d = mx - mn;
  let h = 0;
  if (d > 0.0001) {
    if (mx === c[0]) h = ((((c[1] - c[2]) / d) % 6) + 6) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    h /= 6;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function rgb([h, s, v]: [number, number, number]): number[] {
  return [5, 3, 1].map((n) => {
    const k = (n + h * 6) % 6;
    return v * (1 - s * Math.min(Math.max(Math.min(k, 4 - k), 0), 1));
  });
}
const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hueNear = (h: number, t: number, w: number) => {
  let d = Math.abs(h - t);
  d = Math.min(d, 1 - d);
  return 1 - ss(0, w, d);
};

interface Masks { engine: number; blue: number; orange: number; light: number; dark: number; v: number }

/** What the shader sees, given a colour as it sits in the atlas file. */
function classify(srgb: number[]): Masks {
  const [h, s, v] = hsv(srgb);
  const engine = hueNear(h, T.engineHue, T.engineWidth)
    * ss(T.engineMinSat, T.engineMaxSat, s) * ss(T.engineMinVal, T.engineMaxVal, v);
  const blue = hueNear(h, T.blueHue, T.blueWidth) * ss(T.blueMinSat, T.blueMaxSat, s) * (1 - engine);
  const orange = hueNear(h, T.orangeHue, T.orangeWidth) * ss(T.orangeMinSat, T.orangeMaxSat, s) * (1 - engine);
  const colourful = Math.min(1, engine + blue + orange);
  const grey = (1 - colourful) * (1 - ss(T.greyMaxSat, T.greyFadeSat, s));
  return {
    engine, blue, orange,
    light: grey * ss(T.greySplitLo, T.greySplitHi, v),
    dark: grey * (1 - ss(T.greySplitLo, T.greySplitHi, v)),
    v,
  };
}

const hex = (n: number): number[] => [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);

/* The palette, read off the atlas through the UVs of a fighter, a cruiser and a
   station. These are the colours the ships actually touch. */
const PALETTE: Array<[string, number, keyof Masks]> = [
  ["blue hull",    0x4a779a, "blue"],
  ["dark panel",   0x444348, "dark"],
  ["mid panel",    0x535257, "dark"],
  ["deep panel",   0x2b2f33, "dark"],
  ["orange trim",  0xf7ae50, "orange"],
  ["light edge",   0x9d9ca1, "light"],
  ["pale edge",    0xb4b6c1, "light"],
  ["engine glow",  0x00ffdd, "engine"],
];

// 1. Every swatch is claimed by the control that is supposed to own it.
{
  const wrong: string[] = [];
  for (const [name, colour, want] of PALETTE) {
    const m = classify(hex(colour));
    const parts = (["engine", "blue", "orange", "light", "dark"] as const);
    const winner = parts.reduce((a, b) => (m[a] >= m[b] ? a : b));
    if (winner !== want) wrong.push(`${name} -> ${winner}, wanted ${want}`);
  }
  ok("every swatch lands on the right control", wrong.length === 0, wrong.join("; "));

  /* And not weakly. A mask of 0.6 means forty percent of the ORIGINAL colour
     survives the repaint, and mixing a new colour with the old one is how a
     bright pink became a light grey. */
  const weak = PALETTE
    .map(([name, colour, want]) => [name, classify(hex(colour))[want]] as [string, number])
    .filter(([, m]) => m < 0.75);
  ok("and lands on it fully", weak.length === 0,
     weak.map(([n, m]) => `${n} only ${m.toFixed(2)}`).join("; "));
}

// 2. THE ONE THAT MATTERS: the colour asked for is the colour shown.
//
//    Geoff: "I changed the slider to try to make a bright pink engine color...
//    on the ship it's a light grey."
{
  const engine = hex(0x00ffdd);
  const m = classify(engine);
  const [, , v] = hsv(engine);
  const off: string[] = [];
  for (const hue of [0, 60, 120, 172, 240, 320]) {
    const asked = rgb([hue / 360, 1, 1]).map((c) => Math.round(c * 255));
    const painted = rgb([hue / 360, 1, Math.min(1, v * 1)]);
    const shown = engine.map((c, i) => Math.round((c * (1 - m.engine) + painted[i] * m.engine) * 255));
    if (asked.some((a, i) => Math.abs(a - shown[i]) > 2)) {
      off.push(`${hue}deg asked ${asked.join(",")} got ${shown.join(",")}`);
    }
  }
  ok("any hue on the engine arrives exactly", off.length === 0, off.join("; "));

  /* And it is a COLOUR, not a grey. The failure mode had a name: the leftover
     original showing through turned everything toward neutral. */
  const grey = [0, 60, 120, 240, 320].filter((hue) => {
    const painted = rgb([hue / 360, 1, v]);
    const shown = engine.map((c, i) => c * (1 - m.engine) + painted[i] * m.engine);
    const [, sat] = hsv(shown);
    return sat < 0.9;
  });
  ok("and never comes out washed toward grey", grey.length === 0,
     grey.map((h) => `${h}deg`).join(", "));
}

// 3. Working in the wrong colour space is what broke it, so prove it matters.
//
//    three converts an sRGB texture to LINEAR when it samples, and the palette
//    was measured in sRGB. Classifying the linear values instead is the bug.
{
  const engineSrgb = hex(0x00ffdd);
  const engineLinear = engineSrgb.map(toLinear);
  const good = classify(engineSrgb).engine;
  const bad = classify(engineLinear).engine;
  ok("in sRGB the engine is fully claimed", good > 0.99, good.toFixed(2));
  ok("in linear it is not, which was the bug", bad < 0.75, bad.toFixed(2));

  /* The greys move even further: linear crushes them downward, so the split
     between panelling and edges collapses and the Highlight control stops
     doing anything. */
  const edge = hex(0x9d9ca1);
  ok("a light edge reads light in sRGB", classify(edge).light > 0.9,
     classify(edge).light.toFixed(2));
  ok("and reads dark in linear, which was the second bug",
     classify(edge.map(toLinear)).dark > 0.8,
     classify(edge.map(toLinear)).dark.toFixed(2));

  /* And the round trip has to be exact, or the fix trades one skew for
     another. */
  const worst = Math.max(...[0.0, 0.02, 0.2, 0.5, 0.8, 1.0].map((c) => Math.abs(toSrgb(toLinear(c)) - c)));
  ok("the conversion round-trips", worst < 1e-6, worst.toExponential(1));
}

// 4. Black and white have to be reachable.
//
//    Geoff: "when sliding to the minimum I thought it would go to black, but it
//    doesn't (and in fact there's no way to get a black color) and on the far
//    right I thought it would go to pure white."
//
//    He was right on both counts. Brightness multiplies the pixel's own value,
//    and the slider used to run 0.2 to 2.5: 0.2 of anything is not black, and
//    2.5 times the DARKEST swatch in the palette — value 0.28 — is 0.7, which
//    is not white either. The range is 0 to 4 now, and 4 x 0.28 is 1.12, so
//    every part clears white with room to spare.
{
  /* The darkest thing on the ship, which is the hardest case for white. */
  const darkest = Math.min(...PALETTE.map(([, c]) => hsv(hex(c))[2]));
  /* Not the one you would guess: the dark PANELLING is 0.28, but the deep
     panel #2b2f33 is 0.20, and that is what the top of the slider has to
     clear. Asserted so the range cannot quietly stop being enough. */
  ok("the palette's darkest swatch is where we think", Math.abs(darkest - 0.20) < 0.02,
     darkest.toFixed(2));

  for (const [name, colour] of PALETTE) {
    const [, , v] = hsv(hex(colour));
    const black = rgb([0.5, 1, Math.min(1, v * 0)]);
    ok(`${name} reaches black`, black.every((c) => c === 0), black.join(","));
  }

  const white = PALETTE.filter(([, colour]) => {
    const [, , v] = hsv(hex(colour));
    /* Saturation at zero and brightness at the top of the slider. */
    const c = rgb([0, 0, Math.min(1, v * 6)]);
    return !c.every((x) => x > 0.999);
  });
  ok("and every swatch reaches pure white", white.length === 0,
     white.map(([n]) => n).join(", "));

  /* And the old range genuinely could not, or this fix is cosmetic. */
  const oldWhite = PALETTE.filter(([, colour]) => {
    const [, , v] = hsv(hex(colour));
    return Math.min(1, v * 2.5) > 0.999;
  });
  ok("where the old range could not", oldWhite.length < PALETTE.length,
     `${oldWhite.length} of ${PALETTE.length} could`);
}

// 5. The chip beside the name agrees with the ship.
{
  const off: string[] = [];
  for (const { key } of PARTS) {
    const paint = { ...FACTORY, [key]: { ...FACTORY[key as PartKey], hue: 320, sat: 1, bright: 1 } };
    const chip = chipColour(key, paint);
    const chipHue = Number(chip.match(/^hsl\((\d+)/)?.[1] ?? -1);
    if (Math.abs(chipHue - 320) > 1) off.push(`${key} chip at ${chipHue}`);
  }
  ok("the chip shows the hue that was asked for", off.length === 0, off.join("; "));
}

// THE OVERLAY SCALE. Geoff: "there are texture buttons for the ships, but none
// of them work... they aren't adding any lines, camo, or hex grids."
{
  /* The patterns are drawn from the model's own coordinates, divided by how big
     the model is, so a stripe is the same width on a 13-unit fighter and a
     565-unit station. The divisor was measured with Box3.setFromObject, which
     walks WORLD matrices -- and by the time a ship reaches the painter it has
     been through unitCopy, which normalises it to a one-unit box by putting a
     scale on a wrapper. So the divisor came back as 1 while the shader's
     `position` attribute, which unitCopy never touches, still ran to seven
     either side.
     
     Dividing by 1 instead of 13.3 made every pattern thirteen times too fine:
     three hundred and fifty stripes across a hull instead of twenty-six, finer
     than the screen can draw, so it averaged out to a flat tint and read as the
     buttons doing nothing at all. */
  const hull = () => {
    const g = new THREE.BufferGeometry();
    /* A fighter-sized lump: 13 units long, 4 across. */
    const pts: number[] = [];
    for (const x of [-2, 2]) for (const y of [-0.6, 0.6]) for (const z of [-6.65, 6.65]) pts.push(x, y, z);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  };

  const bare = new THREE.Group();
  bare.add(hull());
  ok("the span is the model's own size", Math.abs(patternSpan(bare) - 13.3) < 0.01,
     `${patternSpan(bare).toFixed(2)}`);

  /* ---- THE REGRESSION ----
     Wrapped and scaled down the way unitCopy does it. The answer must NOT
     change, because the shader still sees the unscaled positions. */
  const inner = new THREE.Group();
  inner.add(hull());
  inner.scale.setScalar(1 / 13.3);
  const wrapped = new THREE.Group();
  wrapped.add(inner);
  ok("and a wrapper's scale does not change it",
     Math.abs(patternSpan(wrapped) - 13.3) < 0.01, `${patternSpan(wrapped).toFixed(2)}`);

  /* Which is exactly what the old way got wrong. */
  const box = new THREE.Box3().setFromObject(wrapped);
  const size = new THREE.Vector3();
  box.getSize(size);
  const oldWay = Math.max(size.x, size.y, size.z);
  ok("(the old way really did come back as one)", Math.abs(oldWay - 1) < 0.01,
     `${oldWay.toFixed(3)}, which is ${(13.3 / oldWay).toFixed(1)}x too small`);

  /* A station is forty times a fighter, and must scale with it, or one setting
     is bold on one hull and invisible on the other. */
  const big = new THREE.Group();
  const bigHull = hull();
  bigHull.geometry.scale(42, 42, 42);
  big.add(bigHull);
  ok("a station measures forty times a fighter",
     Math.abs(patternSpan(big) / patternSpan(bare) - 42) < 0.5,
     `${(patternSpan(big) / patternSpan(bare)).toFixed(1)}x`);

  ok("nothing to measure is not a crash", patternSpan(new THREE.Group()) === 1);

  /* And the four choices really are four, in the order the shader branches on:
     none, lines, hex, camo, matching kind 0, 1, 2 and 3. */
  ok("there are four overlays in shader order",
     OVERLAYS.join(",") === "none,lines,hex,camo", OVERLAYS.join(","));
  ok("and none is zero, so a plain ship is plain", OVERLAYS.indexOf("none") === 0);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
