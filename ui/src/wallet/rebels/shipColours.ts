// Repainting the ships.
//
// WHY THIS IS POSSIBLE AT ALL
// ---------------------------
// Geoff noticed it before I did: "each ship type seems to have the exact same
// colors... blue, orange, grey tones, engine glow." He is right, and it is not
// a coincidence. Every ship in the pack samples the same handful of flat
// swatches out of one shared atlas. I sampled the actual UVs of a fighter, a
// cruiser and a station against the atlas pixels and counted what they touch:
//
//   #4a779a  blue          22.6%   the main hull
//   #444348  dark grey     13.9%   panelling, with #43494e #535257 #2b2f33
//   #f7ae50  orange        11.5%   markings and trim
//   #77767b  light grey     4.0%   edges, with #8b8a8f #9d9ca1 #b4b6c1
//   #00ffdd  cyan           2.2%   engine glow
//
// Five groups, which is exactly the five he guessed at. So a repaint does not
// need a new texture per ship or a new material per part: it needs the shader
// to notice which of the five a pixel belongs to and substitute a colour.
//
// HOW THE SUBSTITUTION KEEPS THE ART
// ----------------------------------
// Naively replacing a colour flattens the model, because the swatches are not
// quite flat — there is shading baked into them, and that shading is most of
// what makes the low-poly look work. So the pixel's own BRIGHTNESS is kept and
// only the hue and saturation are replaced, with the brightness slider acting
// as a multiplier on what was already there. Repainting a ship white leaves
// every panel line still visible.
//
// Classification is by hue and saturation rather than by exact match, because
// the atlas is a lossy webp and the same swatch is not the same three bytes
// everywhere in it.

import * as THREE from "three";

export type PartKey = "hull1" | "hull2" | "accent" | "highlight" | "engine";

/** A pattern laid over a part's colour. Not a texture: computed from the
 *  model's own shape, so it scales with the hull and needs no new art. */
export type Overlay = "none" | "lines" | "hex" | "camo";
export const OVERLAYS: Overlay[] = ["none", "lines", "hex", "camo"];

export interface PartColour {
  /** 0-360. */
  hue: number;
  /** 0-1. */
  sat: number;
  /**
   * A multiplier on the pixel's own brightness. 1 is the art as drawn.
   *
   * It runs from 0 to 6, and both ends matter. At 0 the part is BLACK, whatever
   * else is set. At 6 the DARKEST swatch in the palette clears 1.0, so with
   * saturation at zero every part can be made pure white. The old range of 0.2
   * to 2.5 could reach neither, which is what Geoff ran into: "there's no way
   * to get a black color... I thought it would go to pure white, but that
   * doesn't happen either."
   *
   * Six rather than four because the darkest swatch is not the one you would
   * guess. The obvious candidate is the dark panelling #444348 at value 0.28,
   * where four would have been ample; the real floor is the deep panel #2b2f33
   * at 0.20, and four times that is 0.8, which is a light grey. A test found
   * that, not an eye.
   */
  bright: number;
  /** The pattern over it, if any. */
  overlay: Overlay;
}

export interface ShipPaint {
  hull1: PartColour;
  hull2: PartColour;
  accent: PartColour;
  highlight: PartColour;
  engine: PartColour;
}

/** What each control is called, in the order they are shown. */
export const PARTS: Array<{ key: PartKey; label: string; note: string }> = [
  { key: "hull1", label: "Hull 1", note: "The main plating. The blue, as drawn." },
  { key: "hull2", label: "Hull 2", note: "The dark panelling under and between it." },
  { key: "accent", label: "Accent", note: "Markings, stripes and trim. The orange." },
  { key: "highlight", label: "Highlight", note: "Light edges and raised surfaces." },
  { key: "engine", label: "Engine", note: "The glow. Brightness above 1 makes it burn." },
];

/** The art as Synty drew it: every part left exactly where it started. */
export const FACTORY: ShipPaint = {
  hull1: { hue: 205, sat: 0.52, bright: 1, overlay: "none" },
  hull2: { hue: 260, sat: 0.07, bright: 1, overlay: "none" },
  accent: { hue: 34, sat: 0.68, bright: 1, overlay: "none" },
  highlight: { hue: 260, sat: 0.04, bright: 1, overlay: "none" },
  engine: { hue: 172, sat: 1, bright: 1, overlay: "none" },
};

