// The Rear Gun: a found item that opens a window behind you.
//
// Geoff (2026-Sep-11): "The rear gun needs an activation key (7) and then a
// screen pops up in the top right corner, 35% of width and height. The camera
// points backwards and if the user puts their pointer into that window the
// cursor fires a double-shot backwards towards whatever is behind them. If
// their cursor is there and they right-click, then a torpedo shoots
// backwards."
//
// The arithmetic lives here, away from the renderer, so it can be tested:
// where the window is, whether the crosshair is in it, where in the window it
// is, where the rear camera sits, and where the tail is.

import * as THREE from "three";

/** The window, as fractions of the canvas: top right, 35% by 35%. */
export const REAR_WINDOW = { x: 0.65, y: 0, w: 0.35, h: 0.35 };
export const REAR_KEY = "7";
/** How far behind the ship the rear camera sits, and how high. */
export const REAR_CAMERA_BACK = 3.2;
export const REAR_CAMERA_UP = 0.9;

export function inRearWindow(cursor: { x: number; y: number }): boolean {
  return cursor.x >= REAR_WINDOW.x && cursor.x <= REAR_WINDOW.x + REAR_WINDOW.w
    && cursor.y >= REAR_WINDOW.y && cursor.y <= REAR_WINDOW.y + REAR_WINDOW.h;
}

/** The crosshair's place IN the window, as normalised device coordinates for
 *  the rear camera: -1..1 across, -1..1 up. */
export function rearNdc(cursor: { x: number; y: number }): { x: number; y: number } {
  const wx = (cursor.x - REAR_WINDOW.x) / REAR_WINDOW.w;
  const wy = (cursor.y - REAR_WINDOW.y) / REAR_WINDOW.h;
  return { x: Math.max(-1, Math.min(1, wx * 2 - 1)), y: Math.max(-1, Math.min(1, -(wy * 2 - 1))) };
}

/** Put the rear camera behind and a little above the ship, looking back
 *  along the way it came, with the ship's own up. */
export function placeRearCamera(
  cam: THREE.PerspectiveCamera,
  ship: { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 },
): void {
  cam.position.copy(ship.pos).addScaledVector(ship.fwd, -REAR_CAMERA_BACK).addScaledVector(ship.up, REAR_CAMERA_UP);
  cam.up.copy(ship.up);
  const look = cam.position.clone().addScaledVector(ship.fwd, -10);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
}

/** Where a rear shot goes: through the crosshair's spot in the window. */
export function rearAim(cam: THREE.PerspectiveCamera, cursor: { x: number; y: number }): THREE.Vector3 {
  const n = rearNdc(cursor);
  const p = new THREE.Vector3(n.x, n.y, 0.5).unproject(cam);
  return p.sub(cam.position).normalize();
}

/** The tail of the ship, where rear fire leaves from. */
export function tailOf(pos: THREE.Vector3, fwd: THREE.Vector3, length: number): THREE.Vector3 {
  return pos.clone().addScaledVector(fwd, -length * 0.5);
}

/** The scissor rectangle for the window, in the renderer's pixels. Three's
 *  origin is the BOTTOM left, so the top strip is at height minus the window. */
export function rearViewport(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const w = Math.round(width * REAR_WINDOW.w), h = Math.round(height * REAR_WINDOW.h);
  return { x: Math.round(width * REAR_WINDOW.x), y: height - h - Math.round(height * REAR_WINDOW.y), w, h };
}
