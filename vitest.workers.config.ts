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
        // Load the e2e env, which omits the AI binding — so the test pool never
        // opens a remote Workers AI connection (CI has no Cloudflare creds).
        wrangler: { configPath: "./wrangler.jsonc", environment: "e2e" },
        miniflare: {
          bindings: {
            // Test-only values; auth tests override ENVIRONMENT per request.
            TEST_AUTH_TOKEN: "unit-test-token",
            TELEGRAM_WEBHOOK_SECRET: "unit-webhook-secret",
            DEV_USER_EMAIL: "user@example.test",
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
