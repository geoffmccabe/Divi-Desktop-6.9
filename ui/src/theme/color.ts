// Convert between the app's HSL-triplet CSS-var format ("280 80% 60%") and the
// hex that <input type="color"> speaks. Keeping the app on hsl(var(--x)) means
// existing styles keep working; only the editor converts.

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export function hslTripletToHex(triplet: string): string {
  const m = triplet.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return "#000000";
  const [r, g, b] = hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function hexToHslTriplet(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "0 0% 0%";
  const [h, s, l] = rgbToHsl(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  return `${h} ${s}% ${l}%`;
}
