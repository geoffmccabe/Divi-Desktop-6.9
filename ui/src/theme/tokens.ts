// The single source of truth for what's editable. The Style panel renders its
// controls from this list, and the provider applies each to its CSS variable.
// Add a token here → it shows up in the editor and takes effect. Nothing else
// to wire.

import { ICONS } from "../icons";

export type TokenType = "color" | "font" | "select" | "range" | "icon" | "image";

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
  displayPercent?: boolean; // show a 0-1 range value as a percentage
  accept?: string; // icon/image: file input accept attribute
}

const SYSTEM = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const ROUNDED = "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

const FONTS = [
  { label: "System", value: SYSTEM },
  { label: "Inter", value: `'Inter', ${SYSTEM}` },
  { label: "DM Sans", value: `'DM Sans', ${SYSTEM}` },
  { label: "Plus Jakarta Sans", value: `'Plus Jakarta Sans', ${SYSTEM}` },
  { label: "Space Grotesk", value: `'Space Grotesk', ${SYSTEM}` },
  { label: "Arial", value: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, 'Helvetica Neue', Arial, sans-serif" },
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

const IMAGE_FIT = [
  { label: "Fill", value: "cover" },
  { label: "Fit", value: "contain" },
  { label: "Tile", value: "auto" },
];
const IMAGE_REPEAT = [
  { label: "No repeat", value: "no-repeat" },
  { label: "Repeat", value: "repeat" },
];

// A few icon names need a friendlier label than plain word-splitting gives.
const ICON_LABEL_OVERRIDES: Record<string, string> = {
  hra: "Address name (HRA)",
  appbuilder: "App builder",
  communityapps: "Community apps",
  addressbook: "Address book",
  eyeOff: "Hide balance",
  chevronRight: "Chevron (right)",
  chevronDown: "Chevron (down)",
};
function iconLabel(name: string): string {
  if (ICON_LABEL_OVERRIDES[name]) return ICON_LABEL_OVERRIDES[name];
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
// One optional upload slot per built-in icon (see icons.ts). Unset, a skin
// keeps the built-in shape; set, the uploaded shape's alpha coverage is
// masked through the current text color exactly like a built-in icon, so it
// still auto-tints with the rest of the skin.
const ICON_TOKENS: TokenDef[] = Object.keys(ICONS).map((name) => ({
  key: `icon_${name}`,
  label: iconLabel(name),
  group: "Icons",
  type: "icon",
  cssVar: `--icon-${name}`,
  default: ICONS[name],
  accept: "image/svg+xml",
}));

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

  // Typography — value is a font-family stack. Five roles: two headline sizes,
  // body copy, small helper text, and the fixed-width face for
  // addresses/amounts/tx ids (previously hardcoded to one fixed font everywhere).
  { key: "fontHeading", label: "Headline font", group: "Typography", type: "font", cssVar: "--font-heading", default: SYSTEM, options: FONTS },
  { key: "fontSubheading", label: "Subheading font", group: "Typography", type: "font", cssVar: "--font-subheading", default: SYSTEM, options: FONTS },
  { key: "fontBody", label: "Body font", group: "Typography", type: "font", cssVar: "--font-body", default: SYSTEM, options: FONTS },
  { key: "fontCaption", label: "Caption/info font", group: "Typography", type: "font", cssVar: "--font-caption", default: SYSTEM, options: FONTS },
  { key: "fontMono", label: "Numeric/address font", group: "Typography", type: "font", cssVar: "--font-mono", default: MONO, options: FONTS },

  // Panel — the frosted, glowing look (mirrors Kinet.ink). Color values are
  // HSL triplets; range values carry their unit.
  { key: "controlScheme", label: "Menus & sliders", group: "Panel", type: "select", cssVar: "--control-scheme", default: "dark", options: [{ label: "Dark", value: "dark" }, { label: "Light", value: "light" }] },
  { key: "panelBg", label: "Panel background", group: "Panel", type: "color", cssVar: "--panel-bg", default: "240 6% 10%" },
  { key: "panelOpacity", label: "Panel opacity", group: "Panel", type: "range", cssVar: "--panel-opacity", default: "0.85", min: 0.05, max: 1, step: 0.05, unit: "", displayPercent: true },
  { key: "panelRadius", label: "Corners", group: "Panel", type: "range", cssVar: "--panel-radius", default: "12px", min: 0, max: 28, step: 1, unit: "px" },
  { key: "panelBlur", label: "Frost / blur", group: "Panel", type: "range", cssVar: "--panel-blur", default: "24px", min: 0, max: 40, step: 1, unit: "px" },
  { key: "glowColor", label: "Glow color", group: "Panel", type: "color", cssVar: "--glow-color", default: "280 80% 60%" },
  { key: "glowStrength", label: "Glow amount", group: "Panel", type: "range", cssVar: "--glow-strength", default: "22px", min: 0, max: 60, step: 2, unit: "px" },
  // Optional texture/photo behind the panel color — additive; the panel color
  // above stays as the base/fallback underneath it.
  { key: "panelBgImage", label: "Background image/texture", group: "Panel", type: "image", cssVar: "--panel-bg-image", default: "none", accept: "image/png,image/jpeg,image/webp,image/svg+xml" },
  { key: "panelBgImageSize", label: "Image fit", group: "Panel", type: "select", cssVar: "--panel-bg-image-size", default: "cover", options: IMAGE_FIT },
  { key: "panelBgImageRepeat", label: "Image repeat", group: "Panel", type: "select", cssVar: "--panel-bg-image-repeat", default: "no-repeat", options: IMAGE_REPEAT },
  { key: "panelBgImageOpacity", label: "Image opacity", group: "Panel", type: "range", cssVar: "--panel-bg-image-opacity", default: "1", min: 0, max: 1, step: 0.05, unit: "", displayPercent: true },

  // Sub-panels — the nested boxes on a panel (balance cards, chips). Their own
  // background/opacity/outline, independent of the parent panel.
  { key: "subPanelBg", label: "Sub-panel background", group: "Sub-panels", type: "color", cssVar: "--subpanel-bg", default: "0 0% 0%" },
  { key: "subPanelOpacity", label: "Sub-panel opacity", group: "Sub-panels", type: "range", cssVar: "--subpanel-opacity", default: "1", min: 0.05, max: 1, step: 0.05, unit: "", displayPercent: true },
  { key: "subPanelOutline", label: "Sub-panel outline", group: "Sub-panels", type: "range", cssVar: "--subpanel-outline-width", default: "0px", min: 0, max: 8, step: 1, unit: "px" },
  { key: "subPanelOutlineColor", label: "Outline color", group: "Sub-panels", type: "color", cssVar: "--subpanel-outline-color", default: "0 0% 50%" },
  { key: "subPanelBgImage", label: "Background image/texture", group: "Sub-panels", type: "image", cssVar: "--subpanel-bg-image", default: "none", accept: "image/png,image/jpeg,image/webp,image/svg+xml" },
  { key: "subPanelBgImageSize", label: "Image fit", group: "Sub-panels", type: "select", cssVar: "--subpanel-bg-image-size", default: "cover", options: IMAGE_FIT },
  { key: "subPanelBgImageRepeat", label: "Image repeat", group: "Sub-panels", type: "select", cssVar: "--subpanel-bg-image-repeat", default: "no-repeat", options: IMAGE_REPEAT },
  { key: "subPanelBgImageOpacity", label: "Image opacity", group: "Sub-panels", type: "range", cssVar: "--subpanel-bg-image-opacity", default: "1", min: 0, max: 1, step: 0.05, unit: "", displayPercent: true },

  // Maps — the 3D globe and flat network map share one palette so both always
  // match the active skin. Defaults mirror what each map already looked like
  // (the flat map's previous --primary/--info/--warning-driven look, and the
  // globe's previous hardcoded hex) so switching this on changes nothing until
  // a skin creator actually touches these.
  { key: "mapSelf", label: "Your node", group: "Maps", type: "color", cssVar: "--map-self", default: "45 93% 47%" },
  { key: "mapPeerLink", label: "Peer connections", group: "Maps", type: "color", cssVar: "--map-peer-link", default: "280 80% 60%" },
  { key: "mapNetworkLink", label: "Network connections", group: "Maps", type: "color", cssVar: "--map-network-link", default: "207 90% 54%" },
  { key: "mapOfflineNode", label: "Remembered/offline nodes", group: "Maps", type: "color", cssVar: "--map-offline", default: "215 14% 58%" },
  { key: "mapDiscoveryPulse", label: "Discovery pulse", group: "Maps", type: "color", cssVar: "--map-discovery-pulse", default: "145 80% 50%" },
  { key: "mapActivityPulse", label: "Activity pulse", group: "Maps", type: "color", cssVar: "--map-activity-pulse", default: "45 100% 55%" },
  { key: "mapNewNode", label: "New node highlight", group: "Maps", type: "color", cssVar: "--map-new-node", default: "177 85% 58%" },
  { key: "mapStakeAccent", label: "Stake-winner accent", group: "Maps", type: "color", cssVar: "--map-stake-accent", default: "353 76% 50%" },
  { key: "mapBackground", label: "Globe background", group: "Maps", type: "color", cssVar: "--map-background", default: "216 33% 6%" },
  { key: "mapAtmosphere", label: "Globe atmosphere", group: "Maps", type: "color", cssVar: "--map-atmosphere", default: "211 100% 68%" },

  // Sounds — generated tones (see sound.ts). Values feed the Web Audio engine.
  { key: "soundVolume", label: "Volume", group: "Sounds", type: "range", cssVar: "--sound-volume", default: "0.15", min: 0, max: 0.5, step: 0.05, unit: "" },
  { key: "clickWave", label: "Click sound", group: "Sounds", type: "select", cssVar: "--sound-click-wave", default: "sine", options: WAVES },
  { key: "clickFreq", label: "Click pitch", group: "Sounds", type: "range", cssVar: "--sound-click-freq", default: "660", min: 200, max: 1200, step: 10, unit: "" },
  { key: "sendWave", label: "Send sound", group: "Sounds", type: "select", cssVar: "--sound-send-wave", default: "triangle", options: WAVES },
  { key: "sendFreq", label: "Send pitch", group: "Sounds", type: "range", cssVar: "--sound-send-freq", default: "880", min: 200, max: 1200, step: 10, unit: "" },
  { key: "receiveWave", label: "Receive sound", group: "Sounds", type: "select", cssVar: "--sound-receive-wave", default: "sine", options: WAVES },
  { key: "receiveFreq", label: "Receive pitch", group: "Sounds", type: "range", cssVar: "--sound-receive-freq", default: "523", min: 200, max: 1200, step: 10, unit: "" },

  // Apps & Builder — the store grid, the frame a community app runs in, and the
  // App Builder panel.
  //
  // Colour, transparency, outline and blur are deliberately NOT repeated here:
  // these surfaces reuse the Sub-panels tokens above, so they already match the
  // rest of the wallet and follow any skin without a second set of controls to
  // keep in step. What IS here is only what is genuinely particular to these
  // screens: how round the cards are, how big they are, and how far apart.
  { key: "appCardRadius", label: "Card corners", group: "Apps & Builder", type: "range", cssVar: "--app-card-radius", default: "12px", min: 0, max: 28, step: 1, unit: "px" },
  { key: "appGridGap", label: "Grid spacing", group: "Apps & Builder", type: "range", cssVar: "--app-grid-gap", default: "16px", min: 4, max: 40, step: 2, unit: "px" },
  { key: "appCardMin", label: "Card width", group: "Apps & Builder", type: "range", cssVar: "--app-card-min", default: "240px", min: 160, max: 420, step: 10, unit: "px" },
  { key: "appCardGlow", label: "Card glow on hover", group: "Apps & Builder", type: "range", cssVar: "--app-card-glow", default: "1", min: 0, max: 1, step: 0.05, unit: "", displayPercent: true },
  // The Purchase with Divi window, which is shared by anything sold in the app.
  { key: "purchaseModalWidth", label: "Purchase window width", group: "Apps & Builder", type: "range", cssVar: "--purchase-modal-width", default: "560px", min: 380, max: 820, step: 10, unit: "px" },
  { key: "purchaseMascotSize", label: "Mascot size", group: "Apps & Builder", type: "range", cssVar: "--purchase-mascot-size", default: "150px", min: 0, max: 260, step: 10, unit: "px" },

  ...ICON_TOKENS,
];

export const TOKEN_GROUPS = ["Colors", "Typography", "Panel", "Sub-panels", "Maps", "Icons", "Sounds", "Apps & Builder"];
