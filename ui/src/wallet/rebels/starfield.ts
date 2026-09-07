// The sky behind everything.
//
// WHAT WAS ASKED FOR, AND WHAT THIS GAME CAN ACTUALLY DO
// -----------------------------------------------------
// The brief recommended a hybrid: a faint Milky Way texture for the background
// and the bright stars rendered separately as points, into their OWN scene with
// their own camera, drawn first and then cleared from the depth buffer before
// the game draws on top.
//
// That second half is not available here, and it is worth saying why rather
// than quietly doing half of it. Divi Rebels does not own its renderer. The
// game borrows the Node Map's live scene, camera and canvas — that is the whole
// point of it, so the towers you fly between are the real towers — and
// react-globe.gl calls render() itself on its own loop. There is no seam to
// insert a second pass into, and forking the map's renderer to get one would
// be a far larger and more fragile change than a starfield is worth.
//
// So this takes the other option the brief offered, the one it called the
// fastest good solution: a single equirectangular image on scene.background.
// That gives exactly the behaviour that matters, and three does the work:
//
//   fly straight at a star   it stays the same size and in the same direction
//   turn the ship            the sky sweeps past correctly
//   fly round Earth          Earth moves against the sky and hides what is behind
//   fly for an hour          the sky is no nearer than it was
//
// WHERE THE ACCURACY COMES FROM
// -----------------------------
// Not from NASA's map, which is 124MB and would have to be downloaded. The
// stars are PAINTED INTO the texture here, from the real catalogue, at their
// real positions and brightnesses and colours. That gets the accuracy the
// separate-points approach was wanted for, without needing a render pass this
// game cannot have.
//
// THE TRADE, STATED PLAINLY
// -------------------------
// A texture has one fixed angular resolution. At 4096 across, a pixel is 5.3
// arcminutes of sky; the game's 70-degree field across a typical window is
// about 3. So the sky is roughly half the resolution of the screen and the
// brightest stars are drawn with a soft falloff rather than as single pixels,
// which reads as a star rather than as a lit texel. If the game ever gains a
// zoom, this is the thing that will show first, and the answer then is the
// separate points layer — which needs the renderer, which needs the map to hand
// one over.

import * as THREE from "three";
import { stars, starUv, starColour, galacticLatitude } from "./starCatalog";

/** Wide enough that a pixel is finer than the eye at this field of view, and
 *  small enough to be a 33MB texture rather than a 134MB one. */
const WIDTH = 4096;
const HEIGHT = 2048;

/**
 * How bright to draw a star of a given magnitude, 0 to 1.
 *
 * Magnitudes are logarithmic and backwards: every 5 steps is a hundredfold, and
 * smaller is brighter. Mapping them linearly would make the sky a flat wash of
 * identical dots and throw away the one thing a real catalogue is for. This
 * keeps the hierarchy — Sirius at -1.44 is unmistakable, a magnitude 6 star is
 * a faint speck — while compressing the range enough that the faint ones do not
 * vanish into the background entirely.
 */
function brightness(mag: number): number {
  return Math.max(0.06, Math.min(1, Math.pow(2.512, (1.6 - mag) / 3.6)));
}

/** And how wide, in pixels. Only the brightest few are more than a dot. */
function radius(mag: number): number {
  if (mag < 0) return 3.2;
  if (mag < 1.5) return 2.6;
  if (mag < 3) return 2.0;
  if (mag < 4.5) return 1.5;
  return 1.1;
}

/**
 * Paint the whole sky into a canvas.
 *
 * Kept separate from the texture so it can be called from a test, where there
 * is no WebGL: what matters is that a star lands on the right pixel, and that
 * is checkable without a GPU.
 */
export function paintSky(
  ctx: CanvasRenderingContext2D,
  width = WIDTH,
  height = HEIGHT,
): void {
  ctx.fillStyle = "#00010a";
  ctx.fillRect(0, 0, width, height);

  /* ---- the Milky Way ----
     Painted where it is rather than where it looks nice: galactic latitude is
     computed from the measured position of the north galactic pole, so the band
     runs through Cygnus and Sagittarius as it should. Drawn coarsely, in blocks,
     because it is a faint wash and a per-pixel loop over eight million pixels
     for a wash is a waste of a second of someone's life. */
  const STEP = 4;
  for (let y = 0; y < height; y += STEP) {
    const dec = (0.5 - y / height) * Math.PI;
    for (let x = 0; x < width; x += STEP) {
      const ra = (0.5 - x / width) * Math.PI * 2;
      const b = Math.abs(galacticLatitude(((ra % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), dec));
      /* Brightest along the plane, gone by about twenty degrees off it. */
      const glow = Math.max(0, 1 - b / 0.35) ** 2.2;
      if (glow < 0.01) continue;
      /* A little structure, so it is not a smooth airbrushed stripe. */
      const mottle = 0.75 + 0.25 * Math.sin(x * 0.021) * Math.cos(y * 0.037);
      const a = glow * mottle * 0.5;
      ctx.fillStyle = `rgba(150, 160, 205, ${a.toFixed(3)})`;
      ctx.fillRect(x, y, STEP, STEP);
    }
  }

  /* ---- the stars ----
     Faintest first, so the bright ones are drawn over the top of their
     neighbours rather than under them. */
  const all = stars().slice().sort((a, b) => b.mag - a.mag);
  for (const s of all) {
    const [u, v] = starUv(s.ra, s.dec);
    const x = u * width;
    const y = v * height;
    const b = brightness(s.mag);
    const r = radius(s.mag);
    const [cr, cg, cb] = starColour(s.ci);

    /* A soft edge rather than a hard dot: at this resolution a single lit pixel
       reads as a texture artefact, and a small falloff reads as a star. */
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${b.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(${cr}, ${cg}, ${cb}, ${(b * 0.55).toFixed(3)})`);
    g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    /* The image wraps in longitude, so a star within a few pixels of the seam
       has to be drawn at both ends or it is cut in half. */
    if (x < r) {
      ctx.translate(width, 0);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.translate(-width, 0);
    } else if (x > width - r) {
      ctx.translate(-width, 0);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.translate(width, 0);
    }
  }
}

/** What was on the scene before, so leaving the game puts the map back. */
export interface SkyHandle {
  restore(): void;
}

/**
 * Put the sky behind the game, and hand back the means to undo it.
 *
 * The scene belongs to the Node Map, which is used outside the game, so this
 * borrows it rather than owning it: whatever background was there is returned
 * on the way out, exactly as the camera's near and far planes are.
 */
export function installSky(scene: THREE.Scene): SkyHandle {
  const had = scene.background;
  let texture: THREE.CanvasTexture | null = null;
  let gone = false;

  if (typeof document === "undefined") {
    return { restore() { scene.background = had; } };
  }

  /* PAINTED ON THE NEXT TICK, not this one.
     Eight thousand nine hundred radial gradients and half a million blocks of
     Milky Way is most of a second of work, and doing it inside attach() would
     freeze the panel just as it opened — the one moment a player is watching it.
     A tick later the game is already up and the sky arrives a moment after,
     which nobody notices and nobody waits for. */
  const build = () => {
    if (gone) return;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    paintSky(ctx, WIDTH, HEIGHT);
    if (gone) return;

    texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    /* Linear rather than mipmapped: mipmaps average faint stars away, which is
       exactly the failure the brief warned about, and at this size the memory
       saving is not worth losing half the sky for. */
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    scene.background = texture;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
  };
  setTimeout(build, 0);

  return {
    restore() {
      gone = true;
      scene.background = had;
      texture?.dispose();
      texture = null;
    },
  };
}
