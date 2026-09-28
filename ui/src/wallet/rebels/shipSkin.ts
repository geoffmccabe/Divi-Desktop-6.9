// Your own picture, printed on your hull, and seen by everybody else.
//
// Geoff: "being able to upload textures to apply to the ships as well as a
// dropdown for how those are applied ... People want to personalize their
// ships."
//
// WHAT WAS ALREADY THERE, AND WHAT WAS NOT
// ----------------------------------------
// The paint shop already has four OVERLAYS (plain, lines, hex, camo). Those are
// not pictures: they are computed from the model's own shape, which is why they
// work on every hull and cost no download. They were broken for a long while
// (the pattern came out thirteen times too fine and read as a flat tint, which
// is what "there are texture buttons for the ships, but none of them work"
// was) and they were fixed. They are not what this file is.
//
// Uploading a picture was never built at all. This is that.
//
// THE SIZE, WHICH IS THE WHOLE DESIGN
// -----------------------------------
// A skin has to reach every other cockpit or it is not personalisation, it is
// a private joke. There is nowhere to put a file - no bucket, no upload
// endpoint - so the picture itself travels, and that means it has to be small
// enough that twenty-four of them are not a problem. So every upload is
// redrawn at 128 square and re-encoded as WebP until it fits in ten kilobytes,
// whatever came in. A photograph at that size is a smudge; a logo, a flag, a
// pattern or a piece of lettering is perfectly legible, and those are what
// people actually put on a hull.
//
// It is still not broadcast. The roster carries a short FINGERPRINT of each
// skin, and a cockpit that meets one it has not got asks for that one picture,
// once. See rebelsRoom.ts. Twenty-four painters cost a viewer a quarter of a
// megabyte across a whole session, not on every join.

import * as THREE from "three";

/** How the picture is laid onto the hull. The dropdown Geoff asked for. */
export type SkinMapping = "wrap" | "panels" | "band" | "badge";
export const SKIN_MAPPINGS: Array<{ key: SkinMapping; label: string; note: string }> = [
  { key: "wrap", label: "Wrap", note: "Over the whole hull from every side. The safe one: no seams and no stretching, whatever the shape." },
  { key: "panels", label: "Panels", note: "Flat across the flanks, like a decal sheet. Sharpest, but it smears on surfaces that face front or up." },
  { key: "band", label: "Band", note: "Wrapped around the ship's length, the way a livery stripe goes round a fuselage." },
  { key: "badge", label: "Badge", note: "One copy, centred on each flank, not repeated. For a logo or a name." },
];

/** The square the picture is redrawn at. Small on purpose: see the note above. */
export const SKIN_PIXELS = 128;
/**
 * The hard cap on an encoded skin, as data-URL characters.
 *
 * Ten kilobytes of image, which base64 inflates by a third. Everything
 * downstream trusts this number: the room checks it before storing a skin and
 * again before sending one on, because a cap enforced only by the thing doing
 * the uploading is not a cap at all.
 */
export const SKIN_MAX_CHARS = 14_000;

export interface ShipSkin {
  /** The picture, as a data URL. Always WebP, always SKIN_PIXELS square. */
  image: string;
  mapping: SkinMapping;
  /** How many times it repeats across the hull. Ignored by "badge". */
  scale: number;
  /** 0 is the paint alone; 1 is the picture, still wearing the hull's own
   *  shading so the panel lines show through it. */
  strength: number;
}

export const SKIN_SCALE_MIN = 0.25;
export const SKIN_SCALE_MAX = 8;

/** Nothing printed. */
export const NO_SKIN: ShipSkin | null = null;

/* ---- reading it, from anywhere ----
   A skin arrives from a file the player picked, or off the wire from another
   player, and neither is trusted. One reader, so the room and the cockpit
   cannot disagree about what a valid skin is. */

/** A data URL that is really a small WebP and nothing else. */
export function skinImageOk(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length > SKIN_MAX_CHARS) return false;
  if (!raw.startsWith("data:image/webp;base64,")) return false;
  const body = raw.slice("data:image/webp;base64,".length);
  return body.length > 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(body);
}

/** A whole skin off the wire, made safe, or null if it is not one. Anything
 *  not exactly right is dropped rather than repaired: guessing at what a
 *  malformed message meant is how a validator becomes a bug. */
