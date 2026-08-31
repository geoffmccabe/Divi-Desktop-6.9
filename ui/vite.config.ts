import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The version has exactly ONE home: crates/app/tauri.conf.json. It used to be
// typed into the sidebar as well, which is how the number on screen ends up
// disagreeing with the number in the build — and the one on screen is the one
// people quote back to you.
const APP_VERSION = JSON.parse(
  readFileSync(new URL("../crates/app/tauri.conf.json", import.meta.url), "utf8"),
).version;

// Build the whole app into ONE self-contained index.html (JS + CSS inlined).
// Tauri's asset protocol doesn't reliably load external ES-module scripts
// (the classic Vite+Tauri blank-window trap); inlining sidesteps it entirely
// and also works in Electron. Confirmed against the working SW launcher's
// plain-script approach.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "safari15", outDir: "dist", emptyOutDir: true },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
});
