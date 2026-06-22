import { expect, test } from "@playwright/test";

// Uses the bare Playwright test (NOT ./fixtures), so no test-auth headers are
// sent — the worker returns 401 and the SPA must show the sign-in screen.
test("an unauthenticated visitor sees the Google sign-in screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Sign in with Google/i }),
  ).toBeVisible();
});
