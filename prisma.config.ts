import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Direct (non-pooled) connection used by migration/introspection commands.
    // Falls back to a placeholder so `prisma generate` works without a .env
    // (e.g. during CI builds); migrate commands require the real URL.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/postgres",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
