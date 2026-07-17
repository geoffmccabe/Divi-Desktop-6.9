import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri drives this dev server; fixed port, no auto-open.
// Vite marks module scripts `crossorigin`, which the Tauri custom protocol can
// block (no CORS headers) → blank page. Strip it.
const stripCrossorigin = {
  name: "strip-crossorigin",
  transformIndexHtml(html: string) {
    return html.replace(/\s+crossorigin/g, "");
  },
};

export default defineConfig({
  // Relative asset paths so the Tauri webview resolves them from any base.
  base: "./",
  plugins: [react(), stripCrossorigin],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "safari15", outDir: "dist", emptyOutDir: true },
});
