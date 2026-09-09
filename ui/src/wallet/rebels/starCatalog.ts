// Unpacking the sky, and putting it where the game can see it.

import { STAR_DATA, STAR_COUNT } from "./starCatalogData";

export interface Star {
  /** Right ascension and declination in radians, J2000. */
  ra: number;
  dec: number;
  /** Apparent magnitude: how bright it looks from Earth. LOWER IS BRIGHTER,
   *  and the scale is logarithmic — a step of 5 is a hundredfold. */
  mag: number;
  /** B-V colour index. Around -0.3 for a hot blue star, 0 for white, 1.5 for a
   *  cool red one. */
  ci: number;
}

let cache: Star[] | null = null;

/** The catalogue, decoded once. */
export function stars(): Star[] {
  if (cache) return cache;
  const bin = atob(STAR_DATA);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);

  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const o = i * 6;
    out.push({
      ra: (view.getUint16(o, true) / 65535) * Math.PI * 2,
      dec: (view.getInt16(o + 2, true) / 32767) * (Math.PI / 2),
      mag: view.getUint8(o + 4) / 20 - 2,
      ci: view.getUint8(o + 5) / 100 - 0.5,
    });
  }
  cache = out;
  return out;
}

/**
 * Where a star sits in the game's world, as a direction.
 *
 * Celestial north is +Y, which is also the globe's north pole, so Earth spins
 * under a sky whose pole is over its own. The MINUS on z is not a typo and not
 * cosmetic: right ascension increases eastward, and a sky is seen from the
 * INSIDE, so without it the whole sky comes out mirrored and every constellation
 * is its own reflection. That is the single easiest thing to get wrong here and
 * the hardest to notice, which is why there is a test for Orion's shape and for
 * which side of Polaris the Plough sits on.
 */
export function starDirection(ra: number, dec: number): [number, number, number] {
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), Math.sin(dec), -cd * Math.sin(ra)];
}

/**
 * Where a direction lands on an equirectangular texture, as fractions of the
 * image from its top left.
 *
 * This has to match three's own equirectangular sampling exactly, which is
 *   u = atan2(d.z, d.x) / 2pi + 0.5,  v = asin(d.y) / pi + 0.5
 * with v = 1 at the top of the image. Anything else and the sky is rotated or
 * flipped by an amount nobody can eyeball.
 */
export function skyUv(dir: [number, number, number]): [number, number] {
  const u = Math.atan2(dir[2], dir[0]) / (Math.PI * 2) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / Math.PI + 0.5;
  return [u, 1 - v];
}

/** Straight from the catalogue to the image, which is what the painter uses. */
export function starUv(ra: number, dec: number): [number, number] {
  return skyUv(starDirection(ra, dec));
}

/**
 * A star's colour from its B-V index, as 0-255 channels.
 *
 * A rough fit rather than a spectrum: enough that Betelgeuse is orange, Rigel
 * is blue-white and the sky is not uniformly grey. Real stars are far less
 * colourful to the eye than pictures suggest, so this is deliberately gentle —
 * a sky of saturated jewels looks like a screensaver.
 */
export function starColour(ci: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2.0, ci));
  /* Blue-white through white to orange-red. */
  const r = t < 0 ? 0.82 + t * 0.15 : Math.min(1, 0.82 + t * 0.18);
  const g = t < 0 ? 0.88 + t * 0.05 : Math.max(0.55, 0.9 - t * 0.16);
  const b = t < 0 ? 1 : Math.max(0.45, 1 - t * 0.34);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Galactic latitude for a direction, in radians.
 *
 * Used to paint the Milky Way where it actually is. The north galactic pole
 * sits at right ascension 12h 51.4m, declination +27.13 degrees, which is a
 * measured constant rather than a choice, so the band ends up crossing Cygnus
 * and Sagittarius the way it does in the sky.
 */
const NGP_RA = (192.85948 * Math.PI) / 180;
const NGP_DEC = (27.12825 * Math.PI) / 180;

export function galacticLatitude(ra: number, dec: number): number {
  return Math.asin(
    Math.max(-1, Math.min(1,
      Math.sin(dec) * Math.sin(NGP_DEC) +
      Math.cos(dec) * Math.cos(NGP_DEC) * Math.cos(ra - NGP_RA))),
  );
}
