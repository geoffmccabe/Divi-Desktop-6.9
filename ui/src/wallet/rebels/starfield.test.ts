// Is the sky the real sky, and is it the right way round?
//
// The second half is the one worth having. A mirrored sky looks completely
// convincing: every constellation is still there, still the right shape, still
// the right brightness. It is just backwards, and nobody notices until an
// astronomer does. The brief that prompted this work said so directly —
// "getting one constellation approximately right does not establish that the
// whole sky has the correct orientation" — so these check handedness three
// separate ways rather than eyeballing Orion.
//
// Run: sh scripts/run-rebels-sky-tests.sh

import {
  stars, starDirection, starUv, starColour, galacticLatitude,
} from "./starCatalog";
import { STAR_COUNT, STAR_MAG_LIMIT } from "./starCatalogData";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const H = (h: number) => (h / 24) * Math.PI * 2;      /* hours to radians */
const D = (d: number) => (d / 180) * Math.PI;         /* degrees to radians */

/* Real positions, J2000, from the catalogue itself. If the decoder is wrong
   these are the first thing to disagree. */
const KNOWN: Array<[string, number, number, number]> = [
  ["Sirius",     6.752, -16.716, -1.44],
  ["Canopus",    6.399, -52.696, -0.62],
  ["Arcturus",  14.261, +19.182, -0.05],
  ["Vega",      18.616, +38.784, +0.03],
  ["Rigel",      5.242,  -8.202, +0.18],
  ["Betelgeuse", 5.920,  +7.407, +0.45],
  ["Polaris",    2.530, +89.264, +1.97],
];

const all = stars();

// 1. The catalogue survived being packed into six bytes a star.
{
  ok("every star decoded", all.length === STAR_COUNT, `${all.length}`);
  ok("and it is the naked-eye sky", all.every((s) => s.mag <= STAR_MAG_LIMIT + 0.05),
     `brightest ${Math.min(...all.map((s) => s.mag)).toFixed(2)}, faintest ${Math.max(...all.map((s) => s.mag)).toFixed(2)}`);
  ok("the brightest is Sirius", Math.abs(Math.min(...all.map((s) => s.mag)) + 1.44) < 0.05);

  /* Every named star has to be findable within the packing error, which is
     0.006 degrees. A tenth of a degree is a generous ceiling. */
  const missing: string[] = [];
  for (const [name, raH, decD] of KNOWN) {
    const ra = H(raH), dec = D(decD);
    const near = all.some((s) =>
      Math.abs(s.dec - dec) < D(0.1) &&
      Math.abs(((s.ra - ra + Math.PI) % (Math.PI * 2)) - Math.PI) * Math.cos(dec) < D(0.1));
    if (!near) missing.push(name);
  }
  ok("and the bright stars are where they should be", missing.length === 0, missing.join(", "));
}

