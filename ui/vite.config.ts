import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

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
});
