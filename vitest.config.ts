import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // src/lib/prisma.ts creates its client (and pg pool) eagerly at import
      // time and fails fast without a connection string. No test ever opens a
      // connection, so any syntactically valid URL suffices.
      DATABASE_URL: "postgresql://vitest:vitest@localhost:5432/vitest",
    },
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
