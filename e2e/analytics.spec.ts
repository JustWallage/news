import { expect, test } from "./fixtures";

// Analytics is gated to production builds (import.meta.env.PROD). This guards
// that gate: a non-prod build must never initialise PostHog or hit the
// first-party proxy, so dev (5173) and e2e (5174) never pollute the analytics
// project. Catches an accidental flip of the prod-only condition.
test("does not send analytics in non-production builds", async ({ page }) => {
  const analyticsRequests: string[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host === "e.news.justwallage.nl" || host.endsWith("posthog.com")) {
      analyticsRequests.push(req.url());
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(analyticsRequests).toEqual([]);
});
