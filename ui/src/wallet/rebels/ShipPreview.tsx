// One ship, turning slowly, on its own tiny renderer.
//
// WHY ITS OWN RENDERER AND NOT THE GAME'S SCENE
// ---------------------------------------------
// The game borrows the map's live scene, camera and canvas, which is right for
// flying: it IS the map. A shop is not. It wants its own lighting, its own
// framing and a transparent background, and doing that inside the map's scene
// would mean saving and restoring the map's camera every time the panel opened.
// A 380-pixel canvas with three lights in it costs almost nothing.
//
// The model is fetched the moment a ship is SHOWN and not before. That is the
// whole reason a thirty-two ship market costs nothing until it is opened, and
// the second look at a ship is instant because the bytes are already local.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadModel, unitCopy } from "./spaceAssets";
import { makeRepaintable, type ShipPaint, type PaintHandle } from "./shipColours";

/** How far the hull leans toward the pointer, in radians. About ten degrees:
 *  enough to feel alive, little enough that it stays square to its own guns. */
const TILT = 0.175;
/** And how far it is tipped toward the camera, so you see a little of its back
 *  the way you would from a cockpit behind it. */
const OVERHEAD = 0.16;

/**
 * How the ship is shown.
 *
 * `turntable` is the shop: it turns slowly and you can grab it and spin it.
 * `flight` is the armoury: it points away from you at a slight overhead angle,
 * as though you were flying it, and tilts a little to follow the pointer. It
 * does not turn, because you are not looking AT it, you are looking PAST it at
 * what its guns are about to do.
 */
export type PreviewMode = "turntable" | "flight";

export function ShipPreview({ id, paint, still = false, mode = "turntable" }: {
  id: string; paint: ShipPaint; still?: boolean; mode?: PreviewMode;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  /* Kept in a ref so moving a slider repaints the ship that is already on
     screen. Putting it in the effect's dependencies would reload the model on
     every drag, which is both slow and wrong. */
  const repaint = useRef<PaintHandle | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const stillRef = useRef(still);
  stillRef.current = still;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /* Every render, which is every slider frame. Cheap: it writes ten numbers
     into uniforms that are already compiled into the shader. */
  useEffect(() => { repaint.current?.apply(paint); }, [paint]);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let stop = false;
    let raf = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    camera.position.set(0, 0.55, 2.15);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setState("failed");
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    /* Three lights and nothing clever: a key from the front left so the hull
       reads, a cold rim from behind so it separates from the panel, and enough
       ambient that the underside is not a silhouette. */
    scene.add(new THREE.AmbientLight(0xbcd4ff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-2, 2.4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fbcff, 2.2);
    rim.position.set(2.5, -0.6, -2.5);
    scene.add(rim);

    const turntable = new THREE.Group();
    scene.add(turntable);

    /* ---- inspecting it ----
       Grab and turn, wheel to come in closer. A shop where the thing on the
       stand cannot be picked up and looked at is a catalogue. The turntable
       keeps turning on its own until you touch it, then waits: it is showing
       you the ship, and once you take over it stops showing off. */
    let spin = 0.45;              /* radians a second, when nobody is driving */
    let yaw = 0, pitch = 0.1;
    let dolly = 2.15;             /* how far the camera sits back */
    let dragging = false;
    let idle = 0;                 /* seconds since the last touch */
    let lastX = 0, lastY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      idle = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01;
      /* Stopped short of straight up and straight down, where the view flips
         over and the ship appears to jump. */
      pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - lastY) * 0.01));
      lastX = e.clientX;
      lastY = e.clientY;
      idle = 0;
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      /* Multiplied rather than added, so a notch means the same proportion of
         a step whether you are close in or far out. */
      dolly = Math.max(0.95, Math.min(5, dolly * (1 + Math.sign(e.deltaY) * 0.12)));
      idle = 0;
    };
    const el = renderer.domElement;
    /* The badge in the cockpit corner is a readout, not a control: it turns and
       nothing else, or a stray click while flying would be caught by it. */
    const interactive = !stillRef.current;
    el.style.cursor = interactive ? "grab" : "default";
    if (interactive) el.addEventListener("pointerdown", onDown);
    if (interactive) {
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("wheel", onWheel, { passive: false });
    }

    void loadModel(id)
      .then((proto) => {
        if (stop) return;
        const model = unitCopy(proto);
        repaint.current = makeRepaintable(model);
        repaint.current.apply(paintRef.current);
        /* Normalised to one unit across, so every hull from a 13-unit fighter
           to a 565-unit station frames identically. The market shows shape and
           detail; the SIZE is in the stats, where it can be read. */
        model.scale.setScalar(1.5);
        turntable.add(model);
        setState("ready");
      })
      .catch(() => { if (!stop) setState("failed"); });

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    /* Where the pointer is, as -1 to 1 across the panel. Read from the whole
       window rather than from this canvas, because the thing being followed is
       the player's attention and that is mostly over the weapon list on the
       left, not over the ship. */
    let aimX = 0, aimY = 0;
    let tiltX = 0, tiltY = 0;
    const onAim = (e: PointerEvent) => {
      aimX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      aimY = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    window.addEventListener("pointermove", onAim);

    let last = performance.now();
    const tick = () => {
      if (stop) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      idle += dt;

      if (modeRef.current === "flight") {
        /* ---- FLYING IT, NOT LOOKING AT IT ----
           Nose away from the camera and a little below it, which is the view
           from just behind and above a ship you are flying. It does not turn.
           Instead it banks and pitches a few degrees toward the pointer, eased
           rather than snapped, which is enough to feel alive and little enough
           that the hull stays square to the guns being tested. */
        const want = TILT * Math.max(-1, Math.min(1, aimX));
        const wantP = TILT * Math.max(-1, Math.min(1, aimY));
        tiltY += (want - tiltY) * Math.min(1, dt * 6);
        tiltX += (wantP - tiltX) * Math.min(1, dt * 6);
        /* Half a turn, so the nose points away rather than at the camera. */
        turntable.rotation.set(OVERHEAD + tiltX, Math.PI + tiltY, -tiltY * 0.8);
        camera.position.set(0, 0.42 * dolly / 2.15, dolly);
        camera.lookAt(0, -0.06, 0);
      } else {
        /* Slow enough to look at. A turntable that whips round reads as a
           loading spinner rather than as a thing being shown to you. It picks
           up again four seconds after you let go, easing in rather than
           snapping back to speed. */
        if (stillRef.current) yaw += dt * spin;
        else if (!dragging && idle > 4) yaw += dt * spin * Math.min(1, (idle - 4) / 1.5);
        turntable.rotation.set(pitch, yaw, 0);
        camera.position.set(0, 0.55 * dolly / 2.15, dolly);
        camera.lookAt(0, 0, 0);
      }

      if (interactive) el.style.cursor = dragging ? "grabbing" : "grab";
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      stop = true;
      repaint.current = null;
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onAim);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [id]);

  return (
    <div className="ship-preview" ref={host}>
      {state === "loading" && <div className="ship-preview-note">ACQUIRING…</div>}
      {state === "failed" && <div className="ship-preview-note">NO SCAN DATA</div>}
    </div>
  );
}
