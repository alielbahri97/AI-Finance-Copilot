import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // The "server-only" guard package throws outside a React Server
      // Components bundle; tests exercise the pure logic directly.
      { find: "server-only", replacement: path.resolve(__dirname, "tests/stubs/server-only.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
});