/* ---- what each swatch actually looks like ----
   The chip beside a part's name has to show what that part will BE, and the
   shader keeps the pixel's own brightness rather than replacing it. So the chip
   needs the brightness the real swatch has, or a hull painted deep blue would
   show a chip of pale blue and the two would disagree — which is exactly what
   Geoff saw: the ship changed and the swatches did not follow it honestly.

   These are the value channels of the actual palette, read off the atlas:
   blue #4a779a, dark grey #444348, orange #f7ae50, light grey #9d9ca1 and the
   cyan #00ffdd. */
const REFERENCE_VALUE: Record<PartKey, number> = {
  hull1: 0.60,
  hull2: 0.28,
  accent: 0.97,
  highlight: 0.63,
  engine: 1.0,
};

/**
 * The colour to paint a part's chip: the same sum the shader does, in CSS.
 *
 * Converted through HSL because that is what CSS speaks and HSV is what the
 * shader uses; doing it by hand rather than approximating keeps the chip and
 * the ship in agreement at every slider position, including the extremes where
 * an approximation would drift.
 */
export function chipColour(key: PartKey, paint: ShipPaint): string {
  const p = paint[key];
  const v = Math.max(0, Math.min(1, REFERENCE_VALUE[key] * p.bright));
  const sv = Math.max(0, Math.min(1, p.sat));
  /* HSV to HSL: the lightness is the value less half the saturation it carries,
     and the saturation has to be restated against that new lightness. */
  const l = v * (1 - sv / 2);
  const sl = l <= 0 || l >= 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return `hsl(${Math.round(p.hue)} ${Math.round(sl * 100)}% ${Math.round(l * 100)}%)`;
}

const KEY = "dd69.rebels.paint";

export function loadPaint(): ShipPaint {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      const out = { ...FACTORY };
      for (const { key } of PARTS) {
        const p = v[key];
        if (p && typeof p.hue === "number") {
          out[key] = {
            hue: clamp(p.hue, 0, 360),
            sat: clamp(p.sat, 0, 1),
            bright: clamp(p.bright, 0, 6),
            overlay: OVERLAYS.includes(p.overlay) ? p.overlay : "none",
          };
        }
      }
      return out;
    }
  } catch {
    /* nothing saved, or unreadable */
  }
  return { ...FACTORY };
}

export function savePaint(p: ShipPaint): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full */ }
}

function clamp(n: unknown, lo: number, hi: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, v));
}

/* ---- the shader ----
   Injected into whatever material the model arrived with, so nothing about the
   loading or the atlas changes. It runs after the texture has been sampled and
   before anything else touches the colour. */

/* ---- WHICH COLOUR SPACE THE WORK HAPPENS IN ----

   This is the whole of the bug Geoff hit: "I changed the slider to try to make
   a bright pink engine color... on the ship it's a light grey."

   The shader runs after three has sampled the atlas, and three does not hand
   over the colour that is in the file. It converts an sRGB texture into LINEAR
   working space on the way in, because that is the only space in which adding
   and multiplying light is physically meaningful. The palette I measured off
   the atlas is in sRGB. So every number in the classifier was being compared
   against a colour that had been moved.

   Measured, rather than assumed:

     swatch          sRGB hue   linear hue   engine mask
     #00ffdd cyan      172deg      163deg       0.59

   Fifty-nine percent. So the shader mixed 59% of the requested pink with 41%
   of the original cyan, and pink over cyan is a desaturated grey. Exactly what
   he saw, and it would have been impossible to reach any colour cleanly.

   It was worse than one bad swatch. Linear space crushes mid-greys downward —
   the light edge #9d9ca1 reads 0.63 in sRGB and 0.36 in linear — so the split
   between "panelling" and "edges" put almost every grey on the dark side, and
   the Highlight control did nearly nothing. And the replacement colour was
   being written as if it were linear and then gamma-encoded on the way out, so
   a requested rgb(255,0,170) arrived on screen as rgb(255,0,213).

   The fix is not to retune anything. It is to convert back to sRGB, do all the
   work in the space the palette was measured in, and convert to linear again at
   the end. With that in place every swatch classifies at 1.00 and the colour the
   slider asks for is the colour that appears, to the byte.

   THE ONE REAL LIMIT, which is worth knowing about rather than discovering:
   the pixel's own brightness is KEPT, and multiplied by the brightness slider.
   That is what preserves the baked shading and every panel line, and it means a
   part can be given any hue and any saturation but its lightness is anchored to
   the art. The dark panelling is dark because #444348 is dark; painting it
   canary yellow gives a dark canary yellow until the brightness slider is
   raised. Nothing can exceed white. */

