import { test as base, expect } from "@playwright/test";
import { test } from "./fixtures";

// OWNER_EMAIL in the e2e env. The owner account is shared and persisted, so this
// must stay the ONLY spec that touches it, or parallel runs will race.
const OWNER = "owner@news.test";
const ownerHeaders = {
  "X-Test-User-Email": OWNER,
  "X-Test-Auth": process.env.TEST_AUTH_TOKEN ?? "local-test-token",
};

test("the public demo serves the owner's stored feed without re-running the AI filter", async ({
  page,
  request,
}) => {
  await request.put("/api/preferences", {
    data: { text: "rust" },
    headers: ownerHeaders,
  });
  await request.post("/api/digest/run", { headers: ownerHeaders });

  // Change prefs to "bitcoin" WITHOUT re-running the digest: if /demo re-ran the
  // AI filter the feed would flip to Bitcoin, so a still-Rust feed proves it
  // reads stored curations only.
  await request.put("/api/preferences", {
    data: { text: "bitcoin" },
    headers: ownerHeaders,
  });

  await page.goto("/demo");

  await expect(
    page.getByRole("link", { name: /Rust's new borrow checker/ }),
  ).toBeVisible();
  await expect(page.getByText(/Bitcoin hits a new all-time high/)).toBeHidden();

  await expect(page.getByText(/These are my picks/)).toBeVisible();
  await expect(page.getByText(/Last refreshed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);

  await expect(page.getByText(/Based on these preferences/)).toBeVisible();
  await expect(page.getByLabel(/Based on these preferences/)).toHaveValue(
    "bitcoin",
  );
});

// Bare test (no ./fixtures) → no auth headers → the SPA shows the landing page.
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
