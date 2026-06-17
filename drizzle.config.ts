import { defineConfig } from "drizzle-kit";

// Only used for `pnpm migrate:gen` (SQL generation). Migrations are applied
// with `wrangler d1 migrations apply`, never by drizzle-kit.
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
