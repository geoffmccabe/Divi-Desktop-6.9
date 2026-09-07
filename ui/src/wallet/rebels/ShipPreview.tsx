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

export function ShipPreview({ id, paint }: { id: string; paint: ShipPaint }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  /* Kept in a ref so moving a slider repaints the ship that is already on
     screen. Putting it in the effect's dependencies would reload the model on
     every drag, which is both slow and wrong. */
  const repaint = useRef<PaintHandle | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

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

    let last = performance.now();
    const tick = () => {
      if (stop) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      /* Slow enough to look at. A turntable that whips round reads as a loading
         spinner rather than as a thing being shown to you. */
      turntable.rotation.y += dt * 0.45;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      stop = true;
      repaint.current = null;
      cancelAnimationFrame(raf);
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
