import { expect, test } from "./fixtures";

test("the preferences page reveals a Telegram connect code", async ({
  page,
}) => {
  await page.goto("/preferences");
  await expect(page.getByText(/Connected\./)).toBeHidden();

  await page.getByRole("button", { name: "Connect Telegram" }).click();

  await expect(page.getByText(/\/start [0-9a-f]{8}/)).toBeVisible();
  await expect(page.getByText(/expires in 15 minutes/)).toBeVisible();
});
