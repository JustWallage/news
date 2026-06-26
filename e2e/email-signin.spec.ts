import { expect, test } from "@playwright/test";

// Bare Playwright test (NOT ./fixtures): no test-auth headers, so the worker
// returns 401 and the SPA shows the landing page with the sign-in forms. These
// assert client-observable behavior only — the session cookie that verify mints
// is ignored in the e2e env (identity comes from test headers there), so the
// verify→session→feed round-trip is covered by the worker unit tests instead.

test("emails a code and advances to the code step with it prefilled", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("e2e-user@example.com");
  await page.getByRole("button", { name: /Email me a code/i }).click();

  const codeInput = page.getByLabel("Sign-in code");
  await expect(codeInput).toBeVisible();
  // The e2e env returns the code as `devCode`, which the SPA autofills.
  await expect(codeInput).toHaveValue(/^\d{6}$/);
});

test("magic link prefills the code, fires verify, and scrubs the URL", async ({
  page,
}) => {
  await page.goto("/?login_email=e2e-user@example.com&login_code=999999");

  const codeInput = page.getByLabel("Sign-in code");
  await expect(codeInput).toHaveValue("999999");
  // The bogus code is rejected, proving verify fired automatically.
  await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  // The query params are stripped so the code never lingers in the URL.
  await expect(page).toHaveURL((url) => url.search === "");
});

test("shows an error for a wrong code", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("e2e-user@example.com");
  await page.getByRole("button", { name: /Email me a code/i }).click();

  const codeInput = page.getByLabel("Sign-in code");
  await expect(codeInput).toHaveValue(/^\d{6}$/);
  const issued = await codeInput.inputValue();
  const wrong = issued === "000000" ? "111111" : "000000";
  await codeInput.fill(wrong);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByText(/invalid or expired/i)).toBeVisible();
});
