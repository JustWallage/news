import { expect, test } from "./fixtures";

test("the preferences page reveals a Telegram connect code with a copy button", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-write"]);
  await page.goto("/preferences");
  await expect(page.getByText(/Connected\./)).toBeHidden();

  await page.getByRole("button", { name: "Generate start command" }).click();

  await expect(page.getByText(/\/start [0-9a-f]{8}/)).toBeVisible();
  await expect(page.getByText(/expires in 15 minutes/)).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy" });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
});

test("the timezone selector persists the chosen zone", async ({ page }) => {
  await page.goto("/preferences");
  const select = page.getByLabel("Timezone");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/telegram/timezone") &&
        r.request().method() === "PUT",
    ),
    select.selectOption("Asia/Tokyo"),
  ]);

  await page.reload();
  await expect(page.getByLabel("Timezone")).toHaveValue("Asia/Tokyo");
});
