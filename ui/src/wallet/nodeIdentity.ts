// The node's public persona: the name, description and avatar its owner chooses
// to show other nodes. Stored locally for now; publishing it on-chain and reading
// other nodes' personas comes next (see docs/NODE-IDENTITY-PLAN.md).
//
// Two sizes of the image are kept on purpose:
//   * avatar — up to 512px, shown in the agent panel and a full profile view
//   * thumb  —  96px, what the network map draws on hover, where hundreds may be
//              on screen at once and a full-size image per node would be brutal
//
// Both are re-encoded to WebP through a canvas, which also strips EXIF. That
// matters: a photo taken on a phone can carry GPS coordinates, and this image is
// meant to be PUBLIC while its owner stays pseudonymous. Publishing your home
// location inside your anonymous avatar would defeat the entire point.

const KEY = "dd69.nodeIdentity";

export interface NodeIdentity {
  /** Shown instead of the bare IP on the map. */
  name: string;
  description: string;
  /** WebP data URL, ≤512px, or "" if none chosen. */
  avatar: string;
  /** WebP data URL, 96px — what the map hover card uses. */
  thumb: string;
  /** Index of a built-in character, when one was picked instead of an upload. */
  builtin: number | null;
  /** Publish this persona at all. Off means the node stays anonymous. */
  participate: boolean;
  /** 0–255: how much it says when spoken to (it never starts conversations). */
  chatter: number;
  updatedAt: number;
}

export const EMPTY: NodeIdentity = {
  name: "",
  description: "",
  avatar: "",
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
    /* storage full — the caller still gets the value back */
  }
  window.dispatchEvent(new Event("dd69-identity-changed"));
  return next;
}

/** Longest edge for each stored size. */
const AVATAR_PX = 512;
const THUMB_PX = 96;

function resize(img: HTMLImageElement, maxPx: number): string {
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, w, h);
  // Re-encoding through the canvas is what drops EXIF (including GPS).
  return c.toDataURL("image/webp", 0.85);
}

/** Read a chosen file into the two stored sizes. Rejects non-images. */
export function imageToAvatar(file: File): Promise<{ avatar: string; thumb: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file isn't an image."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const avatar = resize(img, AVATAR_PX);
        const thumb = resize(img, THUMB_PX);
        if (!avatar || !thumb) throw new Error("Could not process that image.");
        resolve({ avatar, thumb });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}
