import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 is a native module: it must be required at runtime rather
  // than bundled, and it pins every route that touches it to the Node runtime.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // A self-contained server bundle, so the production image carries the app
  // and its traced dependencies rather than the whole node_modules tree.
  output: "standalone",
  // This directory, not the first parent with a lockfile. Muninn's Tauri app
  // has its own lockfile one level up and unrelated projects sit beside it, so
  // the inferred root was wrong and pulled half the workspace into the trace.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default config;
