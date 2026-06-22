import { expect, test } from "./fixtures";

test("saves and reloads the preferences text", async ({ page }) => {
  await page.goto("/preferences");
  await page.getByLabel("Your interests").fill("rust, self-hosting, no crypto");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Your interests")).toHaveValue(
    "rust, self-hosting, no crypto",
  );
});

test("shows the signed-in user and a logout button", async ({
  page,
  userEmail,
}) => {
  await page.goto("/preferences");
  await expect(page.getByText(userEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});
