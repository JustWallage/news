import { test as base } from "@playwright/test";

// Each test runs as a unique user (random email). Because the feed (curations)
// and preferences are per-user, tests are fully isolated with no shared reset —
// so they run in parallel and leave the global story cache untouched, exactly
// like production. The e2e auth path accepts any email via the test headers.
export const test = base.extend<{ userEmail: string }>({
  // eslint-disable-next-line no-empty-pattern
  userEmail: async ({}, use) => {
    await use(`e2e-${crypto.randomUUID()}@news.test`);
  },
  extraHTTPHeaders: async ({ userEmail }, use) => {
    await use({
      "X-Test-User-Email": userEmail,
      "X-Test-Auth": process.env.TEST_AUTH_TOKEN ?? "local-test-token",
    });
  },
});

export { expect } from "@playwright/test";