const CLASSIFY = /* glsl */`
  /* Back to the space the palette was measured in, and forwards again after. */
  vec3 rebelsToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
  }
  vec3 rebelsToLinear(vec3 c) {
    return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  /* rgb -> hue in turns, saturation, and value. */
  vec3 rebelsHsv(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    float h = 0.0;
    if (d > 0.0001) {
      if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else                h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, mx > 0.0 ? d / mx : 0.0, mx);
  }

  vec3 rebelsRgb(vec3 hsv) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + hsv.x * 6.0, 6.0);
    return hsv.z * (1.0 - hsv.y * clamp(min(k, 4.0 - k), 0.0, 1.0));
  }

  /* How near a hue is to a target: 1 at the target, falling to 0 at 'width'
     away. Hues wrap, so the distance is the shorter way round. */
  float rebelsHueNear(float h, float target, float width) {
    float d = abs(h - target);
    d = min(d, 1.0 - d);
    return 1.0 - smoothstep(0.0, width, d);
  }

  /* ---- the overlays ----
     Computed from the model's OWN SHAPE rather than from a texture, for one
     hard reason: every ship's UVs occupy a tiny island of the shared atlas —
     a fighter's are a tenth of it across — so a pattern drawn in UV space would
     be a couple of texels wide and read as noise. Object space has no such
     problem, and it costs no art and no download.

     The position is divided by the model's longest side before it arrives, so
     a stripe is the same width on a 13-unit fighter and a 565-unit station.
     Without that the same setting would be bold on one and invisible on the
     other. */

  /* Diagonal stripes down the hull. */
  float rebelsLines(vec3 p) {
    float t = (p.x + p.y * 0.6 + p.z * 0.35) * 26.0;
    return smoothstep(0.42, 0.5, abs(fract(t) - 0.5)) ;
  }

  /* A hex grid, seen down the ship's length: the classic panel pattern. Built
     from the standard hexagonal distance, which is the max of three axis
     projections sixty degrees apart. */
  float rebelsHex(vec3 p) {
    vec2 q = p.xz * 15.0;
    vec2 a = mod(q, vec2(1.0, 1.732)) - vec2(0.5, 0.866);
    vec2 b = mod(q + vec2(0.5, 0.866), vec2(1.0, 1.732)) - vec2(0.5, 0.866);
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float d = max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));
    return smoothstep(0.36, 0.44, d);
  }

  /* Camouflage: three octaves of value noise, thresholded into blobs. */
  float rebelsNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 e = vec2(0.0, 1.0);
    float n = 0.0;
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      float h = fract(sin(dot(i + o, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      vec3 w = mix(1.0 - f, f, o);
      n += h * w.x * w.y * w.z;
    }
    return n;
  }
  float rebelsCamo(vec3 p) {
    float n = rebelsNoise(p * 7.0) * 0.6 + rebelsNoise(p * 15.0) * 0.3 + rebelsNoise(p * 31.0) * 0.1;
    return smoothstep(0.46, 0.54, n);
  }

  float rebelsOverlay(int kind, vec3 p) {
    if (kind == 1) return rebelsLines(p);
    if (kind == 2) return rebelsHex(p);
    if (kind == 3) return rebelsCamo(p);
    return 0.0;
  }
`;

/* ---- the tuning, in ONE place ----
   These are the numbers the classifier runs on, and they are exported so the
   tests can drive the very same figures rather than a copy of them that drifts.
   Every one comes from sampling the atlas through real ship UVs, not from
   taste. */
