// Everybody else's ship, wearing their own paint, with their name over it.
//
// A room where every ship is an identical grey arrow is a room where you cannot
// tell who anybody is, so a peer's hull and colour scheme travel on the wire
// with them and are put on here. Geoff: "will multiple players be able to see
// each other and their custom spaceships? We should put the name of the player
// (their given node name) above the name of their ship so we see who they are."
//
// The nameplate is a sprite rather than HTML over the canvas, for one reason
// that matters: a sprite is IN the world. It goes behind the planet when the
// player it belongs to does, it shrinks with distance, and it needs nothing
// projected or kept in step every frame. An HTML label has to be positioned by
// hand each frame and cheerfully floats in front of the Earth.

import * as THREE from "three";
import { loadModel, unitCopy } from "./spaceAssets";
import { makeRepaintable, type PaintHandle, type ShipPaint, FACTORY, PART_ORDER } from "./shipColours";
import { DEFAULT_SHIP } from "./shipChoice";
import type { RoomPlayer } from "./rebelsRoom";

/** How long a peer's hull is drawn, matching the local ship. */
const SHIP_LENGTH = 2.6;
/** How far above the hull the plate floats, in ship lengths. */
const PLATE_LIFT = 1.5;
/** Beyond this the plate is not drawn: a sky full of unreadable specks of text
 *  is worse than no labels at all. */
const PLATE_RANGE = 420;

export interface Peers {
  group: THREE.Group;
  /** Place everyone. Called every frame with whoever the room says is here. */
  draw(list: RoomPlayer[], camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * Turn a paint scheme off the wire back into one the shader understands.
 *
 * Five parts in a fixed order, which is how it was flattened for sending. A
 * missing or malformed scheme falls back to the factory colours rather than
 * being repaired: a ship in the wrong colours is a small thing, and guessing at
 * what a broken message meant is how this kind of code goes wrong quietly.
 */
export function paintFromWire(wire: number[][] | undefined): ShipPaint {
  const out: ShipPaint = { ...FACTORY };
  if (!Array.isArray(wire) || wire.length !== PART_ORDER.length) return out;
  PART_ORDER.forEach((key, i) => {
    const p = wire[i];
    if (!Array.isArray(p) || p.length < 4 || p.some((n) => typeof n !== "number" || !Number.isFinite(n))) return;
    out[key] = {
      hue: ((p[0] % 360) + 360) % 360,
      sat: Math.max(0, Math.min(1, p[1])),
      bright: Math.max(0, Math.min(6, p[2])),
      overlay: (["none", "lines", "hex", "camo"] as const)[Math.max(0, Math.min(3, Math.round(p[3])))],
    };
  });
  return out;
}

/** The label above a ship: who they are, over what they fly. */
export function plateTexture(name: string, ship: string): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  /* The player's own name on top and the hull under it, which is the order
     asked for and also the useful one: in a fight you want to know WHO before
     you want to know what they are flying. */
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const pretty = ship.replace(/^space_SM_Ship_/, "").replace(/_/g, " ").trim();

  /* Drawn twice, dark then light, so it stays readable over a bright planet
     and over black sky alike. A single colour is legible over one of them. */
  const line = (text: string, y: number, size: number, colour: string) => {
    ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.lineWidth = size * 0.34;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, canvas.width / 2, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, canvas.width / 2, y);
  };
  line((name || "Unnamed node").slice(0, 28), 52, 54, "#ffffff");
  line(pretty.slice(0, 30) || "Fighter", 116, 38, "#9fd0ff");

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface Slot {
  group: THREE.Group;
  /** The hull, once it has arrived. */
  hull: THREE.Object3D | null;
  paint: PaintHandle | null;
  plate: THREE.Sprite | null;
  plateTex: THREE.Texture | null;
  /** What this slot was built for, so it is only rebuilt when that changes. */
  forShip: string;
  forName: string;
  loading: boolean;
}

export function createPeers(): Peers {
  const group = new THREE.Group();
  const slots = new Map<string, Slot>();
  const scratch = new THREE.Matrix4();
  const up = new THREE.Vector3();
  const target = new THREE.Vector3();

  function slotFor(id: string): Slot {
    let s = slots.get(id);
    if (!s) {
      s = {
        group: new THREE.Group(), hull: null, paint: null,
        plate: null, plateTex: null, forShip: "", forName: "", loading: false,
      };
      group.add(s.group);
      slots.set(id, s);
    }
    return s;
  }

  function build(slot: Slot, p: RoomPlayer): void {
    /* Only when the ship or the name has actually changed, which is about once
       a session: rebuilding a hull every frame would be a download and a
       repaint sixty times a second. */
    const ship = p.ship || DEFAULT_SHIP;
    if (slot.forShip === ship && slot.forName === p.name) return;

    if (slot.forName !== p.name) {
      slot.forName = p.name;
      slot.plateTex?.dispose();
      slot.plateTex = plateTexture(p.name, ship);
      if (slot.plateTex) {
        if (!slot.plate) {
          slot.plate = new THREE.Sprite(new THREE.SpriteMaterial({
            transparent: true, depthWrite: false,
          }));
          /* Drawn after the hulls so it is never half-buried in one. */
          slot.plate.renderOrder = 3;
          slot.group.add(slot.plate);
        }
        (slot.plate.material as THREE.SpriteMaterial).map = slot.plateTex;
        (slot.plate.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }

    if (slot.forShip === ship || slot.loading) return;
    slot.forShip = ship;
    slot.loading = true;
    void loadModel(ship)
      .then((proto) => {
        if (slot.forShip !== ship) return;      /* changed again while loading */
        if (slot.hull) { slot.group.remove(slot.hull); }
        const model = unitCopy(proto);
        slot.paint = makeRepaintable(model);
        slot.paint.apply(paintFromWire(p.paint));
        model.scale.setScalar(SHIP_LENGTH);
        slot.hull = model;
        slot.group.add(model);
      })
      .catch(() => { slot.forShip = ""; })
      .finally(() => { slot.loading = false; });
  }

  return {
    group,
    draw(list, camera) {
      const here = new Set<string>();
      for (const p of list) {
        here.add(p.id);
        const slot = slotFor(p.id);
        build(slot, p);
        /* Repaint only when it changed, for the same reason as the hull. */
        if (slot.paint && p.paint) slot.paint.apply(paintFromWire(p.paint));

        slot.group.position.copy(p.pos);
        slot.group.visible = true;

        if (slot.hull) {
          /* Pointed the way they are flying, upright against the planet. */
          up.copy(p.pos).normalize();
          target.copy(p.pos).add(p.fwd);
          scratch.lookAt(p.pos, target, up);
          slot.hull.quaternion.setFromRotationMatrix(scratch);
        }

        if (slot.plate) {
          const away = camera.position.distanceTo(p.pos);
          slot.plate.visible = away < PLATE_RANGE;
          slot.plate.position.set(0, SHIP_LENGTH * PLATE_LIFT, 0);
          /* Grows with distance so it stays about the same size on screen,
             within limits: a plate that shrank properly would be unreadable at
             the range you most want to know who somebody is. */
          const scale = Math.max(2.2, Math.min(26, away * 0.055));
          slot.plate.scale.set(scale * 2.4, scale * 0.75, 1);
        }
      }
      /* Anyone who has left. */
      for (const [id, slot] of slots) {
        if (here.has(id)) continue;
        group.remove(slot.group);
        slot.plateTex?.dispose();
        slots.delete(id);
      }
    },
    dispose() {
      for (const slot of slots.values()) {
        slot.plateTex?.dispose();
        group.remove(slot.group);
      }
      slots.clear();
    },
  };
}
