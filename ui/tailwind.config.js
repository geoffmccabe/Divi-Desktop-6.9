/** Divi Desktop 6.9 — tokens mirror the Kinet.ink design system (HSL vars). */
const hsl = (v) => `hsl(var(--${v}))`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: hsl("background"),
        foreground: hsl("foreground"),
        card: hsl("card"),
        primary: { DEFAULT: hsl("primary"), foreground: hsl("primary-foreground") },
        accent: { DEFAULT: hsl("accent"), foreground: hsl("accent-foreground") },
        muted: { DEFAULT: hsl("muted"), foreground: hsl("muted-foreground") },
        border: hsl("border"),
        success: hsl("success"),
        warning: hsl("warning"),
        destructive: hsl("destructive"),
        info: hsl("info"),
      },
    },
  },
  plugins: [],
};
