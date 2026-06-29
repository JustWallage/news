import { test as base, expect } from "@playwright/test";
import { test } from "./fixtures";

// OWNER_EMAIL in the e2e env (see wrangler.jsonc) — a fixed seeded account,
// distinct from each test's random user. This is the ONLY spec that touches it,
// so the shared/persisted owner row never races another test.
const OWNER = "owner@news.test";
const ownerHeaders = {
  "X-Test-User-Email": OWNER,
  "X-Test-Auth": process.env.TEST_AUTH_TOKEN ?? "local-test-token",
};

test("the public demo serves the owner's stored feed without re-running the AI filter", async ({
  page,
  request,
}) => {
  // Seed the owner's stored feed as the owner: prefs "rust" + a digest run →
  // the fake AI keeps only the Rust story.
  await request.put("/api/preferences", {
    data: { text: "rust" },
    headers: ownerHeaders,
  });
  await request.post("/api/digest/run", { headers: ownerHeaders });

  // Change the owner's prefs to "bitcoin" WITHOUT a digest run. If the demo path
  // re-ran the AI filter it would re-curate to Bitcoin; reading stored curations
  // only, it must keep showing Rust.
  await request.put("/api/preferences", {
    data: { text: "bitcoin" },
    headers: ownerHeaders,
  });

  await page.goto("/demo");

  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toBeVisible();
  await expect(page.getByText(/Bitcoin hits a new all-time high/)).toBeHidden();

  // Read-only demo framing, no Refresh control.
  await expect(page.getByText(/These are my picks/)).toBeVisible();
  await expect(page.getByText(/Last refreshed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
});

// Bare Playwright test (no ./fixtures) → no auth headers → the SPA shows the
// landing page, where the "Show live demo" button must lead to /demo.
base("the landing page links to the live demo", async ({ page }) => {
  await page.goto("/");
  const demoLink = page.getByRole("button", { name: /Show live demo/i });
  await expect(demoLink).toBeVisible();
  await demoLink.click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("heading", { name: /The owner.s live picks/i }),
  ).toBeVisible();
});