export function skinOk(raw: unknown): ShipSkin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!skinImageOk(r.image)) return null;
  const mapping = SKIN_MAPPINGS.find((m) => m.key === r.mapping)?.key;
  if (!mapping) return null;
  const scale = Number(r.scale);
  const strength = Number(r.strength);
  if (!Number.isFinite(scale) || !Number.isFinite(strength)) return null;
  return {
    image: r.image,
    mapping,
    scale: Math.min(SKIN_SCALE_MAX, Math.max(SKIN_SCALE_MIN, scale)),
    strength: Math.min(1, Math.max(0, strength)),
  };
}

/**
 * A short, stable name for a picture.
 *
 * Not security: it is how a cockpit says "I have not got that one" without the
 * picture itself being in the roster. Two different pictures colliding would
 * mean one player wearing another's skin, so it is wide enough that that will
 * not happen in a room of twenty-four: 64 bits, as thirteen characters.
 */
export function skinFingerprint(image: string): string {
  /* FNV-1a, twice over, with different offsets, for 64 bits without a
     dependency. The input is base64 text, so it is bytes either way. */
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < image.length; i++) {
    const c = image.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
  }
  return ((a >>> 0).toString(36) + "-" + (b >>> 0).toString(36));
}

/* ================= TURNING A FILE INTO A SKIN =================
   Browser only: canvas and Image. The room never runs any of this - it only
   ever checks what arrives against skinOk. */

/**
 * Redraw whatever was picked at 128 square, as WebP, small enough to send.
 *
 * COVER, not fit: the square is filled and the overflow is cropped, because a
 * letterboxed upload would print grey bars on the hull and nobody means that.
 * Quality comes down in steps until it fits the cap, and if even the lowest
 * quality is too big the picture is redrawn smaller. It cannot fail to fit:
 * that is what the loop is for.
 */
export async function skinFromFile(file: Blob): Promise<string> {
  const bitmap = await readImage(file);
  let side = SKIN_PIXELS;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser cannot redraw the picture");
    /* COVER: scale by the LARGER ratio and centre the overflow off the edges. */
    const k = Math.max(side / bitmap.width, side / bitmap.height);
    const w = bitmap.width * k, h = bitmap.height * k;
    ctx.drawImage(bitmap as CanvasImageSource, (side - w) / 2, (side - h) / 2, w, h);
    for (const quality of [0.82, 0.66, 0.5, 0.36, 0.24]) {
      const url = canvas.toDataURL("image/webp", quality);
      /* A browser that cannot write WebP hands back a PNG instead, silently.
         Better to say so than to send something the other end will refuse. */
      if (!url.startsWith("data:image/webp")) {
        throw new Error("this browser cannot save WebP");
      }
      if (url.length <= SKIN_MAX_CHARS) return url;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error("that picture will not go small enough");
}

async function readImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("that file is not a picture"));
      img.src = url;
    });
  } finally {
    /* Revoked on the next turn of the loop, so the decode has had it. */
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/* ================= KEEPING IT ================= */

const STORE = "rebels.shipSkin";

export function loadSkin(): ShipSkin | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? skinOk(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveSkin(skin: ShipSkin | null): void {
  try {
    if (skin) localStorage.setItem(STORE, JSON.stringify(skin));
    else localStorage.removeItem(STORE);
  } catch { /* a full or blocked store is not worth failing a repaint over */ }
}

/* ================= AND ONTO A SHIP =================
   One THREE.Texture per distinct picture, shared by every model wearing it.
   Twenty-four ships in a room is twenty-four hulls, not twenty-four uploads to
   the card. */

const textures = new Map<string, THREE.Texture>();

export function skinTexture(image: string): THREE.Texture {
  const held = textures.get(image);
  if (held) return held;
  const tex = new THREE.TextureLoader().load(image);
  /* CLAMPED, always, and the repeating is done in the shader with fract().
     The alternative is two textures per picture, one clamped and one repeating,
     because "badge" must not tile and the others must. */
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(image, tex);
  return tex;
}

/** Let go of a picture nobody is wearing any more. */
export function forgetSkinTexture(image: string): void {
  const tex = textures.get(image);
  if (!tex) return;
  tex.dispose();
  textures.delete(image);
}

/** Which number the shader knows a mapping by. */
export const mappingIndex = (m: SkinMapping): number =>
  Math.max(0, SKIN_MAPPINGS.findIndex((x) => x.key === m));
