// ── The v2 animation layer on the 3D globe ─────────────────────────────────
//
// The globe is WebGL, so the arcs and rings cannot be drawn into it the way
// they are on the flat map. Instead a transparent 2D canvas sits on top and
// asks the globe where each node currently appears on screen.
//
// The important part is what this file does NOT do: it does not reimplement
// the animations. It supplies a projection and calls the same drawMapAnim()
// the flat map uses, so the two surfaces cannot drift into showing different
// things about the same node. That was the whole point of the exercise.

import type { GlobeMethods } from "react-globe.gl";
import { drawMapAnim } from "./mapAnimRender";
import { isMapAnimV2 } from "./mapAnimFlag";

export interface GlobeOverlayOpts {
  canvas: HTMLCanvasElement;
  globe: () => GlobeMethods | undefined;
  /** Our own node, the origin of every outbound arc. */
  self: () => { lat: number; lng: number } | null;
  size: () => { w: number; h: number };
}

/** Start the overlay loop. Returns a dispose function. */
export function createGlobeAnimOverlay(opts: GlobeOverlayOpts): () => void {
  let raf = 0;
  let lastFrame = 0;
  let cleared = true;

  const frame = () => {
    raf = requestAnimationFrame(frame);

    const g = opts.globe();
    const { w, h } = opts.size();
    const ctx = opts.canvas.getContext("2d");
    if (!ctx || !g || w <= 0 || h <= 0) return;

    // Flag off: wipe once, then stay idle. No per-frame cost while disabled.
    if (!isMapAnimV2()) {
      if (!cleared) {
        ctx.clearRect(0, 0, opts.canvas.width, opts.canvas.height);
        cleared = true;
      }
      return;
    }

    const now = performance.now();
    if (now - lastFrame < 33) return; // 30fps, matching the flat map
    lastFrame = now;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (opts.canvas.width !== cw || opts.canvas.height !== ch) {
      opts.canvas.width = cw;
      opts.canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    cleared = false;

    // The horizon test, same rule the tower culling uses: a point is on the
    // visible face when its direction dotted with the camera's exceeds
    // radius / camera distance. Without this, nodes on the FAR side of the
    // planet would pulse straight through the Earth.
    const camera = g.camera() as { position: { x: number; y: number; z: number } } | undefined;
    let hx = 0;
    let hy = 0;
    let hz = 0;
    let horizon = -1;
    if (camera?.position) {
      const p = camera.position;
      const len = Math.hypot(p.x, p.y, p.z);
      if (len > 1e-3) {
        hx = p.x / len;
        hy = p.y / len;
        hz = p.z / len;
        const radius = typeof g.getGlobeRadius === "function" ? g.getGlobeRadius() : 100;
        // The margin keeps a node just past the edge visible, so it doesn't
        // pop out mid-animation as the globe turns.
        horizon = Math.min(0.999, radius / len) - 0.08;
      }
    }

    const visible = (lat: number, lng: number): boolean => {
      if (horizon <= -1) return true; // no camera yet — don't hide anything
      const c = g.getCoords(lat, lng, 0) as { x: number; y: number; z: number } | undefined;
      if (!c) return true;
      const len = Math.hypot(c.x, c.y, c.z);
      if (len < 1e-6) return true;
      return (c.x * hx + c.y * hy + c.z * hz) / len > horizon;
    };

    const project = (lat: number, lng: number): [number, number] | null => {
      if (!visible(lat, lng)) return null;
      const s = g.getScreenCoords(lat, lng, 0);
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
      return [s.x, s.y];
    };

    const me = opts.self();
    const self = me ? project(me.lat, me.lng) : null;

    drawMapAnim(ctx, now, { project, self });
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
