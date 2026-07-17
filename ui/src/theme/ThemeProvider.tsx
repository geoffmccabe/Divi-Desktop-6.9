import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyTheme,
  defaultTheme,
  loadActive,
  loadSavedThemes,
  persistActive,
  writeSavedThemes,
  type SavedTheme,
  type Theme,
} from "./store";
import { BUILTIN_SKINS, type Skin } from "./skins";

interface ThemeCtx {
  theme: Theme;
  setToken: (key: string, value: string) => void;
  reset: () => void;
  saved: SavedTheme[];
  saveCurrent: (name: string) => void;
  applySaved: (id: string) => void;
  deleteSaved: (id: string) => void;
  builtinSkins: Skin[];
  applySkin: (id: string) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

// A stable-per-session id without Date/Math.random dependence concerns here
// (browser runtime); crypto is available in the webview.
const newId = () => crypto.randomUUID();

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => loadActive());
  const [saved, setSaved] = useState<SavedTheme[]>(() => loadSavedThemes());

  // Apply on first paint and whenever the active theme changes.
  useEffect(() => {
    applyTheme(theme);
    persistActive(theme);
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      setToken: (key, v) => setTheme((t) => ({ ...t, [key]: v })),
      reset: () => setTheme(defaultTheme()),
      saved,
      saveCurrent: (name) => {
        const next = [...saved, { id: newId(), name: name.trim() || "Untitled", tokens: theme }];
        setSaved(next);
        writeSavedThemes(next);
      },
      applySaved: (id) => {
        const t = saved.find((s) => s.id === id);
        if (t) setTheme({ ...defaultTheme(), ...t.tokens });
      },
      deleteSaved: (id) => {
        const next = saved.filter((s) => s.id !== id);
        setSaved(next);
        writeSavedThemes(next);
      },
      builtinSkins: BUILTIN_SKINS,
      applySkin: (id) => {
        const s = BUILTIN_SKINS.find((x) => x.id === id);
        if (s) setTheme({ ...defaultTheme(), ...s.tokens });
      },
    }),
    [theme, saved]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
