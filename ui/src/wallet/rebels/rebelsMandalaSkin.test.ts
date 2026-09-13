// The skin on a sealed sphere: is the mandala really wrapped on it, and is the
// text finally just the tier?
//
// Run: sh scripts/run-rebels-skin-tests.sh
//
// Geoff: "The spheres that are captured with loot inside, they have garbled
// Text on them. Put instead just the T1 or T2 on each one, on opposite sides,
// and don't put on any more text. Try to wrap our shield mandala on them and
// have it rotate, one on each hemisphere."
//
// Node has no canvas, so one is stood up here that RECORDS what was drawn on
// it. That is better than a real one for this: what matters is not what the
// pixels came out like but that two labels were printed, on the equator, on
// opposite sides, saying "T1" and nothing else.

import * as THREE from "three";
import { readFileSync } from "node:fs";

/* ---- a canvas that remembers ---- */
interface Drawn { text: string; x: number; y: number }
const texts: Drawn[] = [];
const strokes: string[] = [];
let moves = 0;
/* An array rather than a variable: only a closure ever writes to it, and the
   type checker reads that as "still null" at every use below. */
const canvases: Array<{ width: number; height: number }> = [];
const lastCanvas = () => canvases[canvases.length - 1];

function fakeContext(canvas: { width: number; height: number }) {
  return {
    canvas,
    fillStyle: "", strokeStyle: "", font: "", textAlign: "", textBaseline: "",
    lineWidth: 1, lineCap: "", globalAlpha: 1, globalCompositeOperation: "",
    fillRect() {},
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y }); },
    beginPath() {},
    moveTo() { moves++; },
    lineTo() {},
    stroke() { strokes.push(this.strokeStyle as string); },
    drawImage() {},
    clearRect() {},
  };
}
(globalThis as unknown as { document: unknown }).document = {
  createElement(kind: string) {
    if (kind !== "canvas") return {};
    const canvas = {
      width: 0, height: 0,
      getContext: () => fakeContext(canvas),
      /* three reads this when it uploads a CanvasTexture; nothing here does. */
      toDataURL: () => "",
    };
    canvases.push(canvas);
    return canvas;
  },
};

const {
  skinUv, mandalaSkinTexture, tierLabelTexture, dropSkinMaterial, stepDropSkins,
  BAND_TURNS, resetDropSkinsForTests,
} = await import("./rebelsMandalaSkin");
const { OUTER_RADIUS, SITE_ANGULAR_VELOCITY, SPIN_MULTIPLIER } = await import("./rebelsMandala");

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---- the wrap ---- */
{
  /* The middle of the picture goes to the pole and the outer ring to the
     equator, so the mandala covers a whole hemisphere and no more. */
  ok("the middle of the mandala lands on the north pole", near(skinUv(0, 0, true).v, 0));
  ok("and on the south pole for the other one", near(skinUv(0, 0, false).v, 1));
  ok("its outer ring lands on the equator, from both",
     near(skinUv(OUTER_RADIUS, 0, true).v, 0.5) && near(skinUv(OUTER_RADIUS, 0, false).v, 0.5));
  ok("so the two hemispheres meet there and neither side of the ball is bare",
     near(skinUv(OUTER_RADIUS, 1, true).v, skinUv(OUTER_RADIUS, 1, false).v));
  /* Halfway out is halfway down, which is what makes it a wrap rather than a
     flat sticker. */
  ok("halfway out is halfway to the equator", near(skinUv(OUTER_RADIUS / 2, 0, true).v, 0.25));
  /* Angle becomes longitude, and longitude wraps. */
  ok("angle becomes longitude", near(skinUv(100, Math.PI, true).u, 0.5));
  const round = skinUv(100, Math.PI * 2.5, true).u;
  ok("and longitude comes back round", round >= 0 && round < 1 && near(round, 0.25), `${round}`);
  ok("nothing runs off the map",
     [0, 1, 250, OUTER_RADIUS, OUTER_RADIUS * 3].every((r) =>
       [-7, 0, 1, 9].every((a) => {
         const p = skinUv(r, a, true);
         return p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1;
       })));
}

/* ---- one mandala per hemisphere, in three channels ---- */
{
  resetDropSkinsForTests();
  texts.length = 0; strokes.length = 0; moves = 0;
  const tex = mandalaSkinTexture();
  ok("the mandala is printed", !!tex);
  ok("on a map twice as wide as it is tall, or the equator would be stretched",
     !!lastCanvas() && lastCanvas().width === lastCanvas().height * 2,
     `${lastCanvas()?.width}x${lastCanvas()?.height}`);
  ok("it slides sideways, so it has to wrap that way", tex?.wrapS === THREE.RepeatWrapping);
  ok("and not the other way, or the poles would bleed", tex?.wrapT === THREE.ClampToEdgeWrapping);
  ok("its channels are read as numbers, not as colours", tex?.colorSpace === THREE.NoColorSpace);

  const kinds = new Set(strokes);
  ok("all three of the website's groups are printed",
     kinds.has("rgb(255,0,0)") && kinds.has("rgb(0,255,0)") && kinds.has("rgb(0,0,255)"),
     [...kinds].join(" "));
  ok("each in its own channel, so they can be turned separately", kinds.size === 3);
  ok("a great many strokes, which is what a mandala is", moves > 5000, `${moves} segments`);
  /* Three copies side by side: that is how a line over the seam comes out
     joined instead of stretched back across the whole map. */
  ok("drawn three times across, so the seam joins up", moves % 3 === 0, `${moves}`);
  ok("no text on the pattern itself", texts.length === 0, texts.map((t) => t.text).join(","));
  /* Printed once and shared: this is the same image on every sphere. */
  ok("and printed only once, however many spheres there are", mandalaSkinTexture() === tex);
}

