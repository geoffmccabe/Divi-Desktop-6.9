// Spikeworld: the dissolve between two detail levels.
//
// A coarse box and the eight fine chunks that replace it are different rock:
// about a quarter of the cubes are somewhere else. Swapping them in one frame
// is a pop, and a pop every time the ship comes a little closer to something
// is "the planet keeps changing its blocks". So they are crossfaded.
//
// Not with transparency, which needs sorting and shows both surfaces through
// each other. With a screen-door: every pixel belongs to ONE of the two by a
// fixed 4x4 pattern, and the share that belongs to the fine side rises from
// none to all over a third of a second. Each pixel changes hands exactly once,
// depth still works, and nothing else in the scene is touched. The same trick
// Unity calls LOD cross-fade.
//
// Chunks not in a fade keep the shared material. A fading chunk borrows a
// material from a small pool that carries two numbers: how far the fade has
// gone, and which side of the pattern this chunk keeps. All the pool's
// materials share one compiled shader (same onBeforeCompile), so this costs a
// handful of uniform uploads and no recompiles.

import * as THREE from "three";

/** How long a swap takes, in seconds. Long enough to read as a dissolve,
 *  short enough that a wall arriving at boost speed is not still arriving. */
export const DISSOLVE_SECONDS = 0.35;

interface FadeMaterial {
  material: THREE.MeshBasicMaterial;
  fade: { value: number };
  invert: { value: number };
}

const HEADER = `
uniform float uFade;
uniform float uInvert;
/* 4x4 Bayer, without bit operations (WebGL1 has none): the 2x2 base is
   xor(x,y)*2 + y, and the 4x4 nests it. Values 0..15 over 16. */
float dd69_m2(float x, float y) { float xr = x + y - 2.0 * x * y; return xr * 2.0 + y; }
float dd69_bayer(vec2 p) {
  vec2 q = floor(mod(p, 4.0));
  vec2 lo = mod(q, 2.0);
  vec2 hi = floor(q / 2.0);
  return (4.0 * dd69_m2(lo.x, lo.y) + dd69_m2(hi.x, hi.y)) / 16.0;
}
`;
const GATE = `
  {
    bool keep = dd69_bayer(gl_FragCoord.xy) < uFade;
    if (uInvert > 0.5) keep = !keep;
    if (!keep) discard;
  }
`;

/** One shared function, so every material built here shares a program. */
function patch(this: THREE.Material, shader: { uniforms: Record<string, { value: unknown }>; fragmentShader: string }): void {
  const u = (this.userData as { fade?: { value: number }; invert?: { value: number } });
  shader.uniforms.uFade = u.fade ?? { value: 1 };
  shader.uniforms.uInvert = u.invert ?? { value: 0 };
  shader.fragmentShader = HEADER + shader.fragmentShader.replace("void main() {", "void main() {" + GATE);
}

export class DissolvePool {
  private free: FadeMaterial[] = [];
  private inUse = new Map<THREE.Mesh, FadeMaterial>();
  constructor(private readonly base: THREE.MeshBasicMaterial) {}

  /** Give this mesh a fading material, or update the one it has. `t` is how
   *  far the FINE side has come, 0 to 1; `keepFine` says which side this
   *  mesh is. */
  set(mesh: THREE.Mesh, t: number, keepFine: boolean): void {
    let fm = this.inUse.get(mesh);
    if (!fm) {
      fm = this.free.pop() ?? this.make();
      this.inUse.set(mesh, fm);
      mesh.material = fm.material;
    }
    fm.fade.value = Math.min(1, Math.max(0, t));
    fm.invert.value = keepFine ? 0 : 1;
  }

  /** The fade is over: the mesh goes back to the shared material. */
  release(mesh: THREE.Mesh): void {
    const fm = this.inUse.get(mesh);
    if (!fm) return;
    this.inUse.delete(mesh);
    mesh.material = this.base;
    this.free.push(fm);
  }

  fading(mesh: THREE.Mesh): boolean {
    return this.inUse.has(mesh);
  }

  private make(): FadeMaterial {
    const material = this.base.clone();
    const fade = { value: 1 };
    const invert = { value: 0 };
    material.userData = { fade, invert };
    material.onBeforeCompile = patch;
    /* Same key for every one, so three.js compiles the program once. */
    material.customProgramCacheKey = () => "dd69-dissolve";
    return { material, fade, invert };
  }

  dispose(): void {
    for (const fm of this.free) fm.material.dispose();
    for (const fm of this.inUse.values()) fm.material.dispose();
    this.free = [];
    this.inUse.clear();
  }
}
