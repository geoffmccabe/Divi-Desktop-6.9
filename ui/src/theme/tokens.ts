// The single source of truth for what's editable. The Style panel renders its
// controls from this list, and the provider applies each to its CSS variable.
// Add a token here → it shows up in the editor and takes effect. Nothing else
// to wire.

export type TokenType = "color" | "font" | "select" | "range";

export interface TokenDef {
  key: string;
  label: string;
  group: string;
  type: TokenType;
  cssVar: string;
  default: string;
  options?: { label: string; value: string }[]; // font
  min?: number;
  max?: number;
  step?: number;
  unit?: string; // range
}

const SYSTEM = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const ROUNDED = "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

const FONTS = [
  { label: "System", value: SYSTEM },
  { label: "Serif", value: SERIF },
  { label: "Mono", value: MONO },
  { label: "Rounded", value: ROUNDED },
];

const WAVES = [
  { label: "Soft (sine)", value: "sine" },
  { label: "Warm (triangle)", value: "triangle" },
  { label: "Sharp (square)", value: "square" },
  { label: "Buzzy (saw)", value: "sawtooth" },
];

export const TOKENS: TokenDef[] = [
  // Colors — value is an HSL triplet consumed via hsl(var(--x)).
  { key: "background", label: "Background", group: "Colors", type: "color", cssVar: "--background", default: "240 6% 10%" },
  { key: "foreground", label: "Text", group: "Colors", type: "color", cssVar: "--foreground", default: "0 0% 95%" },
  { key: "primary", label: "Primary", group: "Colors", type: "color", cssVar: "--primary", default: "280 80% 60%" },
  { key: "accent", label: "Accent", group: "Colors", type: "color", cssVar: "--accent", default: "320 70% 55%" },
  { key: "card", label: "Panel", group: "Colors", type: "color", cssVar: "--card", default: "240 5% 15%" },
  { key: "border", label: "Border", group: "Colors", type: "color", cssVar: "--border", default: "240 4% 25%" },
  { key: "success", label: "Success", group: "Colors", type: "color", cssVar: "--success", default: "142 76% 36%" },
  { key: "warning", label: "Warning", group: "Colors", type: "color", cssVar: "--warning", default: "45 93% 47%" },
  { key: "destructive", label: "Danger", group: "Colors", type: "color", cssVar: "--destructive", default: "0 84% 60%" },

  // Typography — value is a font-family stack.
  { key: "fontHeading", label: "Heading font", group: "Typography", type: "font", cssVar: "--font-heading", default: SYSTEM, options: FONTS },
  { key: "fontBody", label: "Body font", group: "Typography", type: "font", cssVar: "--font-body", default: SYSTEM, options: FONTS },

  // Panel — the frosted, glowing look (mirrors Kinet.ink). Color values are
  // HSL triplets; range values carry their unit.
  { key: "panelBg", label: "Panel background", group: "Panel", type: "color", cssVar: "--panel-bg", default: "240 6% 10%" },
  { key: "panelOpacity", label: "Transparency", group: "Panel", type: "range", cssVar: "--panel-opacity", default: "0.45", min: 0.1, max: 1, step: 0.05, unit: "" },
  { key: "panelRadius", label: "Corners", group: "Panel", type: "range", cssVar: "--panel-radius", default: "12px", min: 0, max: 28, step: 1, unit: "px" },
  { key: "panelBlur", label: "Frost / blur", group: "Panel", type: "range", cssVar: "--panel-blur", default: "24px", min: 0, max: 40, step: 1, unit: "px" },
  { key: "glowColor", label: "Glow color", group: "Panel", type: "color", cssVar: "--glow-color", default: "280 80% 60%" },
  { key: "glowStrength", label: "Glow amount", group: "Panel", type: "range", cssVar: "--glow-strength", default: "22px", min: 0, max: 60, step: 2, unit: "px" },

  // Sounds — generated tones (see sound.ts). Values feed the Web Audio engine.
  { key: "soundVolume", label: "Volume", group: "Sounds", type: "range", cssVar: "--sound-volume", default: "0.15", min: 0, max: 0.5, step: 0.05, unit: "" },
  { key: "clickWave", label: "Click sound", group: "Sounds", type: "select", cssVar: "--sound-click-wave", default: "sine", options: WAVES },
  { key: "clickFreq", label: "Click pitch", group: "Sounds", type: "range", cssVar: "--sound-click-freq", default: "660", min: 200, max: 1200, step: 10, unit: "" },
  { key: "sendWave", label: "Send sound", group: "Sounds", type: "select", cssVar: "--sound-send-wave", default: "triangle", options: WAVES },
  { key: "sendFreq", label: "Send pitch", group: "Sounds", type: "range", cssVar: "--sound-send-freq", default: "880", min: 200, max: 1200, step: 10, unit: "" },
  { key: "receiveWave", label: "Receive sound", group: "Sounds", type: "select", cssVar: "--sound-receive-wave", default: "sine", options: WAVES },
  { key: "receiveFreq", label: "Receive pitch", group: "Sounds", type: "range", cssVar: "--sound-receive-freq", default: "523", min: 200, max: 1200, step: 10, unit: "" },
];

export const TOKEN_GROUPS = ["Colors", "Typography", "Panel", "Sounds"];