// 2. THE HANDEDNESS. Three independent checks, because one is not enough.
{
  /* Celestial north must be the globe's north, or Earth spins under a sky
     tilted away from its own pole. */
  const polaris = starDirection(H(2.530), D(89.264));
  ok("Polaris is over the north pole", polaris[1] > 0.999, `y = ${polaris[1].toFixed(4)}`);
  const sigmaOct = starDirection(H(21.14), D(-88.96));
  ok("and the south pole star is under the south", sigmaOct[1] < -0.999, `y = ${sigmaOct[1].toFixed(4)}`);

  /* THE MIRROR CHECK, done properly.
     My first attempt at this asserted the sign of a cross product from memory,
     which was both wrong and, worse, not a test of mirroring at all. Nor are
     the obvious constellation checks: a mirrored sky preserves collinearity,
     spacing and every angle, so "Orion's belt is evenly spaced" and "the
     Plough's pointers hit Polaris" are all still true in a reflection. That is
     exactly why a mirrored sky is so hard to catch by eye.

     What a reflection DOES flip is chirality, and the scalar triple product of
     three directions measures precisely that. So: compute it for three stars in
     the canonical right-handed equatorial frame, which is correct by
     definition, and again in the game's frame, and require the signs to agree.
     A flip anywhere in the mapping shows up here and nowhere else. */
  const equatorial = (raH: number, decD: number): [number, number, number] => {
    const ra = H(raH), dec = D(decD);
    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  };
  const det = (a: number[], b: number[], c: number[]) =>
    a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);

  /* Betelgeuse, Rigel and Alnilam: a big triangle across Orion, so the volume
     is nowhere near zero and the sign is unambiguous. */
  const trueSign = Math.sign(det(
    equatorial(5.920, 7.407), equatorial(5.242, -8.202), equatorial(5.604, -1.202)));
  const gameSign = Math.sign(det(
    starDirection(H(5.920), D(7.407)),
    starDirection(H(5.242), D(-8.202)),
    starDirection(H(5.604), D(-1.202))));
  ok("the sky is not mirrored", trueSign === gameSign && trueSign !== 0,
     `true ${trueSign}, game ${gameSign}`);

  /* And not only for one triangle: a reflection would flip every one of them. */
  const flipped = [
    [[14.261, 19.182], [18.616, 38.784], [2.530, 89.264]],   /* Arcturus, Vega, Polaris */
    [[6.752, -16.716], [6.399, -52.696], [5.920, 7.407]],    /* Sirius, Canopus, Betelgeuse */
    [[11.062, 61.751], [11.031, 56.382], [12.900, 55.960]],  /* three of the Plough */
  ].filter(([a, b, c]) =>
    Math.sign(det(equatorial(a[0], a[1]), equatorial(b[0], b[1]), equatorial(c[0], c[1])))
    !== Math.sign(det(
      starDirection(H(a[0]), D(a[1])),
      starDirection(H(b[0]), D(b[1])),
      starDirection(H(c[0]), D(c[1])))));
  ok("and no part of it is", flipped.length === 0, `${flipped.length} triangles flipped`);

  /* With handedness settled, the ordinary shape checks are worth having as a
     guard on the mapping arithmetic rather than on its handedness. */
  const mintaka = starUv(H(5.533), D(-0.299));
  const alnilam = starUv(H(5.604), D(-1.202));
  const alnitak = starUv(H(5.679), D(-1.943));
  const spacing = Math.abs((alnilam[0] - mintaka[0]) - (alnitak[0] - alnilam[0]));
  ok("Orion's belt is evenly spaced", spacing < 0.002, spacing.toFixed(5));

  const dubhe = starDirection(H(11.062), D(61.751));
  const merak = starDirection(H(11.031), D(56.382));
  const step = dubhe.map((c, i) => c - merak[i]);
  const aim = dubhe.map((c, i) => c + step[i] * 5);
  const len = Math.hypot(...aim);
  const dot = aim.reduce((a, c, i) => a + (c / len) * polaris[i], 0);
  ok("the Plough's pointers point at Polaris", dot > 0.9,
     `${(Math.acos(Math.min(1, dot)) * 180 / Math.PI).toFixed(1)} degrees off`);
}

// 3. The sky lands on the texture where three will look for it.
{
  /* North at the top, south at the bottom. */
  const north = starUv(0, D(90));
  const south = starUv(0, D(-90));
  ok("the north pole is the top row", north[1] < 0.001, north[1].toFixed(4));
  ok("and the south pole the bottom", south[1] > 0.999, south[1].toFixed(4));

  /* Declination has to be linear in the image, which is what makes it
     equirectangular rather than some other projection. */
  const off = [-60, -30, 0, 30, 60].map((d) => {
    const v = starUv(0, D(d))[1];
    return Math.abs(v - (0.5 - d / 180));
  });
  ok("declination is linear down the image", Math.max(...off) < 1e-9,
     Math.max(...off).toExponential(1));

  /* And every star lands inside the image, wrapping included. */
  const outside = all.filter((s) => {
    const [u, v] = starUv(s.ra, s.dec);
    return !(u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9);
  });
  ok("no star falls off the texture", outside.length === 0, `${outside.length} did`);
}

// 4. The Milky Way is where the Milky Way is.
{
  /* The galactic centre, in Sagittarius, at RA 17h45.6m Dec -28.94. It should
     be on the plane. */
  const centre = Math.abs(galacticLatitude(H(17.76), D(-28.94)));
  ok("the galactic centre is on the plane", centre < D(1.5),
     `${(centre * 180 / Math.PI).toFixed(2)} degrees off`);

  /* Deneb, in Cygnus, sits in the band. */
  const deneb = Math.abs(galacticLatitude(H(20.690), D(45.280)));
  ok("Cygnus is in the band", deneb < D(6), `${(deneb * 180 / Math.PI).toFixed(1)} degrees`);

  /* And the galactic pole is as far off it as anything can be. */
  const pole = galacticLatitude(H(12.857), D(27.128));
  ok("the galactic pole is a right angle from it", Math.abs(pole - Math.PI / 2) < D(0.5),
     `${(pole * 180 / Math.PI).toFixed(2)} degrees`);
}

// 5. Colours are colours, and gently so.
{
  const hot = starColour(-0.3);      /* Rigel-ish */
  const cool = starColour(1.85);     /* Betelgeuse-ish */
  ok("a hot star is blue-white", hot[2] > hot[0], `${hot.join(",")}`);
  ok("a cool star is orange", cool[0] > cool[2], `${cool.join(",")}`);
  /* Not garish: real stars are far less colourful than pictures suggest, and a
     sky of saturated jewels looks like a screensaver. */
  const spread = Math.max(...cool) - Math.min(...cool);
  ok("and the colour is restrained", spread < 150, `${spread}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
