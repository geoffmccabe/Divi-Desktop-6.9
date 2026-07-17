// The single source of truth for what's editable. The Style panel renders its
// controls from this list, and the provider applies each to its CSS variable.
// Add a token here → it shows up in the editor and takes effect. Nothing else
// to wire.

export type TokenType = "color" | "font" | "range";

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

  // Shape — value carries its unit.
  { key: "panelRadius", label: "Panel corners", group: "Shape", type: "range", cssVar: "--panel-radius", default: "12px", min: 0, max: 28, step: 1, unit: "px" },
  { key: "panelBlur", label: "Panel blur", group: "Shape", type: "range", cssVar: "--panel-blur", default: "24px", min: 0, max: 40, step: 1, unit: "px" },
];

export const TOKEN_GROUPS = ["Colors", "Typography", "Shape"];
