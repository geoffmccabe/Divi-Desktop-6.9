// The skin on a dropped sphere: the shield mandala, wrapped over the ball.
//
// Geoff, 2026-Sep-13: "The spheres that are captured with loot inside, they
// have garbled Text on them. Put instead just the T1 or T2 on each one, on
// opposite sides, and don't put on any more text. Try to wrap our shield
// mandala on them and have it rotate, one on each hemisphere of these, so
// they'll have an interesting and beautiful skin on them that's moving and has
// beautiful patterns."
//
// WHY THE TEXT WAS GARBLED
// ------------------------
// The old skin printed "T1 D" at 88 pixels onto a canvas 128 pixels tall, and
// that canvas was stretched over the WHOLE ball: three hundred and sixty
// degrees across and a hundred and eighty from pole to pole. Glyphs that tall
// ran from one pole to the other and smeared as they converged. The label here
// is a fifth of the height and sits on the equator, where an equirectangular
// map has no stretch at all.
//
// HOW THE MANDALA IS WRAPPED
// --------------------------
// Straight onto the ball rather than pasted flat: the mandala's centre goes to
// the pole and its outer ring to the equator, so a distance r from the middle
// of the picture becomes an angle down from the pole. Drawn twice, once from
// each pole, so both hemispheres carry one and there is no bare side.
//
// HOW IT MOVES, FOR NOTHING
// -------------------------
// Turning the picture about the polar axis is nothing more than sliding the
// texture sideways, so the mandala moves without the canvas ever being redrawn.
// The website's three groups (outer, middle, inner) are baked into the RED,
// GREEN and BLUE channels of one shared image, and the shader samples each at
// its own offset: three bands turning at three rates, against each other, for
// three texture reads and no CPU at all. The label is a second, small image
// which is NOT offset, so it stays where it was printed.
//
// One image serves every tier, because only the ground colour differs and that
// is a uniform.

import * as THREE from "three";
import { mandalaRings, OUTER_RADIUS, SITE_ANGULAR_VELOCITY, SPIN_MULTIPLIER, type Band } from "./rebelsMandala";
import { itemTierColour } from "./itemCatalog";

/** The image is twice as wide as it is tall, which is what an equirectangular
 *  map of a sphere has to be for the equator to be undistorted. */
const SKIN_W = 1024;
const SKIN_H = 512;
/** The label needs far less: two short words on the equator. */
const LABEL_W = 512;
const LABEL_H = 256;

/**
 * How fast each band slides, in TURNS a second.
 *
 * Taken from the shield's rate so the two read as the same object: the site's
 * fifteen degrees a second, tripled as Geoff asked, is one turn every eight
 * seconds. The middle band runs against the other two, which is what the
 * website does and what makes the pattern move rather than merely spin.
 */
const TURN = (SITE_ANGULAR_VELOCITY * SPIN_MULTIPLIER) / 360;
export const BAND_TURNS: Record<Band, number> = {
  outer: TURN * 0.5,
  middle: -TURN,
  inner: TURN,
};

/** Which channel each of the website's groups is printed in. */
const CHANNEL: Record<Band, string> = {
  outer: "rgb(255,0,0)",
  middle: "rgb(0,255,0)",
  inner: "rgb(0,0,255)",
};

/**
 * Put a point of the flat mandala onto the ball.
 *
 * `r` is its distance from the middle of the picture and `a` its angle round
 * it. The distance becomes an angle DOWN FROM THE POLE, so the middle of the
 * mandala lands on the pole and its outer ring on the equator; the angle
 * becomes longitude. Returns where that is on the map, from 0 to 1 each way.
 *
 * `north` picks which pole. The ball carries one mandala from each, and since
 * the two are mirror images of one another it does not matter which way up the
 * geometry's own map happens to run.
 */
export function skinUv(r: number, a: number, north: boolean): { u: number; v: number } {
  const down = Math.min(1, r / OUTER_RADIUS) * 0.5;   /* 0 at the pole, 0.5 at the equator */
  let u = a / (Math.PI * 2);
  u -= Math.floor(u);
  return { u, v: north ? down : 1 - down };
}

let skinTex: THREE.Texture | null = null;

/**
 * The mandala, printed once, for every sphere in the game to share.
 *
 * Black ground; each of the three groups in its own colour channel so the
 * shader can turn them separately. Drawn three times side by side and clipped,
 * which is how a line that crosses the seam comes out joined instead of
 * stretched all the way back across the map.
 */
