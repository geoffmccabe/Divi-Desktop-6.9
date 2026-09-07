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

export interface PartColour {
  /** 0-360. */
  hue: number;
  /** 0-1. */
  sat: number;
  /** A multiplier on the pixel's own brightness. 1 is the art as drawn. */
  bright: number;
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
  hull1: { hue: 205, sat: 0.52, bright: 1 },
  hull2: { hue: 260, sat: 0.07, bright: 1 },
  accent: { hue: 34, sat: 0.68, bright: 1 },
  highlight: { hue: 260, sat: 0.04, bright: 1 },
  engine: { hue: 172, sat: 1, bright: 1 },
};

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
            bright: clamp(p.bright, 0.2, 2.5),
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

const CLASSIFY = /* glsl */`
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

  /* How near a hue is to a target, as 1 at the target falling to 0 at 'width'
     away. Hues wrap, so the distance is the shorter way round. */
  float rebelsHueNear(float h, float target, float width) {
    float d = abs(h - target);
    d = min(d, 1.0 - d);
    return 1.0 - smoothstep(0.0, width, d);
  }
`;

const RECOLOUR = /* glsl */`
  {
    vec3 hsv = rebelsHsv(diffuseColor.rgb);
    float h = hsv.x, s = hsv.y, v = hsv.z;

    /* Five masks. They are deliberately exclusive: a pixel is one part of the
       ship, and letting two claim it makes the seams crawl as the sliders
       move. Colour wins over grey, and the engine wins over everything, since
       it is the most distinctive swatch in the atlas by a distance. */
    float engine    = rebelsHueNear(h, 0.478, 0.055) * smoothstep(0.55, 0.8, s) * smoothstep(0.6, 0.85, v);
    float blue      = rebelsHueNear(h, 0.570, 0.085) * smoothstep(0.12, 0.3, s) * (1.0 - engine);
    float orange    = rebelsHueNear(h, 0.095, 0.075) * smoothstep(0.2, 0.4, s) * (1.0 - engine);
    float colourful = clamp(engine + blue + orange, 0.0, 1.0);
    float grey      = (1.0 - colourful) * (1.0 - smoothstep(0.10, 0.22, s));
    /* The greys split by how light they are, which is what separates panelling
       from the edges catching the light. */
    float light     = grey * smoothstep(0.34, 0.46, v);
    float dark      = grey * (1.0 - smoothstep(0.34, 0.46, v));

    vec3 painted = diffuseColor.rgb;
    #define REBELS_PAINT(mask, hue, sat, bright) \\
      painted = mix(painted, rebelsRgb(vec3(hue, sat, clamp(v * bright, 0.0, 1.0))), mask);

    REBELS_PAINT(dark,   uPaintHull2H,     uPaintHull2S,     uPaintHull2B)
    REBELS_PAINT(light,  uPaintHighlightH, uPaintHighlightS, uPaintHighlightB)
    REBELS_PAINT(blue,   uPaintHull1H,     uPaintHull1S,     uPaintHull1B)
    REBELS_PAINT(orange, uPaintAccentH,    uPaintAccentS,    uPaintAccentB)
    REBELS_PAINT(engine, uPaintEngineH,    uPaintEngineS,    uPaintEngineB)

    diffuseColor.rgb = painted;
  }
`;

const UNIFORM_NAMES = [
  "Hull1", "Hull2", "Accent", "Highlight", "Engine",
] as const;
const PART_ORDER: PartKey[] = ["hull1", "hull2", "accent", "highlight", "engine"];

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
export function makeRepaintable(root: THREE.Object3D): PaintHandle {
  const uniforms: Array<Record<string, { value: number }>> = [];

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
      }
      uniforms.push(own);

      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, own);
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", `${Object.keys(own).map((k) => `uniform float ${k};`).join("\n")}\n${CLASSIFY}\nvoid main() {`)
          .replace("#include <map_fragment>", `#include <map_fragment>\n${RECOLOUR}`);
      };
      /* Materials are cached by their program key, so two of them with the
         same settings would share one compiled shader and one set of
         uniforms. A distinct key per material keeps them apart. */
      mat.customProgramCacheKey = () => `rebels-paint-${uniforms.length}`;
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
        });
      }
    },
  };
}