/* ---- THE TEXT: just the tier, twice, opposite ---- */
{
  resetDropSkinsForTests();
  texts.length = 0;
  const tex = tierLabelTexture(2);
  ok("a label is made", !!tex);
  ok("exactly two words are printed", texts.length === 2, `${texts.length}: ${texts.map((t) => t.text).join(" ")}`);
  ok("and both are just the tier, with nothing after it",
     texts.every((t) => t.text === "T2"), texts.map((t) => t.text).join(" "));
  ok("no mark letter survives anywhere in them",
     texts.every((t) => /^T\d$/.test(t.text)));
  const w = lastCanvas().width, h = lastCanvas().height;
  ok("they sit on opposite sides of the ball",
     near(Math.abs(texts[0].x - texts[1].x), w / 2, 1e-6),
     `${texts[0].x} and ${texts[1].x} of ${w}`);
  /* On the equator, which is the one line of an equirectangular map with no
     stretch in it. The old label was printed at eighty-eight pixels on a map a
     hundred and twenty-eight tall, so the glyphs ran pole to pole and smeared:
     that is the garbling Geoff saw. */
  ok("on the equator, where the map does not stretch",
     texts.every((t) => near(t.y, h / 2, 1e-6)), `${texts[0].y} of ${h}`);
  ok("and small enough that they cannot reach a pole",
     h * 0.3 < h / 2, "a glyph half the height of the map wraps over the top");
  ok("each tier gets its own", tierLabelTexture(2) === tex && tierLabelTexture(3) !== tex);
}

/* ---- and it moves, for nothing ---- */
{
  resetDropSkinsForTests();
  const mat = dropSkinMaterial(3) as THREE.ShaderMaterial;
  ok("a sphere gets a shader, not a printed picture", !!mat.uniforms);
  ok("one material per tier, kept", dropSkinMaterial(3) === mat);
  ok("different tiers are different grounds",
     (dropSkinMaterial(4) as THREE.ShaderMaterial).uniforms.uBase.value.getHex()
     !== mat.uniforms.uBase.value.getHex());

  ok("the clock starts at nothing", mat.uniforms.uTime.value === 0);
  stepDropSkins(4);
  ok("and every skin moves together", mat.uniforms.uTime.value === 4
     && (dropSkinMaterial(4) as THREE.ShaderMaterial).uniforms.uTime.value === 4);

  const turns = mat.uniforms.uTurns.value as THREE.Vector3;
  const base = (SITE_ANGULAR_VELOCITY * SPIN_MULTIPLIER) / 360;
  ok("the bands turn at the shield's own rate, so the two read as one thing",
     near(Math.abs(turns.z), base, 1e-9), `${turns.z} turns a second against ${base}`);
  ok("the middle band runs AGAINST the other two, which is what makes a pattern",
     turns.y * turns.x < 0 && turns.y * turns.z < 0,
     `${turns.x} ${turns.y} ${turns.z}`);
  ok("and the table says the same", BAND_TURNS.middle < 0 && BAND_TURNS.outer > 0 && BAND_TURNS.inner > 0);
  /* The label is sampled unshifted in the shader: it is printed on the ball,
     not on the pattern, so it must not slide. */
  ok("the label does not slide with the pattern",
     /texture2D\(uLabel, vUv\)/.test(mat.fragmentShader)
     && !/uLabel, vec2/.test(mat.fragmentShader));
  ok("each band is sampled at its own offset",
     (mat.fragmentShader.match(/vUv\.x \+ uTime \* uTurns\.[xyz]/g) ?? []).length === 3);
}

/* ---- and the old garbled label is gone from the game ---- */
{
  const fx = readFileSync(`${process.cwd()}/src/wallet/rebels/rebelsFx.ts`, "utf8");
  ok("the sphere no longer prints a mark letter after the tier",
     !/T\$\{tier\} \$\{mark\}/.test(fx));
  /* The shield bubble still prints the points left on it, which is a different
     thing entirely; what must be gone is the sphere's OWN label canvas. */
  ok("nor keeps a canvas of its own for them",
     !/dropMats/.test(fx) && !/canvas\.width = size/.test(fx));
  ok("it uses the mandala skin instead", /dropSkinMaterial\(tier\)/.test(fx));
  ok("and moves it every frame", /stepDropSkins\(skinClock\)/.test(fx));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
