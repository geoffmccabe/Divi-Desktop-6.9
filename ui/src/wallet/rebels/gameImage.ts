// The card picture for a game type: 3:2, uploaded, and small enough to carry.
//
// Geoff: "define game types with a name, and image (3:2 aspect ratio)
// uploaded".
//
// WHY IT IS SHRUNK RATHER THAN STORED AS GIVEN. The card lives in the same
// database row as the game it belongs to, and that row is read by every
// cockpit that opens the game picker. A two-megabyte photograph dropped into a
// panel would be downloaded by every player, every session, for ever. So
// whatever is picked is redrawn at card size and re-encoded until it fits a
// cap, and the cap is enforced here rather than trusted to whoever uploads.
//
// The same reasoning and very nearly the same code as a ship skin, at a
// different shape and a larger cap: a hull skin is a texture wrapped on a
// model and can be tiny, a card is looked at directly.

/** Three by two, as Geoff asked. The card is drawn at this and scaled by CSS. */
export const CARD_W = 480;
export const CARD_H = 320;
/** The cap, as data-URL characters. Sixty kilobytes of picture, which base64
 *  inflates by a third: enough for a detailed card at this size, small enough
 *  that twenty of them in a picker is not a page load anybody notices. */
export const CARD_MAX_CHARS = 82_000;

/** A picture that is really a small WebP and nothing else. Shared with the
 *  validator so the panel and the saver cannot disagree. */
export function cardImageOk(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length > CARD_MAX_CHARS) return false;
  if (!raw.startsWith("data:image/webp;base64,")) return false;
  const body = raw.slice("data:image/webp;base64,".length);
  return body.length > 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(body);
}

/** How the source is fitted into the card. */
export type Fit = "cover" | "contain";

/**
 * Where a picture of `sw` by `sh` goes when drawn into the card.
 *
 * Pulled out as its own function with no canvas in it so the arithmetic can be
 * tested: "cover" fills the card and loses the overflow, "contain" fits the
 * whole picture and leaves bars. Everything else here needs a browser.
 */
export function placeIn(sw: number, sh: number, fit: Fit = "cover"):
  { x: number; y: number; w: number; h: number } {
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w: CARD_W, h: CARD_H };
  const k = fit === "cover"
    ? Math.max(CARD_W / sw, CARD_H / sh)
    : Math.min(CARD_W / sw, CARD_H / sh);
  const w = sw * k, h = sh * k;
  return { x: (CARD_W - w) / 2, y: (CARD_H - h) / 2, w, h };
}

/**
 * Redraw whatever was picked as a 3:2 card, small enough to send.
 *
 * COVER by default: the card is filled and the overflow is cropped, because a
 * letterboxed upload would put grey bars in the picker and nobody means that.
 * Quality comes down in steps until it fits; it cannot fail to fit, which is
 * what the loop is for.
 */
export async function cardFromFile(file: Blob, fit: Fit = "cover"): Promise<string> {
  const bitmap = await readImage(file);
  const sw = (bitmap as { width: number }).width;
  const sh = (bitmap as { height: number }).height;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot redraw the picture");
  const at = placeIn(sw, sh, fit);
  if (fit === "contain") {
    /* The bars are the card's own background rather than transparency, which
       WebP would keep and the picker would show as a hole. */
    ctx.fillStyle = "#0b0b10";
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.drawImage(bitmap as CanvasImageSource, at.x, at.y, at.w, at.h);

  for (const quality of [0.86, 0.74, 0.62, 0.5, 0.38, 0.26]) {
    const url = canvas.toDataURL("image/webp", quality);
    /* A browser that cannot write WebP hands back a PNG instead, silently.
       Better to say so than to send something the other end will refuse. */
    if (!url.startsWith("data:image/webp")) throw new Error("this browser cannot save WebP");
    if (url.length <= CARD_MAX_CHARS) return url;
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
