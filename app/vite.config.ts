import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Served from GitHub Pages at /quits/ in production; core/ (shared with the scripts) lives one level up.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/quits/" : "/",
  plugins: [react()],
  resolve: { dedupe: ["viem"] },
  server: { fs: { allow: [repoRoot] } },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the app, so they get their own long-lived chunks.
        manualChunks: { react: ["react", "react-dom", "react-dom/client"], viem: ["viem"], d3: ["d3-force"] },
      },
    },
  },
}));
