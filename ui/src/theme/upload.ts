// Shared helpers for the two "upload an image" token types (icon, image).
// Values are stored as plain data-URI strings directly in the theme object —
// the same Theme = Record<string,string> shape every other token already
// uses, so an uploaded icon or texture travels with a saved/shared skin
// exactly like a color or a font choice does, no separate storage to sync.

export const MAX_ICON_BYTES = 60 * 1024; // a line-icon SVG is a few KB at most
export const MAX_TEXTURE_BYTES = 900 * 1024; // keeps a saved skin well under localStorage limits

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// Strips <script>, event-handler attributes, and any external (non-data:)
// href/xlink:href so an uploaded SVG can't run script or fetch a remote URL.
// Used as a CSS mask/background image (never injected into the DOM), so this
// is defense in depth rather than a strict requirement — cheap to do either way.
export function sanitizeSvgText(raw: string): string | null {
  if (!/<svg[\s>]/i.test(raw)) return null;
  let out = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"(?:[^"]*)"/gi, "")
    .replace(/\son\w+\s*=\s*'(?:[^']*)'/gi, "");
  out = out.replace(/((?:xlink:)?href\s*=\s*)"([^"]*)"/gi, (m, prefix, url) =>
    /^\s*data:/i.test(url) || /^\s*#/.test(url) ? m : `${prefix}""`
  );
  return out;
}

export function svgToDataUri(svgText: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svgText)}")`;
}

// Icon upload: SVG only (so mask-image auto-tints it via currentColor, the
// same as every built-in icon — see icons.ts / Icon.tsx).
export async function iconFileToTokenValue(file: File): Promise<string> {
  if (file.size > MAX_ICON_BYTES) throw new Error(`Icon must be under ${Math.round(MAX_ICON_BYTES / 1024)}KB`);
  if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) throw new Error("Icons must be an SVG file");
  const text = await readFileAsText(file);
  const clean = sanitizeSvgText(text);
  if (!clean) throw new Error("That file doesn't look like a valid SVG");
  return svgToDataUri(clean);
}

// Panel texture upload: raster (png/jpg/webp) or SVG, shown as a background
// image — no tinting, shown as uploaded.
export async function textureFileToTokenValue(file: File): Promise<string> {
  if (file.size > MAX_TEXTURE_BYTES) throw new Error(`Image must be under ${Math.round(MAX_TEXTURE_BYTES / 1024)}KB`);
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
    const text = await readFileAsText(file);
    const clean = sanitizeSvgText(text);
    if (!clean) throw new Error("That file doesn't look like a valid SVG");
    return svgToDataUri(clean);
  }
  if (!/^image\//.test(file.type)) throw new Error("Choose an image file");
  const dataUri = await readFileAsDataUri(file);
  return `url("${dataUri}")`;
}
