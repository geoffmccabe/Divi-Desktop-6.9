// Perceptual hash (dHash, 64-bit) for PoE "Close Match". Unlike the SHA-256
// exact hash — which changes completely if a single pixel changes — a dHash
// stays SIMILAR for the same image after resize / re-compression / format
// change, so a lightly-modified copy can still be recognised. It is computed
// entirely in the browser from a downscaled greyscale copy; the original file
// never leaves the machine.
//
// LIMITS (be honest in the UI): dHash catches near-copies, but crops, rotation,
// heavy edits and deliberate evasion break it, and it can never prove a model
// was TRAINED on the work — only that a copy of the image was reused.

// dHash: shrink to 9x8 greyscale, then for each row compare adjacent pixels
// (left brighter than right? -> 1). 8 comparisons x 8 rows = 64 bits.
export async function phashFromFile(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    return phashFromBitmap(bmp);
  } catch {
    return null; // non-image, or decode failed
  }
}

export function phashFromBitmap(bmp: ImageBitmap): string | null {
  const W = 9,
    H = 8;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const gray = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  let bits = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const l = gray((y * W + x) * 4);
      const r = gray((y * W + x + 1) * 4);
      bits += l > r ? "1" : "0";
    }
  }
  // 64 bits -> 16 hex chars
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two 64-bit hex dHashes (0 = identical). */
export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** A friendly closeness label from a Hamming distance (0..64). */
export function closeness(dist: number): { label: string; strong: boolean } {
  if (dist <= 2) return { label: "near-identical", strong: true };
  if (dist <= 6) return { label: "very likely the same image", strong: true };
  if (dist <= 10) return { label: "possibly a modified copy", strong: false };
  return { label: "no close match", strong: false };
}

export const CLOSE_MATCH_MAX = 10; // distances above this aren't shown as matches
