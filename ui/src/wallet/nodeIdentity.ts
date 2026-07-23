// The node's public persona: the name, description and avatar its owner chooses
// to show other nodes.
//
// WHY MEDIA IS NOT KEPT IN localStorage:
// The first version re-encoded every upload through a canvas. That did two bad
// things — a canvas grabs only the FIRST FRAME, so animated WebP and video came
// out as a still, and the result was stored as base64 text, which inflates by a
// third and would blow past localStorage's ~5MB ceiling on a 3MB file.
//
// So: the ORIGINAL file is kept byte-for-byte in IndexedDB (which has room and
// stores real Blobs), so animation and video survive intact. Only a small static
// thumbnail — a canvas snapshot of the first frame — goes in localStorage, for
// the network map, where hundreds of nodes may be on screen and a full animation
// each would be brutal.
//
// Privacy trade-off, stated honestly: keeping the original means any EXIF the
// file carries (a phone photo can include GPS) is kept too. Canvas re-encoding
// used to strip that, but it cannot be done to an animation without destroying
// it. The UI warns on still photos, where stripping is possible and the risk is
// real; see stripStillExif below.

const KEY = "dd69.nodeIdentity";
const DB = "dd69";
const STORE = "nodeMedia";
const MEDIA_ID = "avatar";

/** Hard ceiling on an uploaded avatar. Small videos fit; huge ones don't. */
export const MAX_BYTES = 3 * 1024 * 1024;

export interface NodeIdentity {
  name: string;
  description: string;
  /** MIME of the stored media, e.g. image/webp, video/mp4. "" = none. */
  mediaType: string;
  /** True once media is in IndexedDB (the blob itself never lives here). */
  hasMedia: boolean;
  /** Small static WebP data URL — what the map hover card draws. */
  thumb: string;
  /** Index of a curated grid character, when one was picked instead. */
  builtin: number | null;
  participate: boolean;
  /** 0–255: how much it says when spoken to (it never starts conversations). */
  chatter: number;
  updatedAt: number;
}

export const EMPTY: NodeIdentity = {
  name: "",
  description: "",
  mediaType: "",
  hasMedia: false,
  thumb: "",
  builtin: null,
  participate: false,
  chatter: 128,
  updatedAt: 0,
};

export function loadIdentity(): NodeIdentity {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") return { ...EMPTY, ...v };
  } catch {
    /* fall through */
  }
  return { ...EMPTY };
}

export function saveIdentity(id: NodeIdentity): NodeIdentity {
  const next = { ...id, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full — caller still gets the value */
  }
  window.dispatchEvent(new Event("dd69-identity-changed"));
  return next;
}

// ── IndexedDB: the media blob ───────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open local storage."));
  });
}

async function putBlob(blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, MEDIA_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the image."));
  });
  db.close();
}

export async function getMediaBlob(): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(MEDIA_ID);
      r.onsuccess = () => resolve((r.result as Blob) ?? null);
      r.onerror = () => resolve(null);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

export async function clearMedia(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(MEDIA_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing stored */
  }
}

/** An object URL for the stored media, or null. Caller revokes when done. */
export async function mediaUrl(): Promise<string | null> {
  const b = await getMediaBlob();
  return b ? URL.createObjectURL(b) : null;
}

// ── Thumbnail (static, first frame) ─────────────────────────────────────────

const THUMB_PX = 96;

function drawThumb(src: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, THUMB_PX / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/webp", 0.8);
}

function imageThumb(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const t = drawThumb(img, img.width, img.height);
      URL.revokeObjectURL(url);
      t ? resolve(t) : reject(new Error("Could not read that image."));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

function videoThumb(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    const done = (t: string) => {
      URL.revokeObjectURL(url);
      t ? resolve(t) : reject(new Error("Could not read that video."));
    };
    v.onloadeddata = () => {
      // Nudge past frame zero; some encodes start on a black frame.
      v.currentTime = Math.min(0.1, (v.duration || 1) / 10);
    };
    v.onseeked = () => done(drawThumb(v, v.videoWidth, v.videoHeight));
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that video."));
    };
    v.src = url;
  });
}

export interface PickedMedia {
  mediaType: string;
  thumb: string;
}

/**
 * Store a chosen file as the avatar, keeping it byte-for-byte so animation and
 * video survive, and derive a small static thumbnail for the map.
 */
export async function pickMedia(file: File): Promise<PickedMedia> {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) throw new Error("Choose an image or a short video.");
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`That file is ${mb}MB. The limit is 3MB — try a smaller or shorter one.`);
  }
  const thumb = isVideo ? await videoThumb(file) : await imageThumb(file);
  await putBlob(file); // the ORIGINAL — animation intact
  return { mediaType: file.type, thumb };
}