export function mandalaSkinTexture(): THREE.Texture | null {
  if (skinTex) return skinTex;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SKIN_W; canvas.height = SKIN_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SKIN_W, SKIN_H);
  /* Channels must ADD where they cross, not paint over one another. */
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";

  const rings = mandalaRings();
  for (const north of [true, false]) {
    for (const ring of rings) {
      ctx.strokeStyle = CHANNEL[ring.band];
      /* Accents are printed fainter, as they are on the website, where they
         are a grey against the brand colour. */
      ctx.globalAlpha = ring.accent ? 0.55 : 1;
      ctx.beginPath();
      for (let i = 0; i + 5 < ring.verts.length; i += 6) {
        const x0 = ring.verts[i], y0 = ring.verts[i + 1];
        const x1 = ring.verts[i + 3], y1 = ring.verts[i + 4];
        const p0 = skinUv(Math.hypot(x0, y0), Math.atan2(y0, x0), north);
        const p1 = skinUv(Math.hypot(x1, y1), Math.atan2(y1, x1), north);
        /* Shift the far end to whichever copy of the map it is nearest, so a
           segment over the seam is short and in the right direction rather
           than a line right across the picture. */
        let u1 = p1.u;
        if (u1 - p0.u > 0.5) u1 -= 1;
        else if (p0.u - u1 > 0.5) u1 += 1;
        for (const shift of [-1, 0, 1]) {
          ctx.moveTo((p0.u + shift) * SKIN_W, p0.v * SKIN_H);
          ctx.lineTo((u1 + shift) * SKIN_W, p1.v * SKIN_H);
        }
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  const t = new THREE.CanvasTexture(canvas);
  /* Sliding sideways is the whole animation, so it has to wrap. */
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  /* Raw channel values, not colours: no colour-space conversion. */
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  skinTex = t;
  return t;
}

const labelTexes = new Map<number, THREE.Texture>();

/**
 * The tier, twice, on opposite sides of the ball.
 *
 * "T1" and nothing else: Geoff asked for the one-letter mark that used to
 * follow it to go. Printed on the equator, where the map does not stretch, at
 * a size that cannot reach the poles.
 */
export function tierLabelTexture(tier: number): THREE.Texture | null {
  const found = labelTexes.get(tier);
  if (found) return found;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W; canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, LABEL_W, LABEL_H);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(LABEL_H * 0.3)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  /* A quarter and three quarters of the way round: opposite sides, so one of
     them faces the pilot whichever way the ball has turned. */
  for (const at of [0.25, 0.75]) ctx.fillText(`T${tier}`, LABEL_W * at, LABEL_H * 0.5);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  labelTexes.set(tier, t);
  return t;
}

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uBase;
uniform vec3 uInkColour;
uniform vec3 uLabelColour;
uniform sampler2D uInk;
uniform sampler2D uLabel;
uniform vec3 uTurns;
uniform float uTime;
varying vec2 vUv;

void main() {
  /* Three bands, three offsets: turning the picture about the polar axis is
     sliding the map sideways, and nothing else. */
  float o = texture2D(uInk, vec2(vUv.x + uTime * uTurns.x, vUv.y)).r;
  float m = texture2D(uInk, vec2(vUv.x + uTime * uTurns.y, vUv.y)).g;
  float i = texture2D(uInk, vec2(vUv.x + uTime * uTurns.z, vUv.y)).b;
  float ink = clamp(max(max(o, m), i), 0.0, 1.0);
  /* The label does NOT move: it is printed on the ball, not on the pattern. */
  float lab = texture2D(uLabel, vUv).r;
  vec3 c = mix(uBase, uInkColour, ink * 0.85);
  c = mix(c, uLabelColour, lab);
  gl_FragColor = vec4(c, 1.0);
}`;

const skinMats = new Map<number, THREE.Material>();
/** Every skin shares one clock, so a sphere that appears late is in step with
 *  the ones already in the sky. */
const skinClocks: Array<{ value: number }> = [];

/**
 * The material for a sphere of this tier.
 *
 * One per tier and kept: the ground colour and the label are all that differ,
 * and the mandala itself is the same image for every one of them.
 */
export function dropSkinMaterial(tier: number): THREE.Material {
  const found = skinMats.get(tier);
  if (found) return found;
  const base = new THREE.Color(itemTierColour(tier));
  const ink = mandalaSkinTexture();
  const label = tierLabelTexture(tier);
  let mat: THREE.Material;
  if (!ink || !label) {
    /* No canvas (a test, in node): the ball is simply its tier's colour. */
    mat = new THREE.MeshBasicMaterial({ color: base });
  } else {
    /* Ink and print light on a dark ground and dark on a light one, so every
       tier reads. */
    const lum = base.r * 0.3 + base.g * 0.59 + base.b * 0.11;
    const contrast = lum > 0.55 ? new THREE.Color(0x101418) : new THREE.Color(0xf6f8ff);
    const time = { value: 0 };
    skinClocks.push(time);
    mat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: base },
        uInkColour: { value: contrast },
        uLabelColour: { value: contrast },
        uInk: { value: ink },
        uLabel: { value: label },
        uTurns: { value: new THREE.Vector3(BAND_TURNS.outer, BAND_TURNS.middle, BAND_TURNS.inner) },
        uTime: time,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  }
  skinMats.set(tier, mat);
  return mat;
}

/** Move every skin on. Called once a frame, whatever is in the sky. */
export function stepDropSkins(seconds: number): void {
  for (const c of skinClocks) c.value = seconds;
}

/** For the tests, which build the textures more than once. */
export function resetDropSkinsForTests(): void {
  skinTex = null;
  labelTexes.clear();
  skinMats.clear();
  skinClocks.length = 0;
}
