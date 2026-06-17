import { defineConfig, devices } from "@playwright/test";

// Local runs: Playwright starts its own e2e-mode dev server on port 5174
// (separate from `pnpm dev` on 5173) and reuses it across runs.
// CI runs: BASE_URL points at the ephemeral deployment and no server starts.
// Per-test identity (a unique email) is set by e2e/fixtures.ts, so tests are
// isolated and run fully in parallel against the one shared dev server.
const baseURL = process.env.BASE_URL ?? "http://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI === undefined ? 0 : 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env.BASE_URL === undefined
    ? {
        webServer: {
          command: "pnpm dev:e2e",
          url: "http://localhost:5174",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
