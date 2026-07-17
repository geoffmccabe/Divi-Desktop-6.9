import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri drives this dev server; fixed port, no auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "safari15", outDir: "dist", emptyOutDir: true },
});
