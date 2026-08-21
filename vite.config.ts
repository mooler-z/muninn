import { defineConfig } from "vite";
import { resolve } from "node:path";

// Tauri serves the built frontend from ../dist and the dev server from 5173.
export default defineConfig({
  root: "ui",
  // Relative, so the built assets resolve under Tauri's custom protocol.
  base: "./",
  clearScreen: false,
  // Vite does not treat .glb as an asset by default, so `?url` imports of the
  // dungeon models would be parsed as source rather than emitted as files.
  assetsInclude: ["**/*.glb"],
  server: {
    // Not Vite's 5173 default, which every other project on the machine is
    // also trying to bind. strictPort so a silent move never leaves Tauri
    // pointed at the wrong dev server.
    port: 5183,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "safari15",
    rollupOptions: {
      input: {
        // fixtures.html is a development harness and is deliberately left out
        // of the bundle — it exists to be opened with `pnpm dev`.
        panel: resolve(__dirname, "ui/index.html"),
        details: resolve(__dirname, "ui/details.html"),
        waiting: resolve(__dirname, "ui/waiting.html"),
        history: resolve(__dirname, "ui/history.html"),
        notice: resolve(__dirname, "ui/notice.html"),
      },
    },
  },
});