export const TUNING = {
  /** Hue in turns, and how far either side still counts. */
  engineHue: 0.478, engineWidth: 0.055, engineMinSat: 0.55, engineMaxSat: 0.8,
  engineMinVal: 0.6, engineMaxVal: 0.85,
  /* The blue's minimum saturation is high on purpose. The deepest panelling,
     #2b2f33, is a very slightly BLUE grey: its hue is 210 degrees, right on the
     hull's, and at the old threshold of 0.12 it was being half-claimed as hull
     and half as panel, so it only ever repainted half way. The hull swatch sits
     at 0.52 saturation and that panel at 0.16, so there is a wide gap to put
     the line in, and a test now stands on it. */
  blueHue: 0.572, blueWidth: 0.085, blueMinSat: 0.28, blueMaxSat: 0.42,
  orangeHue: 0.094, orangeWidth: 0.075, orangeMinSat: 0.20, orangeMaxSat: 0.40,
  /** Below this saturation a pixel is a grey rather than a colour. Raised to
   *  match, so the same near-neutral panel is fully a grey. */
  greyMaxSat: 0.22, greyFadeSat: 0.34,
  /** Where the greys divide into panelling and edges. Measured in sRGB, where
   *  the dark panel sits at 0.28 and the light edge at 0.63. */
  greySplitLo: 0.40, greySplitHi: 0.52,
} as const;

const T = TUNING;

const RECOLOUR = /* glsl */`
  {
    /* sRGB for the whole of this block. See the note above: the palette was
       measured in sRGB and three hands over linear. */
    vec3 base = rebelsToSrgb(diffuseColor.rgb);
    vec3 hsvc = rebelsHsv(base);
    float h = hsvc.x, s = hsvc.y, v = hsvc.z;

    /* Five masks. They are deliberately exclusive: a pixel is one part of the
       ship, and letting two claim it makes the seams crawl as the sliders
       move. Colour wins over grey, and the engine wins over everything, since
       it is the most distinctive swatch in the atlas by a distance. */
    float engine    = rebelsHueNear(h, ${T.engineHue}, ${T.engineWidth}) * smoothstep(${T.engineMinSat}, ${T.engineMaxSat}, s) * smoothstep(${T.engineMinVal}, ${T.engineMaxVal}, v);
    float blue      = rebelsHueNear(h, ${T.blueHue}, ${T.blueWidth}) * smoothstep(${T.blueMinSat}, ${T.blueMaxSat}, s) * (1.0 - engine);
    float orange    = rebelsHueNear(h, ${T.orangeHue}, ${T.orangeWidth}) * smoothstep(${T.orangeMinSat}, ${T.orangeMaxSat}, s) * (1.0 - engine);
    float colourful = clamp(engine + blue + orange, 0.0, 1.0);
    float grey      = (1.0 - colourful) * (1.0 - smoothstep(${T.greyMaxSat}, ${T.greyFadeSat}, s));
    /* The greys split by how light they are, which is what separates panelling
       from the edges catching the light. */
    float light     = grey * smoothstep(${T.greySplitLo}, ${T.greySplitHi}, v);
    float dark      = grey * (1.0 - smoothstep(${T.greySplitLo}, ${T.greySplitHi}, v));

    vec3 painted = base;
    vec3 pp = vRebelsPos;

    /* The overlay DARKENS rather than replacing, so a pattern reads as paint
       laid over the colour instead of as a second colour fighting it, and a
       part keeps its identity whatever is drawn on it. */
    #define REBELS_PAINT(mask, hue, sat, bright, over) \\
      { \\
        vec3 c = rebelsRgb(vec3(hue, sat, clamp(v * bright, 0.0, 1.0))); \\
        c *= 1.0 - 0.45 * rebelsOverlay(int(over + 0.5), pp); \\
        painted = mix(painted, c, mask); \\
      }

    REBELS_PAINT(dark,   uPaintHull2H,     uPaintHull2S,     uPaintHull2B,     uPaintHull2O)
    REBELS_PAINT(light,  uPaintHighlightH, uPaintHighlightS, uPaintHighlightB, uPaintHighlightO)
    REBELS_PAINT(blue,   uPaintHull1H,     uPaintHull1S,     uPaintHull1B,     uPaintHull1O)
    REBELS_PAINT(orange, uPaintAccentH,    uPaintAccentS,    uPaintAccentB,    uPaintAccentO)
    REBELS_PAINT(engine, uPaintEngineH,    uPaintEngineS,    uPaintEngineB,    uPaintEngineO)

    diffuseColor.rgb = rebelsToLinear(painted);
  }
`;

