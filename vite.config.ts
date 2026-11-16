import { defineConfig } from "vite";
import { pwa } from "./tools/vite-pwa";

// Relative base so the same build works at / (preview) and /<repo>/ (GitHub Pages).
export default defineConfig({
  base: "./",
  plugins: [pwa()],
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
