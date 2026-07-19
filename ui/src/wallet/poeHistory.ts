// Local record of Proof-of-Existence anchors this wallet has created.
//
// The chain stores only a fingerprint, so it can never tell you WHICH file a
// proof was for, what it was called, or what it looked like. That context only
// exists here. Losing it doesn't invalidate a proof — the txid plus the original
// file is always enough — but without it a user has a list of meaningless
// hashes, so this is what makes the feature usable.

export interface PoeRecord {
  txid: string;
  hash: string;
  name: string;
  size: number;
  mime: string;
  /** Natural pixel size, images only. */
  width?: number;
  height?: number;
  /** Small JPEG data URL for the history list; absent for non-images. */
  thumb?: string;
  /** When this wallet broadcast the anchor. */
  createdAt: number;
  /** Block time once confirmed — this is the value the proof actually rests on. */
  confirmedAt?: number;
}

const KEY = "dd69.poe.history";
// Thumbnails dominate the footprint, and browser storage is a few megabytes in
// total, so keep the list bounded rather than letting it grow without limit.
const MAX_RECORDS = 200;

export function loadPoeHistory(): PoeRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: PoeRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    // Storage full: drop thumbnails oldest-first rather than lose the proofs
    // themselves, which are the part that actually matters.
    try {
      const trimmed = list.slice(0, MAX_RECORDS).map((r, i) => (i > 20 ? { ...r, thumb: undefined } : r));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
    } catch {
      /* give up quietly; proofs remain valid on-chain regardless */
    }
  }
}

/** Newest first. Replaces any existing entry with the same txid. */
export function addPoeRecord(rec: PoeRecord) {
  const list = loadPoeHistory().filter((r) => r.txid !== rec.txid);
  list.unshift(rec);
  save(list);
}

export function markPoeConfirmed(txid: string, confirmedAt: number) {
  const list = loadPoeHistory();
  const hit = list.find((r) => r.txid === txid);
  if (!hit || hit.confirmedAt) return;
  hit.confirmedAt = confirmedAt;
  save(list);
}

export function removePoeRecord(txid: string) {
  save(loadPoeHistory().filter((r) => r.txid !== txid));
}

/**
 * Downscaled JPEG preview for the history list. Returns undefined for anything
 * that isn't an image, or if the browser can't decode it.
 */
export async function makeThumb(file: File, max = 220): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("decode failed"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
