import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Divi Rebels on the web, built from the SAME source as the app.
//
// The app's own build (vite.config.ts) inlines everything into one file for the
// desktop shell. The web wants the opposite: ordinary separate files under
// /rebels/, so a returning player's browser keeps them. Same version number,
// read from the same one place.
const APP_VERSION = JSON.parse(
  readFileSync(new URL("../crates/app/tauri.conf.json", import.meta.url), "utf8"),
).version;

export default defineConfig({
  root: fileURLToPath(new URL("./web-rebels", import.meta.url)),
  base: "/rebels/",
  /* The home screen files: the manifest, and the icon an installed game shows.
     Everything else the page needs is imported by the source and hashed. */
  publicDir: fileURLToPath(new URL("./web-rebels/public", import.meta.url)),
  plugins: [react()],
  clearScreen: false,
  build: {
    target: "safari15",
    /* Into a rebels/ folder, so the files sit at the same paths the page asks
       for (/rebels/...) and the server can hand the folder over as it is. */
    outDir: fileURLToPath(new URL("./dist-web/rebels", import.meta.url)),
    emptyOutDir: true,
  },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
});
