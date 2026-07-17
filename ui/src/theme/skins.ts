import { defaultTheme, type Theme } from "./store";

// A skin is just a named theme (token map). Built-in skins ship with the app;
// more will come from the marketplace (bought/free, stored in Supabase).
export interface Skin {
  id: string;
  name: string;
  free: boolean;
  tokens: Theme;
}

// "Divilicious" is the current default look — a free, built-in skin. Geoff
// refines it as a user; it's the baseline everyone starts from.
export const BUILTIN_SKINS: Skin[] = [
  { id: "divilicious", name: "Divilicious", free: true, tokens: defaultTheme() },
];
