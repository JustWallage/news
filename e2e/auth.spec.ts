import { expect, test } from "@playwright/test";

// Uses the bare Playwright test (NOT ./fixtures), so no test-auth headers are
// sent — the worker returns 401 and the SPA must show the landing page.
test("an unauthenticated visitor sees the landing page with sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Hacker News, filtered/i }),
  ).toBeVisible();
  await expect(page.getByText(/Describe what you want to read/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Delivered to Telegram/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Sign in with Google/i }),
  ).toBeVisible();
});
