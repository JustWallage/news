import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations("db/migrations");
      return {
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Test-only values; auth tests override ENVIRONMENT per request.
            TEST_AUTH_TOKEN: "unit-test-token",
            DEV_USER_EMAIL: "just@wallage.nl",
            // Applied to the fresh per-file D1 by worker/test-setup.ts.
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    name: "worker",
    include: ["worker/**/*.test.ts"],
    setupFiles: ["./worker/test-setup.ts"],
  },
});