const UNIFORM_NAMES = [
  "Hull1", "Hull2", "Accent", "Highlight", "Engine",
] as const;
export const PART_ORDER: PartKey[] = ["hull1", "hull2", "accent", "highlight", "engine"];

/** A live handle: change the paint and the model repaints without reloading. */
export interface PaintHandle {
  apply(paint: ShipPaint): void;
}

/**
 * Make every material on a model repaintable.
 *
 * Returns a handle rather than taking a fixed colour, because a slider that
 * only takes effect on the next model load is not a slider.
 */
/**
 * How big this model is IN THE SPACE THE SHADER SEES, so the overlays come out
 * the same visible size on every hull.
 *
 * That qualifier is the whole function, and getting it wrong is why the
 * overlays did nothing at all. The obvious version measures the object with
 * Box3.setFromObject, which walks world matrices — and by the time a ship gets
 * here it has been through unitCopy, which normalises it to a one-unit box by
 * putting a scale on a WRAPPER. So the box came back as 1 while the vertex
 * shader's `position` attribute, which unitCopy never touches, still ran to
 * about seven either side on a fighter.
 *
 * Dividing by 1 instead of by 13.3 made every pattern thirteen times too fine:
 * three hundred and fifty stripes across a hull instead of twenty-six, which is
 * finer than the screen can draw, so it averaged out to a flat tint and read as
 * nothing happening. Geoff: "there are texture buttons for the ships, but none
 * of them work."
 *
 * So this reads the position values themselves. No matrices, no world space,
 * no scale anywhere: exactly the numbers the shader will divide.
 */
export function patternSpan(root: THREE.Object3D): number {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute("position");
    if (!pos) return;
    /* Sampled. A station has tens of thousands of vertices and the answer is
       an overall size, not a precise hull. */
    const step = Math.max(1, Math.floor(pos.count / 600));
    for (let i = 0; i < pos.count; i += step) {
      box.expandByPoint(v.fromBufferAttribute(pos, i));
    }
  });
  if (box.isEmpty()) return 1;
  const size = new THREE.Vector3();
  box.getSize(size);
  return Math.max(size.x, size.y, size.z, 0.001);
}

export function makeRepaintable(root: THREE.Object3D): PaintHandle {
  const uniforms: Array<Record<string, { value: number }>> = [];

  const span = patternSpan(root);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const own: Record<string, { value: number }> = {};
      for (const name of UNIFORM_NAMES) {
        own[`uPaint${name}H`] = { value: 0 };
        own[`uPaint${name}S`] = { value: 0 };
        own[`uPaint${name}B`] = { value: 1 };
        own[`uPaint${name}O`] = { value: 0 };
      }
      own.uPaintSpan = { value: span };
      uniforms.push(own);

      const index = uniforms.length;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, own);
        /* The overlays need to know where on the hull they are, and nothing in
           the standard shader carries object space through to the fragment. One
           varying, set from the position attribute and divided by the model's
           own span, so the pattern is in units of "fraction of this ship". */
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vRebelsPos;\nuniform float uPaintSpan;\nvoid main() {")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRebelsPos = position / uPaintSpan;");
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", `varying vec3 vRebelsPos;\n${Object.keys(own).map((k) => `uniform float ${k};`).join("\n")}\n${CLASSIFY}\nvoid main() {`)
          .replace("#include <map_fragment>", `#include <map_fragment>\n${RECOLOUR}`);
      };
      /* Materials are cached by their program key, so two of them with the
         same settings would share one compiled shader AND one set of uniforms,
         and every ship in the Market would take the last one's colours. A
         distinct key per material keeps them apart. Captured now rather than
         read when the function runs, which is after every material is pushed
         and so would give them all the same number. */
      mat.customProgramCacheKey = () => `rebels-paint-${index}`;
      mat.needsUpdate = true;
    }
  });

  return {
    apply(paint: ShipPaint) {
      for (const set of uniforms) {
        PART_ORDER.forEach((key, i) => {
          const name = UNIFORM_NAMES[i];
          const p = paint[key];
          set[`uPaint${name}H`].value = (p.hue % 360) / 360;
          set[`uPaint${name}S`].value = p.sat;
          set[`uPaint${name}B`].value = p.bright;
          set[`uPaint${name}O`].value = OVERLAYS.indexOf(p.overlay ?? "none");
        });
      }
    },
  };
}
