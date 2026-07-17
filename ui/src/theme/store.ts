// Theme = a value per token key. Applying it writes each token's CSS variable
// onto :root, so the whole app restyles live. Persistence is local for now;
// the shape (named, portable theme objects) is what the future DIVI-paid theme
// sharing will move over the wire.
import { TOKENS } from "./tokens";

export type Theme = Record<string, string>;

export interface SavedTheme {
  id: string;
  name: string;
  tokens: Theme;
}

const ACTIVE_KEY = "dd69.activeTheme";
const SAVED_KEY = "dd69.savedThemes";

export function defaultTheme(): Theme {
  return Object.fromEntries(TOKENS.map((t) => [t.key, t.default]));
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const t of TOKENS) {
    root.style.setProperty(t.cssVar, theme[t.key] ?? t.default);
  }
}

export function loadActive(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "{}");
    return { ...defaultTheme(), ...saved };
  } catch {
    return defaultTheme();
  }
}

export function persistActive(theme: Theme): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(theme));
}

export function loadSavedThemes(): SavedTheme[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeSavedThemes(list: SavedTheme[]): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}
